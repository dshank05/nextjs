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
        ? { company_name: { contains: searchTerm } }
        : {};

      const total = await prisma.product_company.count({ where });
      const totalPages = Math.ceil(total / limitNum);

      const companies = await prisma.product_company.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { company_name: 'asc' },
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
      res.status(201).json(company);
    } else if (req.method === 'PUT') {
      const { id, company_name } = req.body;
      if (!id || !company_name) {
        return res.status(400).json({ message: 'ID and company name are required' });
      }
      const company = await prisma.product_company.update({
        where: { id: parseInt(id, 10) },
        data: { company_name },
      });
      res.status(200).json(company);
    } else if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: 'ID is required' });
      }
      await prisma.product_company.delete({
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
