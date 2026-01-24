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

      // 2. Calculate differences
      const oldAmount = Number(existingPayment.payment_amount);
      const newAmount = Number(payment_amount);
      const amountDiff = newAmount - oldAmount;

      // Get old and new allocation purchase IDs
      const oldAllocations = existingPayment.allocations;
      const oldAllocMap = new Map(oldAllocations.map(a => [a.purchase_id, Number(a.allocated_amount)]));
      const newAllocMap = new Map(allocations.map((a: any) => [a.purchase_id, Number(a.allocated_amount)]));

      const allPurchaseIds = new Set([
        ...Array.from(oldAllocMap.keys()), 
        ...Array.from(newAllocMap.keys())
      ]);

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

      // 4. Delete all existing allocations
      await tx.payment_allocations.deleteMany({
        where: { payment_id: paymentId }
      });

      // 5. Create new allocations
      const createdAllocations = [];
      for (const alloc of allocations) {
        const newAlloc = await tx.payment_allocations.create({
          data: {
            payment_id: paymentId,
            purchase_id: alloc.purchase_id,
            allocated_amount: alloc.allocated_amount,
            allocation_date: payment_date,
            notes: alloc.notes || null
          }
        });
        createdAllocations.push(newAlloc);
      }

      // 6. Recalculate payment_status for all affected purchases
      for (const purchaseId of Array.from(allPurchaseIds) as number[]) {
        const purchase = await tx.purchase.findUnique({
          where: { id: purchaseId },
          select: { total: true, invoice_no: true }
        });

        if (!purchase) continue;

        // Get total allocated to this purchase
        const allocSum = await tx.payment_allocations.aggregate({
          where: { purchase_id: purchaseId },
          _sum: { allocated_amount: true }
        });

        const totalAllocated = Number(allocSum._sum.allocated_amount || 0);
        const totalBill = Number(purchase.total);

        // Calculate new payment status
        let newStatus: number = 0; // Unpaid
        if (totalAllocated === 0) {
          newStatus = 0;
        } else if (totalAllocated >= totalBill - 0.01) {
          newStatus = 1; // Fully Paid
        } else {
          newStatus = 2; // Partially Paid
        }

        // Update purchase payment status
        await tx.purchase.update({
          where: { id: purchaseId as number },
          data: { payment_status: newStatus }
        });

        // Create ledger adjustment entry for this allocation change
        const oldAlloc: number = Number(oldAllocMap.get(purchaseId) || 0);
        const newAlloc: number = Number(newAllocMap.get(purchaseId) || 0);
        const allocDiff = newAlloc - oldAlloc;

        if (allocDiff !== 0) {
          await ledgerService.createEntry({
            vendor_id: existingPayment.vendor_id,
            transaction_date: payment_date,
            transaction_type: 'PAYMENT_ADJUSTMENT',
            reference_type: 'purchase',
            reference_id: purchaseId,
            reference_no: purchase.invoice_no.toString(),
            payment_mode,
            payment_status: newStatus,
            payment_date,
            debit: 0,
            credit: Math.abs(allocDiff),
            notes: `Payment adjustment for INV-${purchase.invoice_no}: ${allocDiff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(allocDiff).toFixed(2)} (Payment #${paymentId} edit)`,
            fy: existingPayment.fy
          }, tx);
        }
      }

      // 7. Calculate total allocation change for balance update
      const oldTotalAllocated = oldAllocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      const newTotalAllocated = allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0);
      const allocDiff = newTotalAllocated - oldTotalAllocated;

      // 8. Update vendor balance
      if (amountDiff !== 0 || allocDiff !== 0) {
        await balanceHandler.incrementBalanceInTransaction(tx, existingPayment.vendor_id, {
          total_paid: amountDiff,
          total_allocated: allocDiff
        });
      }

      return {
        payment: updatedPayment,
        allocations: createdAllocations
      };
    }, {
      timeout: 45000 // 45 seconds
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
