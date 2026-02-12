import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import {
  validatePaymentAllocation,
  calculatePaymentStatus
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
    return handleCreatePayment(req, res);
  } else if (req.method === 'GET') {
    return handleListPayments(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * POST /api/vendor-payments
 * Create a new vendor payment with allocations
 */
async function handleCreatePayment(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const {
      vendor_id,
      payment_amount,
      payment_mode,
      payment_date,
      payment_type = 'BILL_SPECIFIC',
      notes,
      allocations,
      fy
    } = req.body;

    // Validate required fields
    if (!vendor_id || !payment_amount || payment_mode === undefined || !payment_date || !allocations) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['vendor_id', 'payment_amount', 'payment_mode', 'payment_date', 'allocations']
      });
    }

    // Convert vendor_id to integer at the start
    const vendorId = parseInt(vendor_id);

    // Validate allocations
    const validation = await validatePaymentAllocation(
      vendorId,
      payment_amount,
      allocations,
      payment_type
    );

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: validation.errors
      });
    }

    // If fy not provided, fetch it from the first purchase allocation
    let financialYear = fy;
    if (!financialYear && allocations.length > 0) {
      const firstPurchase = await prisma.purchase.findUnique({
        where: { id: allocations[0].purchase_id },
        select: { fy: true }
      });
      financialYear = firstPurchase?.fy;
    }

    if (!financialYear) {
      return res.status(400).json({
        error: 'Financial year (fy) is required',
        details: 'Could not determine financial year from purchase'
      });
    }

    // ✅ FIX: Convert payment_date using date-utils to ensure consistent timezone handling
    const paymentTimestamp = convertDateToTimestamp(payment_date);

    // Create payment and allocations in a transaction with extended timeout
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create payment record
      const payment = await tx.vendor_payments.create({
        data: {
          vendor_id: parseInt(vendor_id),
          payment_date: paymentTimestamp,  // ✅ Use converted timestamp
          payment_amount,
          payment_mode,
          payment_type,
          notes,
          fy: financialYear
        }
      });

      // 2. Create allocations and update purchase status
      const createdAllocations = [];
      for (const allocation of allocations) {
        // Create allocation
        const alloc = await tx.payment_allocations.create({
          data: {
            payment_id: payment.id,
            purchase_id: allocation.purchase_id,
            allocated_amount: allocation.allocated_amount,
            allocation_date: paymentTimestamp,  // ✅ Use converted timestamp
            notes: allocation.notes || null
          }
        });
        createdAllocations.push(alloc);

        // Calculate payment status within transaction context
        const purchase = await tx.purchase.findUnique({
          where: { id: allocation.purchase_id },
          select: {
            invoice_no: true,
            total: true
          }
        });

        // Get total allocated to this purchase (including this new allocation)
        const allocationsSum = await tx.payment_allocations.aggregate({
          where: { purchase_id: allocation.purchase_id },
          _sum: { allocated_amount: true }
        });

        const totalPaid = Number(allocationsSum._sum.allocated_amount || 0);
        const totalBill = Number(purchase?.total || 0);

        // Calculate new status
        let newStatus = 0;
        if (totalPaid === 0) {
          newStatus = 0; // Unpaid
        } else if (totalPaid >= totalBill) {
          newStatus = 1; // Fully Paid
        } else {
          newStatus = 2; // Partially Paid
        }

        // Update purchase payment status
        await tx.purchase.update({
          where: { id: allocation.purchase_id },
          data: { payment_status: newStatus }
        });

        // Create ledger entry for this allocation (INSIDE TRANSACTION)
        await ledgerService.createEntry({
          vendor_id: vendorId,
          transaction_date: paymentTimestamp,  // ✅ Use converted timestamp
          transaction_type: 'PAYMENT',
          reference_type: 'purchase',
          reference_id: allocation.purchase_id,
          reference_no: purchase?.invoice_no.toString(),
          payment_mode,
          payment_status: newStatus,
          payment_date: paymentTimestamp,  // ✅ Use converted timestamp
          debit: 0,
          credit: allocation.allocated_amount,
          notes: `Payment ₹${allocation.allocated_amount} for bill INV-${purchase?.invoice_no} via Payment #${payment.id}${newStatus === 2 ? ' (Partial)' : ''}`,
          fy: financialYear,
          transaction_id: payment.id  // ✅ NEW: Store payment ID for deletion tracking
        }, tx);
      }

      // ✅ CREATE LEDGER ENTRIES FOR DIRECT/MIXED UNALLOCATED AMOUNTS
      if (payment_type === 'DIRECT') {
        // Direct payment - create standalone ledger entry
        await ledgerService.createEntry({
          vendor_id: vendorId,
          transaction_date: paymentTimestamp,  // ✅ Use converted timestamp
          transaction_type: 'PAYMENT',
          reference_type: 'payment',
          reference_id: payment.id,
          reference_no: payment.id.toString(),
          payment_mode,
          payment_date: paymentTimestamp,  // ✅ Use converted timestamp
          debit: 0,
          credit: payment_amount,
          notes: `Direct advance payment ₹${payment_amount}`,
          fy: financialYear
        }, tx);

        // Direct payment - no allocations
        await balanceHandler.incrementBalanceInTransaction(tx, vendorId, {
          total_paid: payment_amount
        });
      } else {
        // Bill-specific or mixed payment - has allocations
        const totalAllocated = allocations.reduce((sum: number, a: any) => sum + a.allocated_amount, 0);
        const unallocatedAmount = payment_amount - totalAllocated;

        // If MIXED payment with unallocated amount, create ledger entry
        if (payment_type === 'MIXED' && unallocatedAmount > 0) {
          await ledgerService.createEntry({
            vendor_id: vendorId,
            transaction_date: payment_date,  // ✅ Use converted timestamp
            transaction_type: 'PAYMENT',
            reference_type: 'payment',
            reference_id: payment.id,
            reference_no: payment.id.toString(),
            payment_mode,
            payment_date: payment_date,  // ✅ Use converted timestamp
            debit: 0,
            credit: unallocatedAmount,
    
            fy: financialYear
          }, tx);
        }
        
        await balanceHandler.incrementBalanceInTransaction(tx, vendorId, {
          total_paid: payment_amount,
          total_allocated: totalAllocated
        });
      }

      return {
        payment,
        allocations: createdAllocations
      };
    }, {
      timeout: 45000 // 45 second timeout for payment transactions
    });

    return res.status(201).json({
      success: true,
      message: 'Payment created successfully',
      data: result
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    return res.status(500).json({
      error: 'Failed to create payment',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * GET /api/vendor-payments
 * List vendor payments with filters
 */
async function handleListPayments(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const {
      vendor_id,
      dateFrom,
      dateTo,
      payment_mode,
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
      where.payment_date = {
        gte: startTimestamp,
        lte: endTimestamp
      };
    }

    if (payment_mode !== undefined) {
      where.payment_mode = parseInt(payment_mode as string);
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
    } else if (sortField === 'payment_amount') {
      orderBy = {
        payment_amount: order
      };
    } else if (sortField === 'payment_date') {
      orderBy = {
        payment_date: order
      };
    } else {
      // Default to id
      orderBy = {
        id: order
      };
    }

    // Get total count
    const total = await prisma.vendor_payments.count({ where });

    // Get payments with allocations
    const payments = await prisma.vendor_payments.findMany({
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
            purchase: {
              select: {
                id: true,
                invoice_no: true,
                total: true
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
    const formattedPayments = payments.map(payment => ({
      id: payment.id,
      vendor_id: payment.vendor_id,
      vendor_name: payment.vendor.vendor_name,
      payment_date: payment.payment_date,
      payment_amount: Number(payment.payment_amount),
      payment_mode: payment.payment_mode,
      payment_type: payment.payment_type,
      notes: payment.notes,
      fy: payment.fy,
      created_at: payment.created_at,
      allocations: payment.allocations.map(alloc => ({
        allocation_id: alloc.id,
        purchase_id: alloc.purchase_id,
        invoice_no: alloc.purchase.invoice_no,
        allocated_amount: Number(alloc.allocated_amount),
        purchase_total: Number(alloc.purchase.total),
        notes: alloc.notes
      }))
    }));

    return res.status(200).json({
      success: true,
      data: formattedPayments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error listing payments:', error);
    return res.status(500).json({
      error: 'Failed to list payments',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
