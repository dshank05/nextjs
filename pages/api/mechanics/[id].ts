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
    return fail(res, error, 'fetch mechanic')
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
    // The rules POST and the form apply (they were skipped here).
    if (phone !== undefined && !isTenDigitPhone(phone)) {
      return res.status(400).json({ message: 'Phone number must be exactly 10 digits' })
    }
    if (status !== undefined && status !== 'Active' && status !== 'Inactive') {
      return res.status(400).json({ message: 'Status must be Active or Inactive' })
    }
    const current = await prisma.mechanic.findUnique({ where: { id: mechanicId } })
    if (!current) {
      return res.status(404).json({ message: 'Mechanic not found' })
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
    return fail(res, error, 'update mechanic')
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
    return fail(res, error, 'deactivate mechanic')
  }
}


export default withObservability(handler)