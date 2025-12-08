import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getPaymentHistory } from '../../../lib/payment-allocation-service';

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
