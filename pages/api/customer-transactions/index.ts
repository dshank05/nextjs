import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { parseDateRange } from '../../../lib/date-utils';

const prisma = new PrismaClient();

interface UnifiedTransaction {
  id: number;
  transaction_type: 'INCOME' | 'EXPENSE';
  customer_id: number;
  customer_name: string;
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
 * GET /api/customer-transactions
 * List customer transactions (payments + refunds combined) with filters
 */
async function handleListTransactions(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const {
      customer_id,
      dateFrom,
      dateTo,
      payment_mode,
      payment_type,
      type = 'all', // 'all', 'income', 'expense'
      page = '1',
      limit = '50',
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    // Build where clauses for both queries
    const baseWhere: any = {};

    if (customer_id) {
      baseWhere.customer_id = parseInt(customer_id as string);
    }

    if (payment_mode !== undefined && payment_mode !== '') {
      baseWhere.payment_mode = parseInt(payment_mode as string);
    }

    // Fetch income (customer payments) if needed
    let incomes: UnifiedTransaction[] = [];
    if (type === 'all' || type === 'income') {
      const incomeWhere = { ...baseWhere };
      
      if (dateFrom && dateTo) {
        const { startTimestamp, endTimestamp } = parseDateRange(
          dateFrom as string,
          dateTo as string
        );
        incomeWhere.payment_date = {
          gte: startTimestamp,
          lte: endTimestamp
        };
      }

      if (payment_type) {
        incomeWhere.payment_type = payment_type as string;
      }

      const payments = await prisma.customer_payments.findMany({
        where: incomeWhere,
        include: {
          customer: {
            select: {
              id: true,
              billing_name: true
            }
          },
          allocations: {
            include: {
              invoice: {
                select: {
                  invoice_no: true
                }
              }
            }
          }
        }
      });

      incomes = payments.map(payment => ({
        id: payment.id,
        transaction_type: 'INCOME' as const,
        customer_id: payment.customer_id,
        customer_name: payment.customer.billing_name,
        date: payment.payment_date,
        amount: Number(payment.payment_amount),
        payment_mode: payment.payment_mode,
        payment_type: payment.payment_type || 'BILL_SPECIFIC',
        notes: payment.notes,
        invoice_numbers: payment.allocations.map(a => `INV-${a.invoice.invoice_no}`),
        allocations_count: payment.allocations.length,
        fy: payment.fy,
        created_at: payment.created_at
      }));
    }

    // Fetch expenses (customer refunds) if needed
    let expenses: UnifiedTransaction[] = [];
    if (type === 'all' || type === 'expense') {
      const expenseWhere = { ...baseWhere };
      
      if (dateFrom && dateTo) {
        const { startTimestamp, endTimestamp } = parseDateRange(
          dateFrom as string,
          dateTo as string
        );
        expenseWhere.refund_date = {
          gte: startTimestamp,
          lte: endTimestamp
        };
      }

      if (payment_type) {
        expenseWhere.refund_type = payment_type as string;
      }

      const refunds = await prisma.customer_refunds.findMany({
        where: expenseWhere,
        include: {
          customer: {
            select: {
              id: true,
              billing_name: true
            }
          },
          allocations: {
            include: {
              sale_return: {
                select: {
                  id: true,
                  invoice_id: true
                }
              },
              salex_return: {
                select: {
                  id: true,
                  invoicex_id: true
                }
              }
            }
          }
        }
      });

      expenses = refunds.map(refund => ({
        id: refund.id,
        transaction_type: 'EXPENSE' as const,
        customer_id: refund.customer_id,
        customer_name: refund.customer.billing_name,
        date: refund.refund_date,
        amount: Number(refund.refund_amount),
        payment_mode: refund.refund_mode,
        payment_type: refund.refund_type || 'RETURN_SPECIFIC',
        notes: refund.notes,
        invoice_numbers: refund.allocations.map(a => 
          a.sale_return ? `SR-${a.sale_return.id}` : a.salex_return ? `SXR-${a.salex_return.id}` : ''
        ),
        allocations_count: refund.allocations.length,
        fy: refund.fy,
        created_at: refund.created_at
      }));
    }

    // Combine and sort all transactions
    let allTransactions = [...incomes, ...expenses];

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
        case 'customer_name':
          compareValue = a.customer_name.localeCompare(b.customer_name);
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
    console.error('Error listing customer transactions:', error);
    return res.status(500).json({
      error: 'Failed to list customer transactions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await prisma.$disconnect();
  }
}
