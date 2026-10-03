import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { fail } from '../../../lib/api/respond'
import { isTenDigitPhone, isValidEmail } from '../../../lib/validators'

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
    return fail(res, error, 'fetch staff member')
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
    // The rules POST and the form apply (they were skipped here).
    if (phone !== undefined && !isTenDigitPhone(phone)) {
      return res.status(400).json({ message: 'Phone number must be exactly 10 digits' })
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ message: 'Email address is not valid' })
    }
    if (status !== undefined && status !== 'Active' && status !== 'Inactive') {
      return res.status(400).json({ message: 'Status must be Active or Inactive' })
    }
    const current = await prisma.staff.findUnique({ where: { id: staffId } })
    if (!current) {
      return res.status(404).json({ message: 'Staff member not found' })
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
    return fail(res, error, 'update staff member')
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
    return fail(res, error, 'deactivate staff member')
  }
}


export default withObservability(handler)