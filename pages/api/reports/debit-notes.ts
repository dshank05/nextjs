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
        paymentStatus = '',
        sortBy = 'return_date',
        sortOrder = 'desc'
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      // Build optimized WHERE conditions for Prisma
      const whereConditions: any = {
        AND: [
          { debit_note_no: { not: null } } // Only debit notes
        ]
      };

      // Search by debit note number
      if (search) {
        whereConditions.AND.push({
          debit_note_no: { contains: search }
        });
      }

      // Filter by vendor name
      if (vendorFilter) {
        whereConditions.AND.push({
          vendor: {
            vendor_name: { contains: vendorFilter }
          }
        });
      }

      // Filter by date range (convert to timestamps)
      if (dateFrom || dateTo) {
        const dateCondition: any = { return_date: {} };
        if (dateFrom) {
          dateCondition.return_date.gte = Math.floor(new Date(dateFrom as string).getTime() / 1000);
        }
        if (dateTo) {
          dateCondition.return_date.lte = Math.floor(new Date(dateTo as string).getTime() / 1000) + 86399; // End of day
        }
        whereConditions.AND.push(dateCondition);
      }

      // Filter by amount range
      if (amountMin || amountMax) {
        const amountCondition: any = { refund_amount: {} };
        if (amountMin) {
          amountCondition.refund_amount.gte = parseFloat(amountMin as string);
        }
        if (amountMax) {
          amountCondition.refund_amount.lte = parseFloat(amountMax as string);
        }
        whereConditions.AND.push(amountCondition);
      }

      // Filter by payment status
      if (paymentStatus && paymentStatus !== 'all') {
        whereConditions.AND.push({
          payment_status: parseInt(paymentStatus as string)
        });
      }

      // Validate and build sort configuration
      const validSortFields = ['debit_note_no', 'vendor_name', 'refund_amount', 'return_date', 'payment_status'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'return_date';
      const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';

      // Map sort fields to Prisma format
      const sortFieldMap: Record<string, any> = {
        debit_note_no: { debit_note_no: sortDirection },
        vendor_name: { vendor: { vendor_name: sortDirection } },
        refund_amount: { refund_amount: sortDirection },
        return_date: { return_date: sortDirection },
        payment_status: { payment_status: sortDirection }
      };

      // Debug: Log the query conditions
      console.log('Debit Notes API - Query conditions:', JSON.stringify(whereConditions, null, 2));
      console.log('Debit Notes API - Sort field:', sortField, 'Direction:', sortDirection);

      // Debug: Check what's actually in the purchase_returns table
      const allReturns = await prisma.purchase_returns.findMany({
        select: {
          id: true,
          debit_note_no: true,
          vendor_id: true,
          return_date: true,
          total_amount: true,
          status: true
        },
        take: 10
      });
      console.log('Debit Notes API - All purchase_returns records:', JSON.stringify(allReturns, null, 2));

      // Execute optimized queries in parallel for better performance
      const [total, debitNoteRecords] = await Promise.all([
        // Count total records with same where conditions
        prisma.purchase_returns.count({
          where: whereConditions
        }),
        // Fetch debit notes with optimized includes and selective fields
        prisma.purchase_returns.findMany({
          where: whereConditions,
          select: {
            id: true,
            debit_note_no: true,
            return_date: true,
            vendor_id: true,
            purchase_id: true,
            total_amount: true,
            total_tax: true,
            packing_forwarding_amount: true,
            freight_amount: true,
            refund_amount: true,
            payment_status: true,
            payment_mode: true,
            payment_date: true,
            notes: true,
            fy: true,
            vendor: {
              select: {
                vendor_name: true,
                contact_no: true,
                email: true,
                address: true,
                city: true,
                state: true,
                tax_id: true
              }
            },
            items: {
              select: { id: true } // Only fetch IDs for counting
            }
          },
          orderBy: sortFieldMap[sortField as keyof typeof sortFieldMap],
          skip: offset,
          take: limitNum
        })
      ]);

      // Debug: Log results
      console.log('Debit Notes API - Total count:', total);
      console.log('Debit Notes API - Records found:', debitNoteRecords.length);
      if (debitNoteRecords.length > 0) {
        console.log('Debit Notes API - Sample record:', JSON.stringify(debitNoteRecords[0], null, 2));
      }

      const totalPages = Math.ceil(total / limitNum);

      // Format the results with optimized data transformation
      const debitNotes = debitNoteRecords.map((record) => ({
        id: record.id,
        debit_note_no: record.debit_note_no,
        return_date: record.return_date,
        vendor_id: record.vendor_id,
        vendor_name: record.vendor?.vendor_name || '',
        purchase_id: record.purchase_id,
        total_amount: Number(record.total_amount) || 0,
        total_tax: Number(record.total_tax) || 0,
        packing_forwarding_amount: Number(record.packing_forwarding_amount) || 0,
        freight_amount: Number(record.freight_amount) || 0,
        refund_amount: Number(record.refund_amount) || 0,
        payment_status: record.payment_status,
        payment_mode: record.payment_mode,
        payment_date: record.payment_date,
        notes: record.notes,
        fy: record.fy,
        item_count: record.items?.length || 0,
        formattedDate: new Date(record.return_date * 1000).toLocaleDateString('en-IN'),
        vendor: record.vendor ? {
          vendor_name: record.vendor.vendor_name,
          contact_no: record.vendor.contact_no,
          email: record.vendor.email,
          address: record.vendor.address,
          city: record.vendor.city,
          state: record.vendor.state,
          tax_id: record.vendor.tax_id
        } : null
      }));

      return res.status(200).json({
        debitNotes,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages
        }
      });
    } catch (error) {
      console.error('Error fetching debit notes:', error);
      return res.status(500).json({ message: 'Failed to fetch debit notes', error: String(error) });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} not allowed` });
  }
}
