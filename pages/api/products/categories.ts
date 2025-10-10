import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    case 'PUT':
      return handlePut(req, res);
    case 'DELETE':
      return handleDelete(req, res);
    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const searchTerm = search as string;
    const skip = (pageNum - 1) * limitNum;

    const where = searchTerm
      ? { category_name: { contains: searchTerm } }
      : {};

    const [categories, total] = await Promise.all([
      prisma.product_category.findMany({
        where,
        orderBy: { category_name: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.product_category.count({ where })
    ]);

    const totalPages = Math.ceil(total / limitNum);
    const categoriesWithIndex = categories.map((cat, idx) => ({
      ...cat,
      index: skip + idx + 1,
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
  } catch (error) {
    console.error('Categories fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch categories' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { category_name } = req.body;
    if (!category_name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const existingCategory = await prisma.product_category.findFirst({
      where: { category_name }
    });

    if (existingCategory) {
      return res.status(400).json({ message: 'Category with this name already exists' });
    }

    const category = await prisma.product_category.create({
      data: { category_name },
    });
    res.status(201).json(category);
  } catch (error) {
    console.error('Category creation error:', error);
    res.status(500).json({ message: 'Failed to create category' });
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, category_name } = req.body;
    if (!id || !category_name) {
      return res.status(400).json({ message: 'ID and category name are required' });
    }

    const existingCategory = await prisma.product_category.findUnique({
      where: { id: parseInt(id, 10) }
    });

    if (!existingCategory) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const duplicateCategory = await prisma.product_category.findFirst({
      where: {
        category_name,
        id: { not: parseInt(id, 10) }
      }
    });

    if (duplicateCategory) {
      return res.status(400).json({ message: 'Another category with this name already exists' });
    }

    const category = await prisma.product_category.update({
      where: { id: parseInt(id, 10) },
      data: { category_name },
    });
    res.status(200).json(category);
  } catch (error) {
    console.error('Category update error:', error);
    res.status(500).json({ message: 'Failed to update category' });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ message: 'ID is required' });
    }

    await prisma.product_category.delete({
      where: { id: parseInt(id, 10) },
    });
    res.status(204).end();
  } catch (error) {
    console.error('Category deletion error:', error);
    res.status(500).json({ message: 'Failed to delete category' });
  }
}
