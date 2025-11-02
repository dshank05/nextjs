import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { withObservability } from '../../../lib/withObservability';

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { page = 1, limit = 50, search = '', sortBy = 'model_name', sortOrder = 'asc' } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const searchTerm = search as string;

      // Validate sortBy to prevent SQL injection
      const validSortFields = ['id', 'model_name'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'model_name';
      const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc';

      const where = searchTerm
        ? { model_name: { contains: searchTerm } }
        : {};

      const total = await prisma.car_models.count({ where });
      const totalPages = Math.ceil(total / limitNum);

      const models = await prisma.car_models.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { [sortField]: sortDirection },
      });

      const startIndex = (pageNum - 1) * limitNum;
      const modelsWithIndex = models.map((mod, idx) => ({
        ...mod,
        subcategory_name: mod.model_name, // Add backward compatibility
        index: startIndex + idx + 1,
      }));

      res.status(200).json({
        models: modelsWithIndex,
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
        return res.status(400).json({ message: 'Model name is required' });
      }
      const model = await prisma.car_models.create({
        data: { model_name: subcategory_name },
      });
      res.status(201).json({
        status: "success",
        message: "Model created successfully"
      });
    } else if (req.method === 'PUT') {
      const { id, subcategory_name } = req.body;
      if (!id || !subcategory_name) {
        return res.status(400).json({ message: 'ID and model name are required' });
      }
      const model = await prisma.car_models.update({
        where: { id: parseInt(id, 10) },
        data: { model_name: subcategory_name },
      });
      res.status(200).json({
        status: "success",
        message: "Model updated successfully"
      });
    } else if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: 'ID is required' });
      }
      await prisma.car_models.delete({
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

export default withObservability(handler)
