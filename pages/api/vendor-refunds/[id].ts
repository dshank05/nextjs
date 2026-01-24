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

      // 2. Calculate differences
      const oldAmount = Number(existingRefund.refund_amount);
      const newAmount = Number(refund_amount);
      const amountDiff = newAmount - oldAmount;

      // Get old and new allocation return IDs
      const oldAllocations = existingRefund.allocations;
      const oldAllocMap = new Map(oldAllocations.map(a => [a.return_id, Number(a.allocated_amount)]));
      const newAllocMap = new Map(allocations.map((a: any) => [a.return_id, Number(a.allocated_amount)]));

      const allReturnIds = new Set([
        ...Array.from(oldAllocMap.keys()), 
        ...Array.from(newAllocMap.keys())
      ]);

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

      // 4. Delete all existing allocations
      await tx.refund_allocations.deleteMany({
        where: { refund_id: refundId }
      });

      // 5. Create new allocations
      const createdAllocations = [];
      for (const alloc of allocations) {
        const newAlloc = await tx.refund_allocations.create({
          data: {
            refund_id: refundId,
            return_id: alloc.return_id,
            allocated_amount: alloc.allocated_amount,
            allocation_date: refund_date,
            notes: alloc.notes || null
          }
        });
        createdAllocations.push(newAlloc);
      }

      // 6. Recalculate payment_status for all affected returns
      for (const returnId of Array.from(allReturnIds)) {
        const purchaseReturn = await tx.purchase_returns.findUnique({
          where: { id: returnId as number },
          select: { 
            total_amount: true, 
            total_tax: true,
            refund_amount: true,
            debit_note_no: true 
          }
        });

        if (!purchaseReturn) continue;

        // Get total refunded for this return
        const refundSum = await tx.refund_allocations.aggregate({
          where: { return_id: returnId },
          _sum: { allocated_amount: true }
        });

        const totalRefunded = Number(refundSum._sum.allocated_amount || 0);
        const totalReturnAmount = Number(purchaseReturn.refund_amount || (purchaseReturn.total_amount + purchaseReturn.total_tax));

        // Calculate new payment status
        let newStatus: number = 0; // Unpaid
        if (totalRefunded === 0) {
          newStatus = 0;
        } else if (totalRefunded >= totalReturnAmount - 0.01) {
          newStatus = 1; // Fully Refunded
        } else {
          newStatus = 2; // Partially Refunded
        }

        // Update return payment status
        await tx.purchase_returns.update({
          where: { id: returnId as number },
          data: { payment_status: newStatus }
        });

        // Create ledger adjustment entry for this allocation change
        const oldAlloc: number = Number(oldAllocMap.get(returnId as number) || 0);
        const newAlloc: number = Number(newAllocMap.get(returnId as number) || 0);
        const allocDiff = newAlloc - oldAlloc;

        if (allocDiff !== 0) {
          await ledgerService.createEntry({
            vendor_id: existingRefund.vendor_id,
            transaction_date: refund_date,
            transaction_type: 'PAYMENT_ADJUSTMENT',
            reference_type: 'purchase_return',
            reference_id: returnId as number,
            reference_no: purchaseReturn.debit_note_no || undefined,
            payment_mode: refund_mode,
            payment_status: newStatus,
            payment_date: refund_date,
            debit: Math.abs(allocDiff),
            credit: 0,
            notes: `Refund adjustment for ${purchaseReturn.debit_note_no}: ${allocDiff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(allocDiff).toFixed(2)} (Refund #${refundId} edit)`,
            fy: existingRefund.fy
          }, tx);
        }
      }

      // 7. Calculate total allocation change for balance update
      const oldTotalAllocated = oldAllocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      const newTotalAllocated = allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0);
      const allocDiff = newTotalAllocated - oldTotalAllocated;

      // 8. Update vendor balance
      if (amountDiff !== 0 || allocDiff !== 0) {
        await balanceHandler.incrementBalanceInTransaction(tx, existingRefund.vendor_id, {
          total_refunded: amountDiff,
          total_refund_allocated: allocDiff
        });
      }

      return {
        refund: updatedRefund,
        allocations: createdAllocations
      };
    }, {
      timeout: 45000 // 45 seconds
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
