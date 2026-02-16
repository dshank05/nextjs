import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { ledgerService } from '../../../lib/ledger-service';
import { balanceHandler } from '../../../lib/balance-handler';

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return handleGetPayment(req, res);
  } else if (req.method === 'PUT') {
    return handleUpdatePayment(req, res);
  } else if (req.method === 'DELETE') {
    return handleDeletePayment(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * GET /api/vendor-payments/[id]
 * Get details of a specific vendor payment
 */
async function handleGetPayment(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }

    const paymentId = parseInt(id as string);

    // Get payment with vendor and allocations
    const payment = await prisma.vendor_payments.findUnique({
      where: { id: paymentId },
      include: {
        vendor: {
          select: {
            id: true,
            vendor_name: true,
            contact_no: true,
            email: true
          }
        },
        allocations: {
          include: {
            purchase: {
              select: {
                id: true,
                invoice_no: true,
                invoice_date: true,
                total: true,
                payment_status: true,
                bill_reference: true
              }
            }
          },
          orderBy: {
            allocation_date: 'desc'
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Calculate total allocated vs payment amount
    const totalAllocated = payment.allocations.reduce(
      (sum, alloc) => sum + Number(alloc.allocated_amount),
      0
    );

    // Format response with detailed allocation info
    const formattedPayment = {
      id: payment.id,
      vendor: {
        id: payment.vendor.id,
        name: payment.vendor.vendor_name,
        contact: payment.vendor.contact_no,
        email: payment.vendor.email
      },
      payment_date: payment.payment_date,
      payment_amount: Number(payment.payment_amount),
      payment_mode: payment.payment_mode,
      payment_mode_text: payment.payment_mode === 0 ? 'Cash' : 'Bank',
      payment_type: payment.payment_type,
      notes: payment.notes,
      fy: payment.fy,
      created_at: payment.created_at,
      updated_at: payment.updated_at,
      allocations: payment.allocations.map(alloc => ({
        allocation_id: alloc.id,
        purchase_id: alloc.purchase_id,
        invoice_no: alloc.purchase.invoice_no,
        invoice_date: alloc.purchase.invoice_date,
        bill_reference: alloc.purchase.bill_reference,
        allocated_amount: Number(alloc.allocated_amount),
        purchase_total: Number(alloc.purchase.total),
        payment_status: alloc.purchase.payment_status,
        payment_status_text:
          alloc.purchase.payment_status === 0 ? 'Unpaid' :
            alloc.purchase.payment_status === 1 ? 'Fully Paid' :
              alloc.purchase.payment_status === 2 ? 'Partially Paid' : 'Unknown',
        allocation_date: alloc.allocation_date,
        notes: alloc.notes
      })),
      summary: {
        payment_amount: Number(payment.payment_amount),
        total_allocated: totalAllocated,
        allocation_count: payment.allocations.length,
        difference: Number(payment.payment_amount) - totalAllocated
      }
    };

    return res.status(200).json({
      success: true,
      data: formattedPayment
    });
  } catch (error) {
    console.error('Error fetching payment details:', error);
    return res.status(500).json({
      error: 'Failed to fetch payment details',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * PUT /api/vendor-payments/[id]
 * Update an existing vendor payment
 * ⚡ OPTIMIZED: Queries moved outside transaction
 */
async function handleUpdatePayment(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;
    const {
      payment_amount,
      payment_date,
      payment_mode,
      payment_type,
      notes,
      allocations
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }

    // Validate required fields
    if (!payment_amount || !payment_date || payment_mode === undefined || !allocations) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['payment_amount', 'payment_date', 'payment_mode', 'allocations']
      });
    }

    const paymentId = parseInt(id as string);

    // ⚡ OPTIMIZATION: Fetch existing payment BEFORE transaction
    const existingPayment = await prisma.vendor_payments.findUnique({
      where: { id: paymentId },
      include: {
        allocations: true
      }
    });

    if (!existingPayment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // ⚡ OPTIMIZATION: Prepare handler params OUTSIDE transaction
    const handlerParams = {
      paymentId,
      vendorId: existingPayment.vendor_id,
      oldAmount: Number(existingPayment.payment_amount),
      newAmount: Number(payment_amount),
      oldAllocations: existingPayment.allocations.map(a => ({
        purchase_id: a.purchase_id,
        allocated_amount: Number(a.allocated_amount)
      })),
      newAllocations: allocations.map((a: any) => ({
        purchase_id: a.purchase_id,
        allocated_amount: Number(a.allocated_amount)
      })),
      paymentMode: payment_mode,
      paymentDate: payment_date,
      paymentType: payment_type,
      fy: existingPayment.fy
    };

    // Update payment in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Calculate what needs to change using pre-fetched data
      console.log('[PAYMENT EDIT] Calling handleVendorPaymentEdit with params:', {
        paymentId,
        vendorId: handlerParams.vendorId,
        oldAmount: handlerParams.oldAmount,
        newAmount: handlerParams.newAmount,
        oldAllocationsCount: handlerParams.oldAllocations.length,
        newAllocationsCount: handlerParams.newAllocations.length
      });
      
      const handlerResult = await require('../../../lib/transaction-handler').transactionHandler.handleVendorPaymentEdit(handlerParams);
      
      console.log('[PAYMENT EDIT] Handler result:', {
        ledgerOps: handlerResult.ledgerOps?.length || 0,
        ledgerCreates: handlerResult.ledgerCreates?.length || 0,
        ledgerUpdates: handlerResult.ledgerUpdates?.length || 0,
        ledgerDeletes: handlerResult.ledgerDeletes?.length || 0,
        balanceOp: handlerResult.balanceOp ? 'yes' : 'no',
        metadata: handlerResult.metadata
      });
      
      if (handlerResult.ledgerUpdates && handlerResult.ledgerUpdates.length > 0) {
        console.log('[PAYMENT EDIT] Ledger updates to execute:', JSON.stringify(handlerResult.ledgerUpdates, null, 2));
      }

      // 2. Update payment record
      console.log('[PAYMENT EDIT] Updating payment record...');
      const updatedPayment = await tx.vendor_payments.update({
        where: { id: paymentId },
        data: {
          payment_amount,
          payment_date,
          payment_mode,
          payment_type,
          notes: notes || null
        }
      });
      console.log('[PAYMENT EDIT] Payment record updated');

      // 3. If payment_date changed, sync all related ledger entries
      if (existingPayment.payment_date !== payment_date) {
        await tx.vendor_ledger.updateMany({
          where: {
            transaction_id: paymentId,
            transaction_type: 'PAYMENT'
          },
          data: {
            transaction_date: payment_date,
            payment_date: payment_date
          }
        });
      }

      // 4. ⚡ OPTIMIZATION: Parallel allocation updates
      await Promise.all([
        // Delete old allocations
        tx.payment_allocations.deleteMany({
          where: { payment_id: paymentId }
        }),
        // Create new allocations - using createMany for bulk insert
        tx.payment_allocations.createMany({
          data: allocations.map((alloc: any) => ({
            payment_id: paymentId,
            purchase_id: alloc.purchase_id,
            allocated_amount: alloc.allocated_amount,
            allocation_date: payment_date,
            notes: alloc.notes || null
          }))
        })
      ]);

      // 5. ⚡ OPTIMIZATION: Recalculate purchase statuses in parallel
      if (handlerResult.metadata?.purchasesToUpdate && handlerResult.metadata.purchasesToUpdate.length > 0) {
        console.log('[PAYMENT EDIT] Recalculating purchase statuses for:', handlerResult.metadata.purchasesToUpdate);
        await Promise.all(
          handlerResult.metadata.purchasesToUpdate.map(purchaseId =>
            require('../../../lib/payment-allocation-service').recalculatePurchaseStatus(purchaseId, tx)
          )
        );
        console.log('[PAYMENT EDIT] Purchase statuses recalculated');
      }

      // 6. ✅ Execute ledger operations (UPDATE existing or CREATE new)
      // For payment edits: Only UPDATES (modify existing PAYMENT ledger entry)
      // For other operations: May have CREATES (new ledger entries)
      if (handlerResult.ledgerUpdates && handlerResult.ledgerUpdates.length > 0) {
        console.log('[PAYMENT EDIT] Executing ledger UPDATES:', handlerResult.ledgerUpdates.length);
        for (const update of handlerResult.ledgerUpdates) {
          console.log(`[LEDGER UPDATE] ${update.description}`, update.where);
          
          // Get entries before update for balance recalculation
          const entries = await tx.vendor_ledger.findMany({
            where: update.where,
            select: { id: true, vendor_id: true }
          });
          
          if (entries.length === 0) {
            console.warn(`[LEDGER UPDATE] No entries found for update:`, update.where);
            continue;
          }
          
          console.log(`[LEDGER UPDATE] Found ${entries.length} entries to update`);
          
          // Execute UPDATE
          await tx.vendor_ledger.updateMany({
            where: update.where,
            data: update.data
          });
          
          console.log(`[LEDGER UPDATE] Updated entries, now recalculating balances...`);
          
          // Recalculate balances after update
          const firstEntry = entries[0];
          await ledgerService.recalculateBalancesAfter(
            firstEntry.vendor_id,
            firstEntry.id,
            tx
          );
          
          console.log(`[LEDGER UPDATE] ✅ Successfully updated ${entries.length} entries and recalculated balances`);
        }
      } else if (handlerResult.ledgerOps && handlerResult.ledgerOps.length > 0) {
        // Fallback: CREATE new entries (shouldn't happen for payment edits, but kept for safety)
        console.log('[PAYMENT EDIT] Creating NEW ledger entries:', handlerResult.ledgerOps.length);
        for (const ledgerOp of handlerResult.ledgerOps) {
          await ledgerService.createEntry(ledgerOp.entry, tx);
        }
        console.log('[PAYMENT EDIT] Ledger entries created');
      } else {
        console.log('[PAYMENT EDIT] No ledger operations to execute');
      }

      // 7. Update vendor balance
      console.log('[PAYMENT EDIT] Updating vendor balance...');
      const amountDiff = handlerResult.metadata?.amountDiff || 0;
      const allocDiff = handlerResult.metadata?.allocDiff || 0;

      console.log('[PAYMENT EDIT] Balance update:', { amountDiff, allocDiff });

      if (amountDiff !== 0 || allocDiff !== 0) {
        await balanceHandler.incrementBalanceInTransaction(
          tx, 
          existingPayment.vendor_id, 
          {
            total_paid: amountDiff,
            total_allocated: allocDiff
          },
          {
            type: 'payment_edit',
            id: paymentId,
            reference_no: `PAY-${paymentId}`,
            notes: `Payment edited: amount ${amountDiff !== 0 ? `₹${amountDiff > 0 ? '+' : ''}${amountDiff.toFixed(2)}` : 'unchanged'}, allocation ${allocDiff !== 0 ? `₹${allocDiff > 0 ? '+' : ''}${allocDiff.toFixed(2)}` : 'unchanged'}`
          }
        );
        console.log('[PAYMENT EDIT] Vendor balance updated');
      } else {
        console.log('[PAYMENT EDIT] No balance update needed');
      }

      console.log('[PAYMENT EDIT] ✅ Transaction complete');

      return {
        payment: updatedPayment,
        allocations: allocations
      };
    }, {
      timeout: 45000
    });

    return res.status(200).json({
      success: true,
      message: 'Payment updated successfully',
      data: result
    });
  } catch (error) {
    console.error('Error updating payment:', error);
    return res.status(500).json({
      error: 'Failed to update payment',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * DELETE /api/vendor-payments/[id]
 * Delete a vendor payment and reverse all operations
 */
async function handleDeletePayment(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }

    const paymentId = parseInt(id as string);

    // Get payment info before deletion
    const payment = await prisma.vendor_payments.findUnique({
      where: { id: paymentId },
      select: {
        vendor_id: true,
        payment_amount: true,
        payment_type: true
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Get delete operations from handler
    const deleteOps = await require('../../../lib/transaction-handler').transactionHandler.handlePaymentDelete({
      paymentId,
      vendorId: payment.vendor_id,
      paymentAmount: Number(payment.payment_amount),
      paymentType: payment.payment_type || 'BILL_SPECIFIC'
    });

    // Execute in transaction
    await prisma.$transaction(async (tx) => {
      await require('../../../lib/transaction-handler').transactionHandler.executeDeleteInTransaction(tx, deleteOps);
    }, {
      timeout: 45000
    });

    return res.status(200).json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting payment:', error);
    return res.status(500).json({
      error: 'Failed to delete payment',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
