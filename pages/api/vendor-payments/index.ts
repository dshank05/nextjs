import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { checkPaymentAllocations } from '../../../lib/payment-allocations';
import { answerError } from '../../../lib/api/sale-routes';
import { SaleError } from '../../../lib/sale';
import { ledgerService } from '../../../lib/ledger-service';
import { balanceHandler } from '../../../lib/balance-handler';
import { parseDateRange, convertDateToTimestamp } from '../../../lib/date-utils';
import { getCurrentFinancialYear } from '../../../lib/financial-year'


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

    // Checked against what is left on each purchase (other payments counted)
    // and its vendor; the type follows from them. This ran the customer
    // validator, which looks for invoice ids and so checked nothing here.
    const checked = await checkPaymentAllocations(prisma, 'vendor', vendorId, payment_amount, allocations, { requestedType: payment_type })
    const amount = checked.amount
    const paymentType = checked.paymentType
    const allocs = checked.allocations.map(a => ({ purchase_id: a.id, allocated_amount: a.amount, notes: a.notes }))

    // F-01: financial year comes from Settings, never from the client and never
    // inherited from the allocated document. A payment made in the open period
    // belongs to that period, even when it settles an older bill.
    const financialYear = await getCurrentFinancialYear()

    // ✅ FIX: Convert payment_date using date-utils to ensure consistent timezone handling
    const paymentTimestamp = convertDateToTimestamp(payment_date);

    // Create payment and allocations in a transaction with extended timeout
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create payment record
      const payment = await tx.vendor_payments.create({
        data: {
          vendor_id: parseInt(vendor_id),
          payment_date: paymentTimestamp,  // ✅ Use converted timestamp
          payment_amount: amount,
          payment_mode,
          payment_type: paymentType,
          notes,
          fy: financialYear
        }
      });

      // 2. ⚡ OPTIMIZED: Parallel allocation processing
      // Create all allocs at once
      await tx.payment_allocations.createMany({
        data: allocs.map(a => ({
          payment_id: payment.id,
          purchase_id: a.purchase_id,
          allocated_amount: a.allocated_amount,
          allocation_date: paymentTimestamp,
          notes: a.notes || null
        }))
      });

      // Batch fetch all affected purchases and current allocs
      const purchaseIds = allocs.map(a => a.purchase_id);
      const [purchases, allocSums] = await Promise.all([
        tx.purchase.findMany({
          where: { id: { in: purchaseIds } },
          select: { id: true, invoice_no: true, total: true }
        }),
        tx.payment_allocations.groupBy({
          by: ['purchase_id'],
          where: { purchase_id: { in: purchaseIds } },
          _sum: { allocated_amount: true }
        })
      ]);

      // Build lookup maps for O(1) access
      const purchaseMap = new Map(purchases.map(p => [p.id, p]));
      const allocMap = new Map(allocSums.map(a => [a.purchase_id, Number(a._sum.allocated_amount || 0)]));

      // Calculate statuses for all purchases
      const statusUpdates = allocs.map(allocation => {
        const purchase = purchaseMap.get(allocation.purchase_id)!;
        const totalPaid = allocMap.get(allocation.purchase_id) || 0;
        const totalBill = Number(purchase.total);
        
        const newStatus = totalPaid === 0 ? 0 : 
          totalPaid >= totalBill ? 1 : 2;
        
        return {
          purchaseId: allocation.purchase_id,
          status: newStatus,
          purchase,
          allocation
        };
      });

      // Execute all purchase status updates in parallel
      await Promise.all(
        statusUpdates.map(u => 
          tx.purchase.update({
            where: { id: u.purchaseId },
            data: { payment_status: u.status }
          })
        )
      );

      const createdAllocations = allocs;
      const totalAllocated = allocs.reduce((sum: number, a: any) => sum + a.allocated_amount, 0);
      const unallocatedAmount = amount - totalAllocated;

      if (paymentType === 'DIRECT') {
        const directLedgerNotes = notes?.trim() 
          ? notes 
          : `Direct advance payment ₹${amount}`;
        
        await ledgerService.createEntry({
          vendor_id: vendorId,
          transaction_date: paymentTimestamp,
          transaction_type: 'PAYMENT',
          reference_type: 'payment',
          reference_id: payment.id,
          reference_no: payment.id.toString(),
          payment_mode,
          payment_date: paymentTimestamp,
          debit: 0,
          credit: amount,
          notes: directLedgerNotes,
          fy: financialYear,
          transaction_id: payment.id
        }, tx);

        await balanceHandler.incrementBalanceInTransaction(
          tx, 
          vendorId, 
          { total_paid: amount },
          {
            type: 'payment_create',
            id: payment.id,
            reference_no: `PAY-${payment.id}`,
            notes: `Direct payment: ₹${amount}`
          }
        );
      } else if (paymentType === 'MIXED') {
        const mixedLedgerNotes = notes?.trim()
          ? notes
          : `Payment ₹${amount} (₹${totalAllocated} allocated, ₹${unallocatedAmount} advance)`;
        
        await ledgerService.createEntry({
          vendor_id: vendorId,
          transaction_date: paymentTimestamp,
          transaction_type: 'PAYMENT',
          reference_type: 'payment',
          reference_id: payment.id,
          reference_no: payment.id.toString(),
          payment_mode,
          payment_date: paymentTimestamp,
          debit: 0,
          credit: amount,
          notes: mixedLedgerNotes,
          fy: financialYear,
          transaction_id: payment.id
        }, tx);
        
        await balanceHandler.incrementBalanceInTransaction(
          tx, 
          vendorId, 
          {
            total_paid: amount,
            total_allocated: totalAllocated
          },
          {
            type: 'payment_create',
            id: payment.id,
            reference_no: `PAY-${payment.id}`,
            notes: `Payment: ₹${amount} (allocated: ₹${totalAllocated}, advance: ₹${unallocatedAmount})`
          }
        );
      } else {
        // One after another (2026-10-03): each entry's stored running balance starts
        // from the latest row, so entries written together all read the same one.
        for (const u of statusUpdates) {
            const ledgerNotes = notes?.trim() 
              ? notes 
              : `Payment ₹${u.allocation.allocated_amount} for bill INV-${u.purchase.invoice_no} via Payment #${payment.id}${u.status === 2 ? ' (Partial)' : ''}`;
            
            await ledgerService.createEntry({
              vendor_id: vendorId,
              transaction_date: paymentTimestamp,
              transaction_type: 'PAYMENT',
              reference_type: 'purchase',
              reference_id: u.allocation.purchase_id,
              reference_no: u.purchase.invoice_no.toString(),
              payment_mode,
              payment_status: u.status,
              payment_date: paymentTimestamp,
              debit: 0,
              credit: u.allocation.allocated_amount,
              notes: ledgerNotes,
              fy: financialYear,
              transaction_id: payment.id
            }, tx);
        }
        
        await balanceHandler.incrementBalanceInTransaction(
          tx, 
          vendorId, 
          {
            total_paid: amount,
            total_allocated: totalAllocated
          },
          {
            type: 'payment_create',
            id: payment.id,
            reference_no: `PAY-${payment.id}`,
            notes: `Payment: ₹${amount} (allocated: ₹${totalAllocated})`
          }
        );
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
    if (error instanceof SaleError) return answerError(res, error, 'create the payment');
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
