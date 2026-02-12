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
 * GET /api/vendor-refunds/[id]
 * Get details of a specific vendor refund
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

    // Get refund with vendor and allocations
    const refund = await prisma.vendor_refunds.findUnique({
      where: { id: refundId },
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
            return: {
              select: {
                id: true,
                debit_note_no: true,
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
      vendor: {
        id: refund.vendor.id,
        name: refund.vendor.vendor_name,
        contact: refund.vendor.contact_no,
        email: refund.vendor.email
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
      allocations: refund.allocations.map(alloc => ({
        allocation_id: alloc.id,
        return_id: alloc.return_id,
        debit_note_no: alloc.return.debit_note_no,
        return_date: alloc.return.return_date,
        allocated_amount: Number(alloc.allocated_amount),
        return_total: Number(alloc.return.refund_amount || alloc.return.total_amount),
        payment_status: alloc.return.payment_status,
        payment_status_text: 
          alloc.return.payment_status === 0 ? 'Unpaid' :
          alloc.return.payment_status === 1 ? 'Fully Refunded' :
          alloc.return.payment_status === 2 ? 'Partially Refunded' : 'Unknown',
        allocation_date: alloc.allocation_date,
        notes: alloc.notes
      })),
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
 * PUT /api/vendor-refunds/[id]
 * Update an existing vendor refund
 * REFACTORED: Now uses transaction-handler for clean, maintainable code
 */
async function handleUpdateRefund(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;
    const {
      refund_amount,
      refund_date,
      refund_mode,
      refund_type,
      notes,
      allocations
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Refund ID is required' });
    }

    // Validate required fields
    if (!refund_amount || !refund_date || refund_mode === undefined || !allocations) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['refund_amount', 'refund_date', 'refund_mode', 'allocations']
      });
    }

    const refundId = parseInt(id as string);

    // Update refund in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch existing refund with allocations
      const existingRefund = await tx.vendor_refunds.findUnique({
        where: { id: refundId },
        include: {
          allocations: true
        }
      });

      if (!existingRefund) {
        throw new Error('Refund not found');
      }

      // 2. Use transaction handler to calculate what needs to change
      const handlerResult = await require('../../../lib/transaction-handler').transactionHandler.handleVendorRefundEdit({
        refundId,
        vendorId: existingRefund.vendor_id,
        oldAmount: Number(existingRefund.refund_amount),
        newAmount: Number(refund_amount),
        oldAllocations: existingRefund.allocations.map(a => ({
          return_id: a.return_id,
          allocated_amount: Number(a.allocated_amount)
        })),
        newAllocations: allocations.map((a: any) => ({
          return_id: a.return_id,
          allocated_amount: Number(a.allocated_amount)
        })),
        refundMode: refund_mode,
        refundDate: refund_date,
        refundType: refund_type,
        fy: existingRefund.fy,
        tx  // ✅ Pass transaction context for querying existing entry
      });

      // 3. Update refund record
      const updatedRefund = await tx.vendor_refunds.update({
        where: { id: refundId },
        data: {
          refund_amount,
          refund_date,
          refund_mode,
          refund_type,
          notes: notes || null
        }
      });

      // ✅ Issue 5 FIX: If refund_date changed, sync all related ledger entries
      if (existingRefund.refund_date !== refund_date) {
        await tx.vendor_ledger.updateMany({
          where: {
            transaction_id: refundId,
            transaction_type: { in: ['REFUND_RECEIVED', 'REFUND_ADJUSTMENT'] }
          },
          data: {
            transaction_date: refund_date,
            payment_date: refund_date
          }
        });
      }

      // 4. Delete old allocations & create new ones (parallel)
      await tx.refund_allocations.deleteMany({
        where: { refund_id: refundId }
      });

      const createdAllocations = await Promise.all(
        allocations.map((alloc: any) =>
          tx.refund_allocations.create({
            data: {
              refund_id: refundId,
              return_id: alloc.return_id,
              allocated_amount: alloc.allocated_amount,
              allocation_date: refund_date,
              notes: alloc.notes || null
            }
          })
        )
      );

      // 5. Recalculate return statuses (parallel)
      await Promise.all(
        handlerResult.returnsToUpdate.map(returnId =>
          require('../../../lib/payment-allocation-service').recalculatePurchaseReturnStatus(returnId, tx)
        )
      );

      // 6. Create ledger entry if amount changed (currently no-op, see handler)
      for (const ledgerOp of handlerResult.ledgerOps) {
        await ledgerService.createEntry(ledgerOp.entry, tx);
      }

      // 7. Update vendor balance
      if (handlerResult.amountDiff !== 0 || handlerResult.allocDiff !== 0) {
        await balanceHandler.incrementBalanceInTransaction(tx, existingRefund.vendor_id, {
          total_refunded: handlerResult.amountDiff,
          total_refund_allocated: handlerResult.allocDiff
        });
      }

      return {
        refund: updatedRefund,
        allocations: createdAllocations
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
 * DELETE /api/vendor-refunds/[id]
 * Delete a vendor refund and reverse all operations (POST reversal)
 * REFACTORED: Now uses transaction-handler for clean, maintainable code
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
    const refund = await prisma.vendor_refunds.findUnique({
      where: { id: refundId },
      select: {
        vendor_id: true,
        refund_amount: true,
        refund_type: true
      }
    });

    if (!refund) {
      return res.status(404).json({ error: 'Refund not found' });
    }

    // Get delete operations from handler
    const deleteOps = await require('../../../lib/transaction-handler').transactionHandler.handleRefundDelete({
      refundId,
      vendorId: refund.vendor_id,
      refundAmount: Number(refund.refund_amount),
      refundType: refund.refund_type || 'RETURN_SPECIFIC'
    });

    // Execute in transaction
    await prisma.$transaction(async (tx) => {
      await require('../../../lib/transaction-handler').transactionHandler.executeDeleteInTransaction(tx, deleteOps);
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
