import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import {
  validateRefundAllocation,
  calculateRefundStatus
} from '../../../lib/payment-allocation-service';
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

  if (req.method === 'POST') {
    return handleCreateRefund(req, res);
  } else if (req.method === 'GET') {
    return handleListRefunds(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * POST /api/vendor-refunds
 * Create a new vendor refund with allocations
 */
async function handleCreateRefund(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const {
      vendor_id,
      refund_amount,
      refund_mode,
      refund_date,
      refund_type = 'RETURN_SPECIFIC',
      notes,
      allocations,
      fy
    } = req.body;

    // Validate required fields
    if (!vendor_id || !refund_amount || refund_mode === undefined || !refund_date || !allocations) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['vendor_id', 'refund_amount', 'refund_mode', 'refund_date', 'allocations']
      });
    }

    // Validate allocations (pass 'vendor' type for purchase returns)
    const validation = await validateRefundAllocation(
      vendor_id,
      refund_amount,
      allocations,
      'vendor', // Flag to identify vendor returns
      refund_type
    );

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: validation.errors
      });
    }

    // If fy not provided, fetch it from the first return allocation
    let financialYear = fy;
    if (!financialYear && allocations.length > 0) {
      const firstReturn = await prisma.purchase_returns.findUnique({
        where: { id: allocations[0].return_id },
        select: { fy: true }
      });
      financialYear = firstReturn?.fy;
    }

    // Create refund and allocations in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create refund record
      const refund = await tx.vendor_refunds.create({
        data: {
          vendor_id,
          refund_date,
          refund_amount,
          refund_mode,
          refund_type,
          notes,
          fy: financialYear
        }
      });

      // 2. Create allocations and update return status
      const createdAllocations = [];
      for (const allocation of allocations) {
        // Create allocation
        const alloc = await tx.refund_allocations.create({
          data: {
            refund_id: refund.id,
            return_id: allocation.return_id,
            allocated_amount: allocation.allocated_amount,
            allocation_date: refund_date,
            notes: allocation.notes || null
          }
        });
        createdAllocations.push(alloc);

        // Get return details
        const purchaseReturn = await tx.purchase_returns.findUnique({
          where: { id: allocation.return_id },
          select: {
            debit_note_no: true,
            total_amount: true,
            total_tax: true,
            refund_amount: true
          }
        });

        // Calculate total refunded for this return (using tx client)
        const totalRefunded = await tx.refund_allocations.aggregate({
          where: { return_id: allocation.return_id },
          _sum: { allocated_amount: true }
        });

        const totalRefundedAmount = Number(totalRefunded._sum.allocated_amount || 0);
        const totalReturnAmount = purchaseReturn?.refund_amount || (purchaseReturn ? purchaseReturn.total_amount + purchaseReturn.total_tax : 0);

        // Calculate new status
        let newStatus = 0; // Unpaid
        if (totalRefundedAmount >= totalReturnAmount - 0.01) {
          newStatus = 1; // Fully refunded
        } else if (totalRefundedAmount > 0) {
          newStatus = 2; // Partially refunded
        }

        // Update return refund status
        await tx.purchase_returns.update({
          where: { id: allocation.return_id },
          data: { payment_status: newStatus }
        });

        // Create ledger entry for this allocation (INSIDE TRANSACTION)
        await ledgerService.createEntry({
          vendor_id,
          transaction_date: refund_date,
          transaction_type: 'REFUND_RECEIVED',
          reference_type: 'purchase_return',
          reference_id: allocation.return_id,
          reference_no: purchaseReturn?.debit_note_no || undefined,
          payment_mode: refund_mode,
          payment_status: newStatus,
          payment_date: refund_date,
          debit: allocation.allocated_amount,
          credit: 0,
          notes: `Refund received ₹${allocation.allocated_amount} for return ${purchaseReturn?.debit_note_no} via Refund #${refund.id}${newStatus === 2 ? ' (Partial)' : ''}`,
          fy: financialYear
        }, tx);
      }

      // ✅ MOVE BALANCE UPDATE INSIDE TRANSACTION
      if (refund_type === 'DIRECT') {
        // Direct refund - no allocations
        await balanceHandler.incrementBalanceInTransaction(tx, vendor_id, {
          total_refunded: refund_amount
        });
      } else {
        // Return-specific or mixed refund - has allocations
        const totalAllocated = allocations.reduce((sum: number, a: any) => sum + a.allocated_amount, 0);
        
        await balanceHandler.incrementBalanceInTransaction(tx, vendor_id, {
          total_refunded: refund_amount,
          total_refund_allocated: totalAllocated
        });
      }

      return {
        refund,
        allocations: createdAllocations
      };
    }, {
      timeout: 45000 // 45 seconds timeout for refund transactions
    });

    return res.status(201).json({
      success: true,
      message: 'Refund created successfully',
      data: result
    });
  } catch (error) {
    console.error('Error creating refund:', error);
    return res.status(500).json({
      error: 'Failed to create refund',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * GET /api/vendor-refunds
 * List vendor refunds with filters
 */
async function handleListRefunds(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const {
      vendor_id,
      dateFrom,
      dateTo,
      refund_mode,
      page = '1',
      limit = '50',
      sortBy = 'id',
      sortOrder = 'asc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (vendor_id) {
      where.vendor_id = parseInt(vendor_id as string);
    }

    if (dateFrom || dateTo) {
      where.refund_date = {};
      if (dateFrom) {
        const startDate = new Date(dateFrom as string);
        startDate.setHours(0, 0, 0, 0);
        where.refund_date.gte = Math.floor(startDate.getTime() / 1000);
      }
      if (dateTo) {
        const endDate = new Date(dateTo as string);
        endDate.setHours(23, 59, 59, 999);  // ✅ End of day
        where.refund_date.lte = Math.floor(endDate.getTime() / 1000);
      }
    }

    if (refund_mode !== undefined) {
      where.refund_mode = parseInt(refund_mode as string);
    }

    // Build orderBy clause
    let orderBy: any = {};
    const sortField = sortBy as string;
    const order = sortOrder as string;

    if (sortField === 'vendor_name') {
      orderBy = {
        vendor: {
          vendor_name: order
        }
      };
    } else if (sortField === 'refund_amount') {
      orderBy = {
        refund_amount: order
      };
    } else if (sortField === 'refund_date') {
      orderBy = {
        refund_date: order
      };
    } else {
      // Default to id
      orderBy = {
        id: order
      };
    }

    // Get total count
    const total = await prisma.vendor_refunds.count({ where });

    // Get refunds with allocations
    const refunds = await prisma.vendor_refunds.findMany({
      where,
      include: {
        vendor: {
          select: {
            id: true,
            vendor_name: true
          }
        },
        allocations: {
          include: {
            return: {
              select: {
                id: true,
                debit_note_no: true,
                total_amount: true,
                refund_amount: true
              }
            }
          }
        }
      },
      orderBy,
      skip,
      take: limitNum
    });

    // Format response
    const formattedRefunds = refunds.map(refund => ({
      id: refund.id,
      vendor_id: refund.vendor_id,
      vendor_name: refund.vendor.vendor_name,
      refund_date: refund.refund_date,
      refund_amount: Number(refund.refund_amount),
      refund_mode: refund.refund_mode,
      refund_type: refund.refund_type,
      notes: refund.notes,
      fy: refund.fy,
      created_at: refund.created_at,
      allocations: refund.allocations.map(alloc => ({
        allocation_id: alloc.id,
        return_id: alloc.return_id,
        debit_note_no: alloc.return.debit_note_no,
        allocated_amount: Number(alloc.allocated_amount),
        return_total: Number(alloc.return.refund_amount || alloc.return.total_amount),
        notes: alloc.notes
      }))
    }));

    return res.status(200).json({
      success: true,
      data: formattedRefunds,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error listing refunds:', error);
    return res.status(500).json({
      error: 'Failed to list refunds',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
