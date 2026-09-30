import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { withObservability } from '../../../lib/withObservability';

/**
 * The category a subcategory belongs to must already exist. Saving used to
 * accept a category NAME instead and create the category if it was not found,
 * so a typo in the subcategory dialog made a new category (PQ-08).
 */
async function existingCategoryId(raw: unknown): Promise<number | null> {
  const id = parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  const category = await prisma.product_category.findUnique({ where: { id }, select: { id: true } });
  return category ? id : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { page = 1, limit = 50, search = '', sortBy = 'subcategory_name', sortOrder = 'asc', category_id, category_search = '' } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const searchTerm = search as string;

      // Validate sortBy to prevent SQL injection
      const validSortFields = ['id', 'category_name', 'subcategory_name'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'subcategory_name';
      const sortDirection = sortOrder === 'desc' ? 'desc' : 'asc';

      const where: any = {};

      // Add search filter if provided
      if (searchTerm) {
        where.subcategory_name = { contains: searchTerm };
      }

      // Add category filter if provided
      if (category_id && category_id !== '') {
        where.category_id = parseInt(category_id as string);
      }

      // Add category search filter if provided
      if (category_search && category_search !== '') {
        where.category = {
          category_name: { contains: category_search as string }
        };
      }

      const total = await prisma.product_subcategory.count({ where });
      const totalPages = Math.ceil(total / limitNum);

      const orderBy: any = {};
      if (sortField === 'id') {
        orderBy.id = sortDirection;
      } else if (sortField === 'category_name') {
        orderBy.category = { category_name: sortDirection };
      } else {
        orderBy.subcategory_name = sortDirection;
      }

      const subcategories = await prisma.product_subcategory.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy,
        include: { category: true }
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
      const subcategory_name = String(req.body?.subcategory_name ?? '').trim();
      const finalCategoryId = await existingCategoryId(req.body?.category_id);
      if (!subcategory_name || !finalCategoryId) {
        return res.status(400).json({ message: 'Subcategory name and an existing category are required' });
      }

      const subcategory = await prisma.product_subcategory.create({
        data: {
          subcategory_name,
          category_id: finalCategoryId
        },
      });
      res.status(201).json({
        status: "success",
        message: "Subcategory created successfully"
      });
    } else if (req.method === 'PUT') {
      const { id } = req.body;
      const subcategory_name = String(req.body?.subcategory_name ?? '').trim();
      const finalCategoryId = await existingCategoryId(req.body?.category_id);
      if (!id || !subcategory_name || !finalCategoryId) {
        return res.status(400).json({ message: 'ID, subcategory name and an existing category are required' });
      }

      const subcategory = await prisma.product_subcategory.update({
        where: { id: parseInt(id, 10) },
        data: {
          subcategory_name,
          category_id: finalCategoryId
        },
      });
      res.status(200).json({
        status: "success",
        message: "Subcategory updated successfully"
      });
    } else if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: 'ID is required for delete' });
      }

      // Check if there are any products using this subcategory
      const productsCount = await prisma.product.count({
        where: { product_subcategory_id: parseInt(id) }
      });
      if (productsCount > 0) {
        return res.status(400).json({ message: 'Cannot delete subcategory that has associated products' });
      }

      await prisma.product_subcategory.delete({
        where: { id: parseInt(id, 10) },
      });
      res.status(204).end();
    } else {
      res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
  // No $disconnect here on purpose: `prisma` is the shared singleton from
  // lib/db, and tearing it down after every request defeats the pool that every
  // other route shares (F-71).
}

export default withObservability(handler)
