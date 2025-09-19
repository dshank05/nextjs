import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { page = 1, limit = 50, search = '' } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const searchTerm = search as string;

      // Get unique subcategories from products table
      const where = searchTerm
        ? { product_subcategory: { contains: searchTerm } }
        : { product_subcategory: { not: null } };

      const products = await prisma.product.findMany({
        where,
        select: {
          product_subcategory: true
        },
        distinct: ['product_subcategory']
      });

      // Filter and sort unique subcategories
      const uniqueSubcategories = products
        .map(p => p.product_subcategory)
        .filter(Boolean)
        .sort();

      const total = uniqueSubcategories.length;
      const totalPages = Math.ceil(total / limitNum);

      const startIndex = (pageNum - 1) * limitNum;
      const paginatedSubcategories = uniqueSubcategories
        .slice(startIndex, startIndex + limitNum)
        .map((subcategory, idx) => ({
          id: startIndex + idx + 1,
          subcategory_name: subcategory,
          index: startIndex + idx + 1,
        }));

      res.status(200).json({
        subcategories: paginatedSubcategories,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      });
    } else if (req.method === 'POST') {
      // For POST, we'll just return success since we can't add to lookup table
      // The subcategory will be added when a product is created with it
      const { subcategory_name } = req.body;
      if (!subcategory_name) {
        return res.status(400).json({ message: 'Subcategory name is required' });
      }
      res.status(201).json({ message: 'Subcategory will be available when used in products' });
    } else {
      res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    await prisma.$disconnect();
  }
}
