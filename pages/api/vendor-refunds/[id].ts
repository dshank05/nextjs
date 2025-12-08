import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getRefundHistory } from '../../../lib/payment-allocation-service';

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
