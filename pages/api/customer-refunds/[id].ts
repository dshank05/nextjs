import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { customerLedgerService } from '../../../lib/customer-ledger-service';
import { customerBalanceHandler } from '../../../lib/customer-balance-handler';
import { convertDateToTimestamp } from '../../../lib/date-utils';


export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return handleGetRefund(req, res);
  } else if (req.method === 'PUT') {
    return handleUpdateRefund(req, res);
  } else if (req.method === 'DELETE') {
    return handleDeleteRefund(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * GET /api/customer-refunds/[id]
 * Get details of a specific customer refund
 */
async function handleGetRefund(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Refund ID is required' });
    }

    const refundId = parseInt(id as string);

    // Get refund with customer and allocations
    const refund = await prisma.customer_refunds.findUnique({
      where: { id: refundId },
      include: {
        customer: {
          select: {
            id: true,
            billing_name: true,
            contact_no: true,
            email: true
          }
        },
        allocations: {
          include: {
            sale_return: {
              select: {
                id: true,
                return_date: true,
                total_amount: true,
                refund_amount: true,
                payment_status: true
              }
            },
            salex_return: {
              select: {
                id: true,
                return_date: true,
                total_amount: true,
                refund_amount: true,
                payment_status: true
              }
            }
          },
          orderBy: {
            allocation_date: 'desc'
          }
        }
      }
    });

    if (!refund) {
      return res.status(404).json({ error: 'Refund not found' });
    }

    // Calculate total allocated vs refund amount
    const totalAllocated = refund.allocations.reduce(
      (sum, alloc) => sum + Number(alloc.allocated_amount),
      0
    );

    // Format response with detailed allocation info
    const formattedRefund = {
      id: refund.id,
      customer: {
        id: refund.customer.id,
        name: refund.customer.billing_name,
        contact: refund.customer.contact_no,
        email: refund.customer.email
      },
      refund_date: refund.refund_date,
      refund_amount: Number(refund.refund_amount),
      refund_mode: refund.refund_mode,
      refund_mode_text: refund.refund_mode === 0 ? 'Cash' : 'Bank',
      refund_type: refund.refund_type,
      notes: refund.notes,
      fy: refund.fy,
      created_at: refund.created_at,
      updated_at: refund.updated_at,
      allocations: refund.allocations.map(alloc => {
        const returnData = alloc.sale_return || alloc.salex_return;
        return {
          allocation_id: alloc.id,
          return_id: alloc.sale_return_id || alloc.salex_return_id,
          return_type: alloc.sale_return_id ? 'sale' : 'salex',
          type: alloc.sale_return_id ? 'sale' : 'salex',
          credit_note_no: `${alloc.sale_return_id ? 'SR' : 'SXR'}-${String(alloc.sale_return_id || alloc.salex_return_id).padStart(3, '0')}`,
          return_date: returnData?.return_date || 0,
          allocated_amount: Number(alloc.allocated_amount),
          return_total: Number(returnData?.refund_amount || returnData?.total_amount || 0),
          payment_status: returnData?.payment_status || 0,
          payment_status_text: 
            returnData?.payment_status === 0 ? 'Unpaid' :
            returnData?.payment_status === 1 ? 'Fully Refunded' :
            returnData?.payment_status === 2 ? 'Partially Refunded' : 'Unknown',
          allocation_date: alloc.allocation_date,
          notes: alloc.notes
        };
      }),
      summary: {
        refund_amount: Number(refund.refund_amount),
        total_allocated: totalAllocated,
        allocation_count: refund.allocations.length,
        difference: Number(refund.refund_amount) - totalAllocated
      }
    };

    return res.status(200).json({
      success: true,
      data: formattedRefund
    });
  } catch (error) {
    console.error('Error fetching refund details:', error);
    return res.status(500).json({
      error: 'Failed to fetch refund details',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * PUT /api/customer-refunds/[id]
 * Update an existing customer refund
 * ⚡ OPTIMIZED: Queries moved outside transaction
 */
async function handleUpdateRefund(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;
    const {
      refund_amount: rawAmount,
      refund_date: rawDate,
      refund_mode: rawMode,
      refund_type: rawType,
      notes,
      allocations
    } = req.body;
    // Normalised: the form sends a timestamp, other callers a YYYY-MM-DD; mode 0 is cash.
    const refund_amount = Math.round(Number(rawAmount) * 100) / 100;
    const refund_date = rawDate !== undefined && rawDate !== null && rawDate !== '' ? convertDateToTimestamp(rawDate) : rawDate;
    const refund_mode = rawMode === undefined || rawMode === null || rawMode === '' ? rawMode : parseInt(rawMode);

    if (!id) {
      return res.status(400).json({ error: 'Refund ID is required' });
    }

    // Validate required fields
    if (!(refund_amount > 0) || !refund_date || refund_mode === undefined || !Array.isArray(allocations)) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['refund_amount', 'refund_date', 'refund_mode', 'allocations']
      });
    }

    const refundId = parseInt(id as string);

    // ⚡ OPTIMIZATION: Fetch existing refund BEFORE transaction
    const existingRefund = await prisma.customer_refunds.findUnique({
      where: { id: refundId },
      include: {
        allocations: true
      }
    });

    if (!existingRefund) {
      return res.status(404).json({ error: 'Refund not found' });
    }

    // Each allocation names its return's kind (sale / Invoice C ids overlap);
    // a missing kind defaulted to sale.
    const newAllocs: { return_id: number; type: 'sale' | 'salex'; allocated_amount: number; notes: string | null }[] = []
    for (const a of allocations as any[]) {
      const type = a.salex_return_id ? 'salex' : a.sale_return_id ? 'sale' : (a.type || a.return_type)
      if (type !== 'sale' && type !== 'salex') {
        return res.status(400).json({ error: 'Each allocation must say whether it is a sale or an Invoice C return (type)' })
      }
      const rid = parseInt(a.salex_return_id || a.sale_return_id || a.return_id)
      const amt = Number(a.allocated_amount)
      if (!Number.isInteger(rid) || !Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'Each allocation needs a return and an amount above zero' })
      }
      newAllocs.push({ return_id: rid, type, allocated_amount: amt, notes: a.notes || null })
    }
    // On account only (see the create route): an older refund may keep or
    // reduce what it already has on a return, but not add returns or money.
    const had = new Map<string, number>();
    for (const a of existingRefund.allocations) {
      const k = a.sale_return_id ? `sale-${a.sale_return_id}` : `salex-${a.salex_return_id}`;
      had.set(k, (had.get(k) || 0) + Number(a.allocated_amount));
    }
    if (newAllocs.some(a => a.allocated_amount > (had.get(`${a.type}-${a.return_id}`) || 0) + 0.005)) {
      return res.status(400).json({
        error: 'A refund here is on account. To refund a return, open the return and mark it complete.',
        message: 'A refund here is on account. To refund a return, open the return and mark it complete.',
        error_code: 'REFUND_VIA_RETURN'
      })
    }
    if (newAllocs.reduce((s, a) => s + a.allocated_amount, 0) > Number(refund_amount) + 0.005) {
      return res.status(400).json({ error: 'Allocated more than the refund amount' })
    }

    const refund_type = newAllocs.length ? (rawType || existingRefund.refund_type || 'RETURN_SPECIFIC') : 'DIRECT';

    // ⚡ OPTIMIZATION: Prepare handler params OUTSIDE transaction
    const handlerParams = {
      refundId,
      customerId: existingRefund.customer_id,
      oldAmount: Number(existingRefund.refund_amount),
      newAmount: Number(refund_amount),
      oldAllocations: existingRefund.allocations.map(a => ({
        return_id: a.sale_return_id || a.salex_return_id,
        allocated_amount: Number(a.allocated_amount),
        type: a.sale_return_id ? 'sale' : 'salex'
      })),
      newAllocations: newAllocs.map(a => ({
        return_id: a.return_id,
        allocated_amount: a.allocated_amount,
        type: a.type
      })),
      refundMode: refund_mode,
      refundDate: refund_date,
      refundType: refund_type,
      fy: existingRefund.fy
    };

    // Update refund in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Calculate what needs to change using pre-fetched data
      const handlerResult = await require('../../../lib/customer-transaction-handler').customerTransactionHandler.handleCustomerRefundEdit({
        ...handlerParams,
        tx  // Pass tx for any internal queries
      });

      // 2. Update refund record
      const updatedRefund = await tx.customer_refunds.update({
        where: { id: refundId },
        data: {
          refund_amount,
          refund_date,
          refund_mode,
          refund_type,
          notes: notes || null
        }
      });

      // 3. If refund_date changed, sync all related ledger entries
      if (existingRefund.refund_date !== refund_date) {
        await tx.customer_ledger.updateMany({
          where: {
            transaction_id: refundId,
            reference_type: 'refund',
            transaction_type: 'REFUND_PAID'
          },
          data: {
            transaction_date: refund_date,
            payment_date: refund_date
          }
        });
      }

      // 4. ⚡ OPTIMIZATION: Sequential allocation updates (delete then create)
      // Delete old allocations first
      await tx.customer_refund_allocations.deleteMany({
        where: { refund_id: refundId }
      })
      
      // Create new allocations - using createMany for bulk insert
      await tx.customer_refund_allocations.createMany({
        data: newAllocs.map(alloc => ({
          refund_id: refundId,
          sale_return_id: alloc.type === 'sale' ? alloc.return_id : null,
          salex_return_id: alloc.type === 'salex' ? alloc.return_id : null,
          allocated_amount: alloc.allocated_amount,
          allocation_date: refund_date,
          notes: alloc.notes || null
        }))
      });

      // 5. ⚡ OPTIMIZATION: Recalculate return statuses in parallel
      // Every return before and after, by kind (the handler's list was bare
      // ids, destructured here as { returnId, type }: nothing was recalculated).
      const touched = new Map<string, { returnId: number; type: 'sale' | 'salex' }>();
      for (const a of existingRefund.allocations) {
        if (a.sale_return_id) touched.set(`sale-${a.sale_return_id}`, { returnId: a.sale_return_id, type: 'sale' });
        if (a.salex_return_id) touched.set(`salex-${a.salex_return_id}`, { returnId: a.salex_return_id, type: 'salex' });
      }
      for (const a of newAllocs) touched.set(`${a.type}-${a.return_id}`, { returnId: a.return_id, type: a.type });
      const returnsToUpdate = Array.from(touched.values());
      if (returnsToUpdate.length > 0) {
        await Promise.all(
          returnsToUpdate.map(({ returnId, type }) =>
            // recalculateSaleReturnStatus did not exist: every edit that touched a return threw.
            require('../../../lib/payment-allocation-service').recalculateSaleReturnRefundStatus(type, returnId, tx)
          )
        );
      }

      // 6. Execute ledger operations (UPDATE existing or CREATE new)
      if (handlerResult.ledgerUpdates && handlerResult.ledgerUpdates.length > 0) {
        console.log('[REFUND EDIT] Executing ledger UPDATES:', handlerResult.ledgerUpdates.length);
        for (const update of handlerResult.ledgerUpdates) {
          console.log(`[LEDGER UPDATE] ${update.description}`, update.where);
          
          const entries = await tx.customer_ledger.findMany({
            where: update.where,
            select: { id: true, customer_id: true }
          });
          
          if (entries.length === 0) {
            console.warn(`[LEDGER UPDATE] No entries found for update:`, update.where);
            continue;
          }
          
          console.log(`[LEDGER UPDATE] Found ${entries.length} entries to update`);
          
          await tx.customer_ledger.updateMany({
            where: update.where,
            data: update.data
          });
          
          console.log(`[LEDGER UPDATE] Updated entries, now recalculating balances...`);
          
          const firstEntry = entries[0];
          await customerLedgerService.recalculateBalancesAfter(
            firstEntry.customer_id,
            firstEntry.id,
            tx
          );
          
          console.log(`[LEDGER UPDATE] ✅ Successfully updated ${entries.length} entries and recalculated balances`);
        }
      } else if (handlerResult.ledgerOps && handlerResult.ledgerOps.length > 0) {
        console.log('[REFUND EDIT] Creating NEW ledger entries:', handlerResult.ledgerOps.length);
        for (const ledgerOp of handlerResult.ledgerOps) {
          await customerLedgerService.createEntry(ledgerOp.entry, tx);
        }
        console.log('[REFUND EDIT] Ledger entries created');
      } else {
        console.log('[REFUND EDIT] No ledger operations to execute');
      }

      // 7. Update customer balance
      const amountDiff = handlerResult.metadata?.amountDiff || 0;
      const allocDiff = handlerResult.metadata?.allocDiff || 0;

      if (amountDiff !== 0 || allocDiff !== 0) {
        await customerBalanceHandler.incrementBalanceInTransaction(
          tx, 
          existingRefund.customer_id, 
          {
            total_refunded: amountDiff,
            total_refund_allocated: allocDiff
          },
          {
            type: 'refund_issued_edit',
            id: refundId,
            reference_no: `REF-${refundId}`,
            notes: `Refund edited: amount ${amountDiff !== 0 ? `₹${amountDiff > 0 ? '+' : ''}${amountDiff.toFixed(2)}` : 'unchanged'}, allocation ${allocDiff !== 0 ? `₹${allocDiff > 0 ? '+' : ''}${allocDiff.toFixed(2)}` : 'unchanged'}`
          }
        );
      }

      return {
        refund: updatedRefund,
        allocations: allocations
      };
    }, {
      timeout: 45000
    });

    return res.status(200).json({
      success: true,
      message: 'Refund updated successfully',
      data: result
    });
  } catch (error) {
    console.error('Error updating refund:', error);
    return res.status(500).json({
      error: 'Failed to update refund',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * DELETE /api/customer-refunds/[id]
 * Delete a customer refund and reverse all operations
 */
async function handleDeleteRefund(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Refund ID is required' });
    }

    const refundId = parseInt(id as string);

    // Get refund info before deletion
    const refund = await prisma.customer_refunds.findUnique({
      where: { id: refundId },
      select: {
        customer_id: true,
        refund_amount: true,
        refund_type: true
      }
    });

    if (!refund) {
      return res.status(404).json({ error: 'Refund not found' });
    }

    // Get delete operations from handler
    const deleteOps = await require('../../../lib/customer-transaction-handler').customerTransactionHandler.handleRefundDelete({
      refundId,
      customerId: refund.customer_id,
      refundAmount: Number(refund.refund_amount),
      refundType: refund.refund_type || 'RETURN_SPECIFIC'
    });

    // Execute in transaction
    await prisma.$transaction(async (tx) => {
      await require('../../../lib/customer-transaction-handler').customerTransactionHandler.executeDeleteInTransaction(tx, deleteOps);
    }, {
      timeout: 45000
    });

    return res.status(200).json({
      success: true,
      message: 'Refund deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting refund:', error);
    return res.status(500).json({
      error: 'Failed to delete refund',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
