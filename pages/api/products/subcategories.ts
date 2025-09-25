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

      const where = searchTerm
        ? { subcategory_name: { contains: searchTerm } }
        : {};

      const total = await prisma.product_subcategory_new.count({ where });
      const totalPages = Math.ceil(total / limitNum);

      const subcategories = await prisma.product_subcategory_new.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { subcategory_name: 'asc' },
      });

      // Get all products to find associated product names for each subcategory
      const allProducts = await prisma.product.findMany({
        where: {
          product_subcategory: { not: null }
        },
        select: {
          product_name: true,
          product_subcategory: true
        }
      });

      const startIndex = (pageNum - 1) * limitNum;
      const subcategoriesWithIndex = subcategories.map((sub, idx) => {
        // Find products that contain this subcategory ID
        const associatedProducts = allProducts.filter(product => {
          if (!product.product_subcategory) return false;
          const subcategoryIds = product.product_subcategory.split(',').map(id => id.trim());
          return subcategoryIds.includes(sub.id.toString());
        });

        const productNames = associatedProducts.map(p => p.product_name).slice(0, 5); // Limit to 5 products for display

        return {
          ...sub,
          index: startIndex + idx + 1,
          productNames: productNames,
          productCount: associatedProducts.length
        };
      });

      res.status(200).json({
        subcategories: subcategoriesWithIndex,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      });
    } else if (req.method === 'POST') {
      const { subcategory_name } = req.body;
      if (!subcategory_name) {
        return res.status(400).json({ message: 'Subcategory name is required' });
      }
      const subcategory = await prisma.product_subcategory_new.create({
        data: { subcategory_name },
      });
      res.status(201).json(subcategory);
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
