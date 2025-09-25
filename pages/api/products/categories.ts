import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { page = 1, limit = 50, search = '', sortBy = 'category_name', sortOrder = 'asc' } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const searchTerm = search as string;
      const sortField = sortBy as string;
      const sortDirection = sortOrder === 'desc' ? 'desc' : 'asc';

      const where = searchTerm
        ? { category_name: { contains: searchTerm } }
        : {};

      const total = await prisma.product_category.count({ where });
      const totalPages = Math.ceil(total / limitNum);

      const orderBy: any = {};
      if (sortField === 'id') {
        orderBy.id = sortDirection;
      } else {
        orderBy.category_name = sortDirection;
      }

      const categories = await prisma.product_category.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy,
      });

      const startIndex = (pageNum - 1) * limitNum;
      const categoriesWithIndex = categories.map((cat, idx) => ({
        ...cat,
        category_name: cat.category_name, // Add backward compatibility
        index: startIndex + idx + 1,
      }));

      res.status(200).json({
        categories: categoriesWithIndex,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      });
    } else if (req.method === 'POST') {
      const { category_name } = req.body;
      if (!category_name) {
        return res.status(400).json({ message: 'Category name is required' });
      }
      const category = await prisma.product_category.create({
        data: { category_name: category_name },
      });
      res.status(201).json(category);
    } else if (req.method === 'PUT') {
      const { id, category_name } = req.body;
      if (!id || !category_name) {
        return res.status(400).json({ message: 'ID and category name are required' });
      }
      const category = await prisma.product_category.update({
        where: { id: parseInt(id, 10) },
        data: { category_name: category_name },
      });
      res.status(200).json(category);
    } else if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: 'ID is required' });
      }
      await prisma.product_category.delete({
        where: { id: parseInt(id, 10) },
      });
      res.status(204).end();
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
