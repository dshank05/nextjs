import { prisma } from '../../../lib/db';
import { NextApiRequest, NextApiResponse } from 'next';
import { withObservability } from '../../../lib/withObservability';

// Uses the shared client from lib/db. This file used to construct its own
// PrismaClient and disconnect it per request, which opens a second connection
// pool and, under dev HMR, leaks one per reload (F-72).

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { page = 1, limit = 50, search = '', sortBy = 'company_name', sortOrder = 'asc' } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const searchTerm = search as string;

      // Validate sortBy to prevent SQL injection
      const validSortFields = ['id', 'company_name'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'company_name';
      const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc';

      const where = searchTerm
        ? { company_name: { contains: searchTerm } }
        : {};

      const total = await prisma.product_company.count({ where });
      const totalPages = Math.ceil(total / limitNum);

      const companies = await prisma.product_company.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { [sortField]: sortDirection },
      });

      const startIndex = (pageNum - 1) * limitNum;
      const companiesWithIndex = companies.map((comp, idx) => ({
        ...comp,
        index: startIndex + idx + 1,
      }));

      res.status(200).json({
        companies: companiesWithIndex,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      });
    } else if (req.method === 'POST') {
      const { company_name } = req.body;
      if (!company_name) {
        return res.status(400).json({ message: 'Company name is required' });
      }
      const company = await prisma.product_company.create({
        data: { company_name },
      });
      res.status(201).json({
        status: "success",
        message: "Company created successfully"
      });
    } else if (req.method === 'PUT') {
      const { id, company_name } = req.body;
      if (!id || !company_name) {
        return res.status(400).json({ message: 'ID and company name are required' });
      }
      const company = await prisma.product_company.update({
        where: { id: parseInt(id, 10) },
        data: { company_name },
      });
      res.status(200).json({
        status: "success",
        message: "Company updated successfully"
      });
    } else if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: 'ID is required' });
      }
      // Refuse while products still reference it - the FK is SET NULL, so an
      // unguarded delete silently blanks the company on every one of them (F-66).
      const companyId = parseInt(id, 10);
      const productsCount = await prisma.product.count({
        where: { company_id: companyId }
      });

      if (productsCount > 0) {
        return res.status(409).json({
          message: `Cannot delete this company. ${productsCount} product(s) still reference it.`
        });
      }

      await prisma.product_company.delete({
        where: { id: companyId },
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
// Wrapped like its siblings (F-89).
export default withObservability(handler);
