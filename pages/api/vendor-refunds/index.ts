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
import { parseDateRange, convertDateToTimestamp } from '../../../lib/date-utils';

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

    // Convert vendor_id to integer at the start
    const vendorId = parseInt(vendor_id);

    // Validate allocations (pass 'vendor' type for purchase returns)
    const validation = await validateRefundAllocation(
      vendorId,
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

    // ✅ FIX: Convert refund_date using date-utils to ensure consistent timezone handling
    const refundTimestamp = convertDateToTimestamp(refund_date);

    // Create refund and allocations in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create refund record
      const refund = await tx.vendor_refunds.create({
        data: {
          vendor_id: parseInt(vendor_id),
          refund_date: refundTimestamp,  // ✅ Use converted timestamp
          refund_amount,
          refund_mode,
          refund_type,
          notes,
          fy: financialYear
        }
      });

      // 2. ⚡ OPTIMIZED: Parallel allocation processing
      // Create all allocations at once
      await tx.refund_allocations.createMany({
        data: allocations.map(a => ({
          refund_id: refund.id,
          return_id: a.return_id,
          allocated_amount: a.allocated_amount,
          allocation_date: refundTimestamp,  // ✅ Use converted timestamp
          notes: a.notes || null
        }))
      });

      // Batch fetch all affected returns and current allocations
      const returnIds = allocations.map(a => a.return_id);
      const [purchaseReturns, allocSums] = await Promise.all([
        tx.purchase_returns.findMany({
          where: { id: { in: returnIds } },
          select: { id: true, debit_note_no: true, total_amount: true, total_tax: true, refund_amount: true }
        }),
        tx.refund_allocations.groupBy({
          by: ['return_id'],
          where: { return_id: { in: returnIds } },
          _sum: { allocated_amount: true }
        })
      ]);

      // Build lookup maps for O(1) access
      const returnMap = new Map(purchaseReturns.map(r => [r.id, r]));
      const allocMap = new Map(allocSums.map(a => [a.return_id, Number(a._sum.allocated_amount || 0)]));

      // Calculate statuses for all returns
      const statusUpdates = allocations.map(allocation => {
        const purchaseReturn = returnMap.get(allocation.return_id)!;
        const totalRefundedAmount = allocMap.get(allocation.return_id) || 0;
        const totalReturnAmount = purchaseReturn.refund_amount || (purchaseReturn.total_amount + purchaseReturn.total_tax);
        
        const newStatus = totalRefundedAmount >= Number(totalReturnAmount) - 0.01 ? 1 : 
          totalRefundedAmount > 0 ? 2 : 0;
        
        return {
          returnId: allocation.return_id,
          status: newStatus,
          purchaseReturn,
          allocation
        };
      });

      // Execute all updates and ledger entries in parallel
      await Promise.all([
        // Update all return statuses
        ...statusUpdates.map(u => 
          tx.purchase_returns.update({
            where: { id: u.returnId },
            data: { payment_status: u.status }
          })
        ),
        // Create all ledger entries
        ...statusUpdates.map(u => {
          const ledgerNotes = notes?.trim() 
            ? notes 
            : `Refund received ₹${u.allocation.allocated_amount} for return ${u.purchaseReturn.debit_note_no} via Refund #${refund.id}${u.status === 2 ? ' (Partial)' : ''}`;
          
          return ledgerService.createEntry({
            vendor_id: vendorId,
            transaction_date: refundTimestamp,  // ✅ Use converted timestamp
            transaction_type: 'REFUND_RECEIVED',
            reference_type: 'purchase_return',
            reference_id: u.allocation.return_id,
            reference_no: u.purchaseReturn.debit_note_no || undefined,
            payment_mode: refund_mode,
            payment_status: u.status,
            payment_date: refundTimestamp,  // ✅ Use converted timestamp
            debit: u.allocation.allocated_amount,
            credit: 0,
            notes: ledgerNotes,
            fy: financialYear,
            transaction_id: refund.id
          }, tx);
        })
      ]);

      const createdAllocations = allocations; // For response compatibility

      // ✅ CREATE LEDGER ENTRIES FOR DIRECT/MIXED UNALLOCATED AMOUNTS
      if (refund_type === 'DIRECT') {
        // Direct refund - create standalone ledger entry
        // ✅ Use custom notes if provided, otherwise use auto-generated notes
        const directLedgerNotes = notes?.trim() 
          ? notes 
          : `Direct refund received ₹${refund_amount}`;
        
        await ledgerService.createEntry({
          vendor_id: vendorId,
          transaction_date: refundTimestamp,  // ✅ Use converted timestamp
          transaction_type: 'REFUND_RECEIVED',
          reference_type: 'payment',  // ✅ FIX: Use 'payment' so merge works
          reference_id: refund.id,     // ✅ FIX: Use refund ID
          reference_no: refund.id.toString(),
          payment_mode: refund_mode,
          payment_date: refundTimestamp,  // ✅ Use converted timestamp
          debit: refund_amount,
          credit: 0,
          notes: directLedgerNotes,
          fy: financialYear,
          transaction_id: refund.id  // ✅ NEW: Store refund ID for deletion tracking
        }, tx);

        // Direct refund - no allocations
        await balanceHandler.incrementBalanceInTransaction(
          tx, 
          vendorId, 
          { total_refunded: refund_amount },
          {
            type: 'refund_create',
            id: refund.id,
            reference_no: `REF-${refund.id}`,
            notes: `Direct refund: ₹${refund_amount}`
          }
        );
      } else {
        // Return-specific or mixed refund - has allocations
        const totalAllocated = allocations.reduce((sum: number, a: any) => sum + a.allocated_amount, 0);
        const unallocatedAmount = refund_amount - totalAllocated;

        // If MIXED refund with unallocated amount, create ledger entry
        if (refund_type === 'MIXED' && unallocatedAmount > 0) {
          await ledgerService.createEntry({
            vendor_id: vendorId,
            transaction_date: refundTimestamp,  // ✅ Use converted timestamp
            transaction_type: 'REFUND_RECEIVED',
            reference_type: 'payment',  // ✅ FIX: Use 'payment' so merge works
            reference_id: refund.id,     // ✅ FIX: Use refund ID
            reference_no: refund.id.toString(),
            payment_mode: refund_mode,
            payment_date: refundTimestamp,  // ✅ Use converted timestamp
            debit: unallocatedAmount,
            credit: 0,
            notes: `Unallocated refund received ₹${unallocatedAmount} (from Refund #${refund.id})`,
            fy: financialYear,
            transaction_id: refund.id  // ✅ NEW: Store refund ID for deletion tracking
          }, tx);
        }
        
        await balanceHandler.incrementBalanceInTransaction(
          tx, 
          vendorId, 
          {
            total_refunded: refund_amount,
            total_refund_allocated: totalAllocated
          },
          {
            type: 'refund_create',
            id: refund.id,
            reference_no: `REF-${refund.id}`,
            notes: `Refund: ₹${refund_amount} (allocated: ₹${totalAllocated}${unallocatedAmount > 0 ? `, unallocated: ₹${unallocatedAmount}` : ''})`
          }
        );
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

    if (dateFrom && dateTo) {
      const { startTimestamp, endTimestamp } = parseDateRange(
        dateFrom as string,
        dateTo as string
      );
      where.refund_date = {
        gte: startTimestamp,
        lte: endTimestamp
      };
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
