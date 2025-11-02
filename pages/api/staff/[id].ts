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

// GET /api/staff/[id] - Get staff member details
async function handleGet(req: NextApiRequest, res: NextApiResponse, id: string | string[]) {
  try {
    const staffId = parseInt(Array.isArray(id) ? id[0] : id)
    if (isNaN(staffId)) {
      return res.status(400).json({ message: 'Invalid staff ID' })
    }

    const staff = await prisma.staff.findUnique({
      where: { id: staffId }
    })

    if (!staff) {
      return res.status(404).json({ message: 'Staff member not found' })
    }

    res.status(200).json(staff)
  } catch (error) {
    console.error('Get staff error:', error)
    res.status(500).json({
      message: 'Failed to fetch staff member',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// PUT /api/staff/[id] - Update staff member
async function handlePut(req: NextApiRequest, res: NextApiResponse, id: string | string[]) {
  try {
    const staffId = parseInt(Array.isArray(id) ? id[0] : id)
    if (isNaN(staffId)) {
      return res.status(400).json({ message: 'Invalid staff ID' })
    }

    const {
      name,
      email,
      phone,
      status
    } = req.body

    // Validation
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ message: 'Name cannot be empty' })
    }
    if (phone !== undefined && !phone.trim()) {
      return res.status(400).json({ message: 'Phone cannot be empty' })
    }

    // Check if phone already exists for different staff member
    if (phone) {
      const existingStaff = await prisma.staff.findFirst({
        where: {
          phone: phone.trim(),
          id: { not: staffId }
        }
      })

      if (existingStaff) {
        return res.status(400).json({
          message: 'Another staff member with this phone number already exists'
        })
      }
    }

    const updateData: any = {}

    if (name !== undefined) updateData.name = name.trim()
    if (email !== undefined) updateData.email = email?.trim() || null
    if (phone !== undefined) updateData.phone = phone.trim()
    if (status !== undefined) updateData.status = status

    const updatedStaff = await prisma.staff.update({
      where: { id: staffId },
      data: updateData,
    })

    res.status(200).json(updatedStaff)
  } catch (error) {
    console.error('Update staff error:', error)
    res.status(500).json({
      message: 'Failed to update staff member',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// DELETE /api/staff/[id] - Soft delete staff member (set status to Inactive)
async function handleDelete(req: NextApiRequest, res: NextApiResponse, id: string | string[]) {
  try {
    const staffId = parseInt(Array.isArray(id) ? id[0] : id)
    if (isNaN(staffId)) {
      return res.status(400).json({ message: 'Invalid staff ID' })
    }

    // Check if staff member exists
    const staff = await prisma.staff.findUnique({
      where: { id: staffId }
    })

    if (!staff) {
      return res.status(404).json({ message: 'Staff member not found' })
    }

    // Soft delete - just change status to Inactive
    const deactivatedStaff = await prisma.staff.update({
      where: { id: staffId },
      data: { status: 'Inactive' },
    })

    res.status(200).json({
      message: 'Staff member deactivated successfully',
      staff: deactivatedStaff
    })
  } catch (error) {
    console.error('Delete staff error:', error)
    res.status(500).json({
      message: 'Failed to deactivate staff member',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}


export default withObservability(handler)