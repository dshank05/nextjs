import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

const prisma = new PrismaClient();

interface UnifiedTransaction {
  id: number;
  transaction_type: 'EXPENSE' | 'INCOME';
  vendor_id: number;
  vendor_name: string;
  date: number;
  amount: number;
  payment_mode: number;
  payment_type: string;
  notes: string | null;
  invoice_numbers: string[];
  allocations_count: number;
  fy: number;
  created_at: Date;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return handleListTransactions(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * GET /api/vendor-transactions
 * List vendor transactions (payments + refunds combined) with filters
 */
async function handleListTransactions(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const {
      vendor_id,
      dateFrom,
      dateTo,
      payment_mode,
      payment_type,
      type = 'all', // 'all', 'expense', 'income'
      page = '1',
      limit = '50',
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    // Build where clauses for both queries
    const baseWhere: any = {};

    if (vendor_id) {
      baseWhere.vendor_id = parseInt(vendor_id as string);
    }

    if (payment_mode !== undefined && payment_mode !== '') {
      baseWhere.payment_mode = parseInt(payment_mode as string);
    }

    // Fetch expenses (vendor payments) if needed
    let expenses: UnifiedTransaction[] = [];
    if (type === 'all' || type === 'expense') {
      const expenseWhere = { ...baseWhere };
      
      if (dateFrom || dateTo) {
        expenseWhere.payment_date = {};
        if (dateFrom) {
          expenseWhere.payment_date.gte = parseInt(dateFrom as string);
        }
        if (dateTo) {
          expenseWhere.payment_date.lte = parseInt(dateTo as string);
        }
      }

      if (payment_type) {
        expenseWhere.payment_type = payment_type as string;
      }

      const payments = await prisma.vendor_payments.findMany({
        where: expenseWhere,
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
                  invoice_no: true
                }
              }
            }
          }
        }
      });

      expenses = payments.map(payment => ({
        id: payment.id,
        transaction_type: 'EXPENSE' as const,
        vendor_id: payment.vendor_id,
        vendor_name: payment.vendor.vendor_name,
        date: payment.payment_date,
        amount: Number(payment.payment_amount),
        payment_mode: payment.payment_mode,
        payment_type: payment.payment_type || 'BILL_SPECIFIC',
        notes: payment.notes,
        invoice_numbers: payment.allocations.map(a => `INV-${a.purchase.invoice_no}`),
        allocations_count: payment.allocations.length,
        fy: payment.fy,
        created_at: payment.created_at
      }));
    }

    // Fetch income (vendor refunds) if needed
    let incomes: UnifiedTransaction[] = [];
    if (type === 'all' || type === 'income') {
      const incomeWhere = { ...baseWhere };
      
      if (dateFrom || dateTo) {
        incomeWhere.refund_date = {};
        if (dateFrom) {
          incomeWhere.refund_date.gte = parseInt(dateFrom as string);
        }
        if (dateTo) {
          incomeWhere.refund_date.lte = parseInt(dateTo as string);
        }
      }

      if (payment_type) {
        incomeWhere.refund_type = payment_type as string;
      }

      const refunds = await prisma.vendor_refunds.findMany({
        where: incomeWhere,
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
                  debit_note_no: true
                }
              }
            }
          }
        }
      });

      incomes = refunds.map(refund => ({
        id: refund.id,
        transaction_type: 'INCOME' as const,
        vendor_id: refund.vendor_id,
        vendor_name: refund.vendor.vendor_name,
        date: refund.refund_date,
        amount: Number(refund.refund_amount),
        payment_mode: refund.refund_mode,
        payment_type: refund.refund_type || 'RETURN_SPECIFIC',
        notes: refund.notes,
        invoice_numbers: refund.allocations.map(a => a.return.debit_note_no || ''),
        allocations_count: refund.allocations.length,
        fy: refund.fy,
        created_at: refund.created_at
      }));
    }

    // Combine and sort all transactions
    let allTransactions = [...expenses, ...incomes];

    // Sort transactions
    allTransactions.sort((a, b) => {
      let compareValue = 0;

      switch (sortBy) {
        case 'id':
          compareValue = a.id - b.id;
          break;
        case 'date':
          compareValue = a.date - b.date;
          break;
        case 'vendor_name':
          compareValue = a.vendor_name.localeCompare(b.vendor_name);
          break;
        case 'amount':
          compareValue = a.amount - b.amount;
          break;
        case 'type':
          compareValue = a.transaction_type.localeCompare(b.transaction_type);
          break;
        default:
          compareValue = a.date - b.date;
      }

      return sortOrder === 'desc' ? -compareValue : compareValue;
    });

    // Calculate total before pagination
    const total = allTransactions.length;
    const totalPages = Math.ceil(total / limitNum);

    // Apply pagination
    const skip = (pageNum - 1) * limitNum;
    const paginatedTransactions = allTransactions.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      data: paginatedTransactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error listing vendor transactions:', error);
    return res.status(500).json({
      error: 'Failed to list vendor transactions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await prisma.$disconnect();
  }
}
