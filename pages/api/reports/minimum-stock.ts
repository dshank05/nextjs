import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      page = '1',
      limit = '50',
      search = '',
      categoryFilter = '',
      companyFilter = '',
      modelFilter = '',
      sortBy = 'current_stock',
      sortOrder = 'asc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause - products where current stock is less than minimum stock.
    //
    // This block used to reference five things that do not exist on `product`:
    // `category_id` (it is `product_category_id`), `model_id` (car models live
    // in the comma-joined `car_model_ids` string), `part` (it is `part_no`),
    // `mode: 'insensitive'` (Postgres-only; MySQL collation is already
    // case-insensitive), and a default sort on `current_stock` - which is the
    // name of the RESPONSE field, not the column. The page never sends sortBy,
    // so that default fired on every call and the report returned 500 every
    // time it was opened (F-48).
    const where: any = {
      stock: { lt: prisma.product.fields.min_stock },
      min_stock: { not: null }
    };

    // Search filter
    if (search) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { product_name: { contains: search as string } },
          { hsn: { contains: search as string } },
          { part_no: { contains: search as string } }
        ]
      });
    }

    // Category filter
    if (categoryFilter) {
      where.product_category_id = parseInt(categoryFilter as string);
    }

    // Company filter
    if (companyFilter) {
      where.company_id = parseInt(companyFilter as string);
    }

    // Model filter.
    //
    // `car_model_ids` is a comma-joined list, so a plain `contains` would match
    // model 18 inside "180". The id has to be matched at one of four positions:
    // middle, first, last, or as the only value.
    if (modelFilter) {
      const modelId = (modelFilter as string).trim();
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { car_model_ids: { contains: `,${modelId},` } },
          { car_model_ids: { startsWith: `${modelId},` } },
          { car_model_ids: { endsWith: `,${modelId}` } },
          { car_model_ids: modelId }
        ]
      });
    }

    // Sort. The response renames columns (`stock` -> `current_stock`), so the
    // incoming sort key is translated back to a real column. `shortage` is
    // computed per row and cannot be sorted in SQL; it falls through to the
    // default, which puts the emptiest shelves first.
    const SORT_COLUMNS: Record<string, string> = {
      current_stock: 'stock',
      stock: 'stock',
      minimum_stock: 'min_stock',
      min_stock: 'min_stock',
      product_name: 'product_name',
      part_no: 'part_no',
      hsn: 'hsn'
    };
    const sortColumn = SORT_COLUMNS[sortBy as string] || 'stock';
    const direction = sortOrder === 'desc' ? 'desc' : 'asc';

    // Fetch low stock products
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: {
          [sortColumn]: direction
        },
        include: {
          category_ref: {
            select: {
              category_name: true
            }
          },
          product_company_ref: {
            select: {
              company_name: true
            }
          }
        }
      }),
      prisma.product.count({ where })
    ]);

    // Format response
    const formattedProducts = products.map(product => ({
      id: product.id,
      product_name: product.product_name,
      hsn: product.hsn,
      part_no: product.part_no,
      current_stock: Number(product.stock || 0),
      minimum_stock: Number(product.min_stock || 0),
      category_name: product.category_ref?.category_name || 'N/A',
      company_name: product.product_company_ref?.company_name || 'N/A',
      stock_status: Number(product.stock || 0) === 0 
        ? 'Out of Stock'
        : Number(product.stock || 0) < Number(product.min_stock || 0)
        ? 'Below Minimum'
        : 'Low Stock',
      shortage: Math.max(0, Number(product.min_stock || 0) - Number(product.stock || 0))
    }));

    return res.status(200).json({
      success: true,
      products: formattedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching minimum stock report:', error);
    return res.status(500).json({ error: 'Failed to fetch minimum stock report' });
  }
}
