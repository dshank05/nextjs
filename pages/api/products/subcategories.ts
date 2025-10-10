import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { type, page = 1, limit = 50, search = '', sortBy = 'subcategory_name', sortOrder = 'asc', category_id } = req.query;

      // Handle getting categories from product/category
      if (type === 'categories') {
        // Import logic from categories.ts
        const categoriesPageNum = parseInt(page as string, 10);
        const categoriesLimitNum = parseInt(limit as string, 10);
        const categoriesSearchTerm = search as string;
        const categoriesSortField = sortBy as string;
        const categoriesSortDirection = sortOrder === 'desc' ? 'desc' : 'asc';

        const categoriesWhere = categoriesSearchTerm
          ? { category_name: { contains: categoriesSearchTerm } }
          : {};

        const categoriesTotal = await prisma.product_category.count({ where: categoriesWhere });
        const categoriesTotalPages = Math.ceil(categoriesTotal / categoriesLimitNum);

        const categoriesOrderBy: any = {};
        if (categoriesSortField === 'id') {
          categoriesOrderBy.id = categoriesSortDirection;
        } else {
          categoriesOrderBy.category_name = categoriesSortDirection;
        }

        const categories = await prisma.product_category.findMany({
          where: categoriesWhere,
          skip: (categoriesPageNum - 1) * categoriesLimitNum,
          take: categoriesLimitNum,
          orderBy: categoriesOrderBy,
        });

        const categoriesStartIndex = (categoriesPageNum - 1) * categoriesLimitNum;
        const categoriesWithIndex = categories.map((cat, idx) => ({
          ...cat,
          category_name: cat.category_name,
          index: categoriesStartIndex + idx + 1,
        }));

        return res.status(200).json({
          categories: categoriesWithIndex,
          pagination: {
            page: categoriesPageNum,
            limit: categoriesLimitNum,
            total: categoriesTotal,
            totalPages: categoriesTotalPages,
            hasMore: categoriesPageNum < categoriesTotalPages,
          },
        });
      }

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const searchTerm = search as string;
      const sortField = sortBy as string;
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
        orderBy
        // Removed unnecessary include: { category: true } - frontend only uses subcategory fields
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
      const { subcategory_name, category_id, category_name } = req.body;
      if (!subcategory_name || (!category_id && !category_name)) {
        return res.status(400).json({ message: 'Subcategory name is required, and either category_id or category_name must be provided' });
      }

      let finalCategoryId;
      if (category_id) {
        // Validate that the category exists
        const category = await prisma.product_category.findUnique({
          where: { id: parseInt(category_id) }
        });
        if (!category) {
          return res.status(400).json({ message: 'Invalid category_id' });
        }
        finalCategoryId = parseInt(category_id);
      } else if (category_name) {
        // Find existing category or create new
        let category = await prisma.product_category.findFirst({
          where: { category_name: category_name.trim() }
        });
        if (!category) {
          category = await prisma.product_category.create({
            data: { category_name: category_name.trim() }
          });
        }
        finalCategoryId = category.id;
      }

      const subcategory = await prisma.product_subcategory.create({
        data: {
          subcategory_name,
          category_id: finalCategoryId
        },
      });
      res.status(201).json(subcategory);
    } else if (req.method === 'PUT') {
      const { id, subcategory_name, category_id, category_name } = req.body;
      if (!id || !subcategory_name || (!category_id && !category_name)) {
        return res.status(400).json({ message: 'ID, subcategory name are required, and either category_id or category_name must be provided' });
      }

      let finalCategoryId;
      if (category_id) {
        // Validate that the category exists
        const category = await prisma.product_category.findUnique({
          where: { id: parseInt(category_id) }
        });
        if (!category) {
          return res.status(400).json({ message: 'Invalid category_id' });
        }
        finalCategoryId = parseInt(category_id);
      } else if (category_name) {
        // Find existing category or create new
        let category = await prisma.product_category.findFirst({
          where: { category_name: category_name.trim() }
        });
        if (!category) {
          category = await prisma.product_category.create({
            data: { category_name: category_name.trim() }
          });
        }
        finalCategoryId = category.id;
      }

      const subcategory = await prisma.product_subcategory.update({
        where: { id: parseInt(id, 10) },
        data: {
          subcategory_name,
          category_id: finalCategoryId
        },
      });
      res.status(200).json(subcategory);
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
  } finally {
    await prisma.$disconnect();
  }
}
