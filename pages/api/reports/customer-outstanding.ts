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

    // Build where clause for customer_details.
    //
    // This endpoint used to filter on `balance`, a `customer` relation and a
    // `name` field. None of the three exist on customer_details - the balance
    // column is `account_balance`, and there is no self-relation - so Prisma
    // rejected the query and EVERY request to this report returned 500 (F-45).
    // It also passed `mode: 'insensitive'`, which the MySQL connector does not
    // support. MySQL's default collation is already case-insensitive.
    const where: any = {};

    // Search filter - real columns on customer_details
    if (search) {
      where.OR = [
        { billing_name: { contains: search as string } },
        { contact_no: { contains: search as string } },
        { email: { contains: search as string } }
      ];
    }

    // Customer filter
    if (customerFilter) {
      where.id = parseInt(customerFilter as string);
    }

    // Outstanding is an expression over four counter columns, not a stored
    // column, so it cannot be filtered, sorted or paginated in SQL. The
    // customer list is small (hundreds), so the rows are read once and the
    // amount filter, sort and pagination are applied in memory below.
    //
    // NOTE: this preserves the definition of "outstanding" this endpoint
    // already used - the payment-allocation counters. It is not the same
    // definition the vendor report or the ledger uses; see F-47, which is where
    // that gets settled. This fix restores the report, it does not pick the
    // winner.
    const candidates = await prisma.customer_details.findMany({
      where,
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
    });

    const withOutstanding = candidates
      .map(detail => ({
        detail,
        outstanding:
          Number(detail.total_allocated) -
          Number(detail.total_paid) +
          Number(detail.total_refunded) -
          Number(detail.total_refund_allocated)
      }))
      .filter(row => row.outstanding !== 0);

    const amountFiltered = withOutstanding.filter(row => {
      if (amountMin && row.outstanding < parseFloat(amountMin as string)) return false;
      if (amountMax && row.outstanding > parseFloat(amountMax as string)) return false;
      return true;
    });

    const direction = sortOrder === 'asc' ? 1 : -1;
    amountFiltered.sort((a, b) => {
      if (sortBy === 'customer_name') {
        return direction * (a.detail.billing_name || '').localeCompare(b.detail.billing_name || '');
      }
      // 'balance' (the page's default) and anything unrecognised sort by amount
      return direction * (a.outstanding - b.outstanding);
    });

    const total = amountFiltered.length;
    const outstandingCustomers = amountFiltered.slice(skip, skip + limitNum);

    // Get last transaction for each customer
    const formattedData = await Promise.all(
      outstandingCustomers.map(async ({ detail, outstanding }) => {
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
