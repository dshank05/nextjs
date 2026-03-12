import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      page = '1',
      limit = '10',
      search = '',
      customerFilter = '',
      dateFrom = '',
      dateTo = '',
      amountMin = '',
      amountMax = '',
      sortBy = 'balance',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause for customer_details
    const where: any = {
      balance: {
        not: 0 // Only show customers with non-zero balance
      }
    };

    // Search filter
    if (search) {
      where.customer = {
        OR: [
          { billing_name: { contains: search as string, mode: 'insensitive' } },
          { name: { contains: search as string, mode: 'insensitive' } }
        ]
      };
    }

    // Customer filter
    if (customerFilter) {
      where.customer_id = parseInt(customerFilter as string);
    }

    // Amount filters
    if (amountMin) {
      where.balance = { ...where.balance, gte: parseFloat(amountMin as string) };
    }
    if (amountMax) {
      where.balance = { ...where.balance, lte: parseFloat(amountMax as string) };
    }

    // Fetch outstanding customers
    const [outstandingCustomers, total] = await Promise.all([
      prisma.customer_details.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: {
          [sortBy as string]: sortOrder as 'asc' | 'desc'
        },
        select: {
          id: true,
          billing_name: true,
          contact_no: true,
          email: true,
          billing_address: true,
          billing_city: true,
          billing_state: true,
          billing_gstin: true,
          total_paid: true,
          total_allocated: true,
          total_refunded: true,
          total_refund_allocated: true
        }
      }),
      prisma.customer_details.count({ where })
    ]);

    // Get last transaction for each customer
    const formattedData = await Promise.all(
      outstandingCustomers.map(async (detail) => {
        // Find last transaction from customer_ledger
        const lastTransaction = await prisma.customer_ledger.findFirst({
          where: { customer_id: detail.id },
          orderBy: { transaction_date: 'desc' },
          select: {
            transaction_date: true,
            transaction_type: true,
            reference_no: true,
            transaction_id: true
          }
        });

        let referenceDisplay = 'N/A';
        let referenceUrl = null;
        let referenceType = '';

        if (lastTransaction) {
          const transType = lastTransaction.transaction_type;
          
          if (transType === 'SALE' || transType === 'SALEX') {
            referenceDisplay = `INV-${lastTransaction.reference_no}`;
            referenceUrl = transType === 'SALE' 
              ? `/sale/view/${lastTransaction.transaction_id}`
              : `/salex/view/${lastTransaction.transaction_id}`;
            referenceType = 'sale';
          } else if (transType === 'PAYMENT') {
            referenceDisplay = `PAY-${lastTransaction.reference_no}`;
            referenceUrl = `/customer-transactions/view/${lastTransaction.transaction_id}?type=income`;
            referenceType = 'payment';
          } else if (transType === 'RETURN') {
            referenceDisplay = `RET-${lastTransaction.reference_no}`;
            referenceUrl = `/entry/salereturn/${lastTransaction.transaction_id}`;
            referenceType = 'return';
          } else if (transType === 'REFUND') {
            referenceDisplay = `REF-${lastTransaction.reference_no}`;
            referenceUrl = `/customer-transactions/view/${lastTransaction.transaction_id}?type=expense`;
            referenceType = 'refund';
          }
        }

        const outstanding = Number(detail.total_allocated) - Number(detail.total_paid) + Number(detail.total_refunded) - Number(detail.total_refund_allocated);

        return {
          id: detail.id,
          customer_id: detail.id,
          customer_name: detail.billing_name || 'Unknown',
          transaction_date: lastTransaction?.transaction_date || 0,
          balance: outstanding,
          last_transaction_type: lastTransaction?.transaction_type || 'N/A',
          reference_display: referenceDisplay,
          reference_url: referenceUrl,
          reference_type: referenceType,
          formattedDate: lastTransaction?.transaction_date 
            ? new Date(lastTransaction.transaction_date * 1000).toLocaleDateString('en-IN')
            : 'N/A',
          customer: {
            id: detail.id,
            billing_name: detail.billing_name,
            contact_no: detail.contact_no,
            email: detail.email,
            address: detail.billing_address,
            city: detail.billing_city,
            state: detail.billing_state,
            gstin: detail.billing_gstin
          }
        };
      })
    );

    return res.status(200).json({
      success: true,
      outstandingCustomers: formattedData,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching customer outstanding:', error);
    return res.status(500).json({ error: 'Failed to fetch customer outstanding data' });
  }
}
