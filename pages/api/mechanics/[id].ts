import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, id)
    case 'PUT':
      return handlePut(req, res, id)
    case 'DELETE':
      return handleDelete(req, res, id)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

// GET /api/mechanics/[id] - Get mechanic details
async function handleGet(req: NextApiRequest, res: NextApiResponse, id: string | string[]) {
  try {
    const mechanicId = parseInt(Array.isArray(id) ? id[0] : id)
    if (isNaN(mechanicId)) {
      return res.status(400).json({ message: 'Invalid mechanic ID' })
    }

    const mechanic = await prisma.mechanic.findUnique({
      where: { id: mechanicId }
    })

    if (!mechanic) {
      return res.status(404).json({ message: 'Mechanic not found' })
    }

    res.status(200).json(mechanic)
  } catch (error) {
    console.error('Get mechanic error:', error)
    res.status(500).json({
      message: 'Failed to fetch mechanic',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// PUT /api/mechanics/[id] - Update mechanic
async function handlePut(req: NextApiRequest, res: NextApiResponse, id: string | string[]) {
  try {
    const mechanicId = parseInt(Array.isArray(id) ? id[0] : id)
    if (isNaN(mechanicId)) {
      return res.status(400).json({ message: 'Invalid mechanic ID' })
    }

    const {
      name,
      phone,
      city,
      status
    } = req.body

    // Validation
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ message: 'Name cannot be empty' })
    }
    if (phone !== undefined && !phone.trim()) {
      return res.status(400).json({ message: 'Phone cannot be empty' })
    }

    // Check if phone already exists for different mechanic
    if (phone) {
      const existingMechanic = await prisma.mechanic.findFirst({
        where: {
          phone: phone.trim(),
          id: { not: mechanicId }
        }
      })

      if (existingMechanic) {
        return res.status(400).json({
          message: 'Another mechanic with this phone number already exists'
        })
      }
    }

    const updateData: any = {}

    if (name !== undefined) updateData.name = name.trim()
    if (phone !== undefined) updateData.phone = phone.trim()
    if (city !== undefined) updateData.city = city ? city.trim() : null
    if (status !== undefined) updateData.status = status

    const updatedMechanic = await prisma.mechanic.update({
      where: { id: mechanicId },
      data: updateData,
    })

    res.status(200).json(updatedMechanic)
  } catch (error) {
    console.error('Update mechanic error:', error)
    res.status(500).json({
      message: 'Failed to update mechanic',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// DELETE /api/mechanics/[id] - Soft delete mechanic (set status to Inactive)
async function handleDelete(req: NextApiRequest, res: NextApiResponse, id: string | string[]) {
  try {
    const mechanicId = parseInt(Array.isArray(id) ? id[0] : id)
    if (isNaN(mechanicId)) {
      return res.status(400).json({ message: 'Invalid mechanic ID' })
    }

    // Check if mechanic exists
    const mechanic = await prisma.mechanic.findUnique({
      where: { id: mechanicId }
    })

    if (!mechanic) {
      return res.status(404).json({ message: 'Mechanic not found' })
    }

    // Soft delete - just change status to Inactive
    const deactivatedMechanic = await prisma.mechanic.update({
      where: { id: mechanicId },
      data: { status: 'Inactive' },
    })

    res.status(200).json({
      message: 'Mechanic deactivated successfully',
      mechanic: deactivatedMechanic
    })
  } catch (error) {
    console.error('Delete mechanic error:', error)
    res.status(500).json({
      message: 'Failed to deactivate mechanic',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}


export default withObservability(handler)