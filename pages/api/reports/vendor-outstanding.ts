import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const {
        page = '1',
        limit = '10',
        search = '',
        vendorFilter = '',
        dateFrom = '',
        dateTo = '',
        amountMin = '',
        amountMax = '',
        sortBy = 'balance',
        sortOrder = 'desc'
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE conditions for vendor ledger
      const whereConditions: any = {
        balance: { gt: 0 } // Only show outstanding amounts (vendors we owe money to)
      };

      // Store original balance condition for amount filtering
      const baseBalanceCondition = { gt: 0 };

      // Filter by specific vendor ID (only when a specific vendor is selected)
      if (vendorFilter && vendorFilter !== '') {
        whereConditions.vendor_id = parseInt(vendorFilter as string);
      }

      // Filter by date range (transaction date)
      if (dateFrom || dateTo) {
        whereConditions.transaction_date = {};
        if (dateFrom) {
          whereConditions.transaction_date.gte = Math.floor(new Date(dateFrom as string).getTime() / 1000);
        }
        if (dateTo) {
          whereConditions.transaction_date.lte = Math.floor(new Date(dateTo as string).getTime() / 1000) + 86399; // End of day
        }
      }

      // Filter by amount range (balance) - combine with base condition
      if (amountMin || amountMax) {
        whereConditions.balance = { ...baseBalanceCondition };
        if (amountMin) {
          whereConditions.balance.gte = Math.max(parseFloat(amountMin as string), 0.01); // Ensure still > 0
        }
        if (amountMax) {
          whereConditions.balance.lte = parseFloat(amountMax as string);
        }
      }

      // Validate and build sort configuration
      // Note: vendor_ledger doesn't have vendor relation, so we can't sort by vendor_name
      const validSortFields = ['balance', 'transaction_date'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'balance';
      const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';

      // Map sort fields to Prisma format
      const sortFieldMap: Record<string, any> = {
        balance: { balance: sortDirection },
        transaction_date: { transaction_date: sortDirection }
      };

      // Get outstanding vendors with latest balances
      const outstandingQuery = prisma.vendor_ledger.findMany({
        where: whereConditions,
        orderBy: sortFieldMap[sortField as keyof typeof sortFieldMap],
        skip: offset,
        take: limitNum
      });

      // Count total outstanding vendors
      const countQuery = prisma.vendor_ledger.count({
        where: whereConditions
      });

      // Execute queries in parallel
      const [outstandingRecords, total] = await Promise.all([outstandingQuery, countQuery]);

      const totalPages = Math.ceil(total / limitNum);

      // Get vendor details for all outstanding records
      const vendorIds = Array.from(new Set(outstandingRecords.map(r => r.vendor_id)));
      const vendors = await prisma.vendor_details.findMany({
        where: { id: { in: vendorIds } },
        select: {
          id: true,
          vendor_name: true,
          contact_no: true,
          email: true,
          address: true,
          city: true,
          state: true,
          tax_id: true
        }
      });

      // Create vendor lookup map
      const vendorMap = new Map(vendors.map(v => [v.id, v]));

      // Format the results
      const outstandingVendors = outstandingRecords.map((record) => {
        const vendor = vendorMap.get(record.vendor_id);

        // Determine reference type and navigation
        let referenceDisplay = '';
        let referenceUrl = null;
        let referenceType = 'unknown';

        switch (record.transaction_type) {
          case 'PURCHASE':
            referenceDisplay = record.reference_no || record.id.toString();
            referenceUrl = `/purchases/view/${record.reference_id}`;
            referenceType = 'purchase';
            break;
          case 'DEBIT_NOTE':
            referenceDisplay = record.reference_no || record.id.toString();
            referenceUrl = `/entry/purchasereturn-vendor/${record.reference_id}`;
            referenceType = 'debit_note';
            break;
          case 'PAYMENT':
            referenceDisplay = 'Payment';
            referenceUrl = null;
            referenceType = 'payment';
            break;
          default:
            referenceDisplay = record.reference_no || 'N/A';
            referenceUrl = null;
            referenceType = 'unknown';
        }

        return {
          id: record.id,
          vendor_id: record.vendor_id,
          vendor_name: vendor?.vendor_name || 'Unknown Vendor',
          transaction_date: record.transaction_date,
          balance: Number(record.balance),
          last_transaction_type: record.transaction_type,
          reference_display: referenceDisplay,
          reference_url: referenceUrl,
          reference_type: referenceType,
          formattedDate: new Date(record.transaction_date * 1000).toLocaleDateString('en-IN'),
          vendor: vendor ? {
            vendor_name: vendor.vendor_name,
            contact_no: vendor.contact_no,
            email: vendor.email,
            address: vendor.address,
            city: vendor.city,
            state: vendor.state,
            tax_id: vendor.tax_id
          } : null
        };
      });

      return res.status(200).json({
        outstandingVendors,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages
        }
      });
    } catch (error) {
      console.error('Error fetching vendor outstanding balances:', error);
      return res.status(500).json({ message: 'Failed to fetch vendor outstanding balances', error: String(error) });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} not allowed` });
  }
}
