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

    // Build where clause - products where current stock is less than minimum stock
    const where: any = {
      stock: { lt: prisma.product.fields.min_stock },
      min_stock: { not: null }
    };

    // Search filter
    if (search) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { product_name: { contains: search as string, mode: 'insensitive' } },
          { hsn: { contains: search as string, mode: 'insensitive' } },
          { part: { contains: search as string, mode: 'insensitive' } }
        ]
      });
    }

    // Category filter
    if (categoryFilter) {
      where.category_id = parseInt(categoryFilter as string);
    }

    // Company filter
    if (companyFilter) {
      where.company_id = parseInt(companyFilter as string);
    }

    // Model filter
    if (modelFilter) {
      where.model_id = parseInt(modelFilter as string);
    }

    // Fetch low stock products
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: {
          [sortBy as string]: sortOrder as 'asc' | 'desc'
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
