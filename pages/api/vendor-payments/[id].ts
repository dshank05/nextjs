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
 * REFACTORED: Now uses transaction-handler for clean, maintainable code
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

    // Update payment in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch existing payment with allocations
      const existingPayment = await tx.vendor_payments.findUnique({
        where: { id: paymentId },
        include: {
          allocations: true
        }
      });

      if (!existingPayment) {
        throw new Error('Payment not found');
      }

      // 2. Use transaction handler to calculate what needs to change
      const handlerResult = await require('../../../lib/transaction-handler').transactionHandler.handleVendorPaymentEdit({
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
      });

      // 3. Update payment record
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

      // 4. Delete old allocations & create new ones (parallel)
      await tx.payment_allocations.deleteMany({
        where: { payment_id: paymentId }
      });

      const createdAllocations = await Promise.all(
        allocations.map((alloc: any) =>
          tx.payment_allocations.create({
            data: {
              payment_id: paymentId,
              purchase_id: alloc.purchase_id,
              allocated_amount: alloc.allocated_amount,
              allocation_date: payment_date,
              notes: alloc.notes || null
            }
          })
        )
      );

      // 5. Recalculate purchase statuses (parallel)
      await Promise.all(
        handlerResult.purchasesToUpdate.map(purchaseId =>
          require('../../../lib/payment-allocation-service').recalculatePurchaseStatus(purchaseId, tx)
        )
      );

      // 6. Create ledger entry if amount changed
      for (const ledgerOp of handlerResult.ledgerOps) {
        await ledgerService.createEntry(ledgerOp.entry, tx);
      }

      // 7. Update vendor balance
      if (handlerResult.amountDiff !== 0 || handlerResult.allocDiff !== 0) {
        await balanceHandler.incrementBalanceInTransaction(tx, existingPayment.vendor_id, {
          total_paid: handlerResult.amountDiff,
          total_allocated: handlerResult.allocDiff
        });
      }

      return {
        payment: updatedPayment,
        allocations: createdAllocations
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
 * Delete a vendor payment and reverse all operations (POST reversal)
 * REFACTORED: Now uses transaction-handler for clean, maintainable code
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
