import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return handleUpdateNotes(req, res);
}

/**
 * PATCH /api/vendor-ledger/[id]
 * Update notes for a single ledger entry
 */
async function handleUpdateNotes(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query;
    const { notes } = req.body;

    // Validate ID
    if (!id || Array.isArray(id) || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'Invalid ledger entry ID' });
    }

    // Notes can be empty string (not required)
    if (notes === undefined || notes === null) {
      return res.status(400).json({ error: 'Notes field is required in request body' });
    }

    const ledgerEntryId = parseInt(id);

    // Simple direct update - no transaction needed
    // Notes don't affect accounting, so no balance recalculation
    const updated = await prisma.vendor_ledger.update({
      where: { id: ledgerEntryId },
      data: { 
        notes: notes.trim(),
        updated_at: new Date()
      },
      select: {
        id: true,
        notes: true,
        updated_at: true
      }
    });

    return res.status(200).json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('Ledger notes update error:', error);
    
    // Handle not found
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        error: 'Ledger entry not found' 
      });
    }

    return res.status(500).json({
      error: 'Failed to update notes',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
