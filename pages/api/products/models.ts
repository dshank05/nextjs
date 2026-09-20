import { prisma } from '../../../lib/db';
import { NextApiRequest, NextApiResponse } from 'next';
import { withObservability } from '../../../lib/withObservability';

// Uses the shared client from lib/db; this file used to build its own and
// disconnect it per request (F-72).

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
      // Car models are the one case with NO foreign key to lean on: products
      // store `car_model_ids` as a comma-joined string, so the database cannot
      // see the reference and cannot protect it. Deleting a model used to leave
      // its id embedded in every product that referenced it, permanently (F-67).
      //
      // The id has to be matched at one of four positions in the list: middle,
      // first, last, or as the only value - a plain `contains` would match 18
      // inside 180.
      const modelId = parseInt(id, 10);
      const productsCount = await prisma.product.count({
        where: {
          OR: [
            { car_model_ids: { contains: `,${modelId},` } },
            { car_model_ids: { startsWith: `${modelId},` } },
            { car_model_ids: { endsWith: `,${modelId}` } },
            { car_model_ids: String(modelId) }
          ]
        }
      });

      if (productsCount > 0) {
        return res.status(409).json({
          message: `Cannot delete this car model. ${productsCount} product(s) still reference it.`
        });
      }

      await prisma.car_models.delete({
        where: { id: modelId },
      });
      res.status(204).end();
    } else {
      res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export default withObservability(handler)
