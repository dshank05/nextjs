import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { page = 1, limit = 50, search = '', sortBy = 'subcategory_name', sortOrder = 'asc' } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const searchTerm = search as string;
      const sortField = sortBy as string;
      const sortDirection = sortOrder === 'desc' ? 'desc' : 'asc';

      const where = searchTerm
        ? { subcategory_name: { contains: searchTerm } }
        : {};

      const total = await prisma.product_subcategory.count({ where });
      const totalPages = Math.ceil(total / limitNum);

      const orderBy: any = {};
      if (sortField === 'id') {
        orderBy.id = sortDirection;
      } else {
        orderBy.subcategory_name = sortDirection;
      }

      const subcategories = await prisma.product_subcategory.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy,
        include: {
          category: true
        }
      });

      const startIndex = (pageNum - 1) * limitNum;
      const subcategoriesWithIndex = subcategories.map((sub, idx) => ({
        ...sub,
        index: startIndex + idx + 1,
      }));

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
      const { subcategory_name, category_id } = req.body;
      if (!subcategory_name || !category_id) {
        return res.status(400).json({ message: 'Subcategory name and category_id are required' });
      }

      // Validate that the category exists
      const category = await prisma.product_category.findUnique({
        where: { id: parseInt(category_id) }
      });
      if (!category) {
        return res.status(400).json({ message: 'Invalid category_id' });
      }

      const subcategory = await prisma.product_subcategory.create({
        data: {
          subcategory_name,
          category_id: parseInt(category_id)
        },
      });
      res.status(201).json(subcategory);
    } else if (req.method === 'PUT') {
      const { id, subcategory_name, category_id } = req.body;
      if (!id || !subcategory_name || !category_id) {
        return res.status(400).json({ message: 'ID, subcategory name, and category_id are required' });
      }

      // Validate that the category exists
      const category = await prisma.product_category.findUnique({
        where: { id: parseInt(category_id) }
      });
      if (!category) {
        return res.status(400).json({ message: 'Invalid category_id' });
      }

      const subcategory = await prisma.product_subcategory.update({
        where: { id: parseInt(id, 10) },
        data: {
          subcategory_name,
          category_id: parseInt(category_id)
        },
      });
      res.status(200).json(subcategory);
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
