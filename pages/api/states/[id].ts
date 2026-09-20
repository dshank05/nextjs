 import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isValidGstStateCode, MIN_GST_STATE_CODE, MAX_GST_STATE_CODE } from '../../../lib/gst'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Valid state ID is required' })
  }

  switch (req.method) {
    case 'PUT':
      return handlePut(req, res, id)
    case 'DELETE':
      return handleDelete(req, res, id)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const { state_name, code } = req.body

    if (!state_name || typeof state_name !== 'string' || !state_name.trim()) {
      return res.status(400).json({
        message: 'State name is required and must be a non-empty string'
      })
    }

    // F-29: `code` is optional on update so existing callers that only rename a
    // state keep working, but when supplied it must be a real GST state code.
    let stateCode: number | undefined
    if (code !== undefined && code !== null && code !== '') {
      stateCode = typeof code === 'number' ? code : parseInt(code, 10)
      if (!isValidGstStateCode(stateCode)) {
        return res.status(400).json({
          message: `GST state code must be between ${MIN_GST_STATE_CODE} and ${MAX_GST_STATE_CODE}`
        })
      }
    }

    const stateId = parseInt(id, 10)
    if (isNaN(stateId)) {
      return res.status(400).json({ message: 'Invalid state ID' })
    }

    // Check if state exists
    const existingState = await prisma.states.findUnique({
      where: { id: stateId }
    })

    if (!existingState) {
      return res.status(404).json({ message: 'State not found' })
    }

    // Check if another state with same name exists
    const trimmedName = state_name.trim()
    const duplicateState = await prisma.states.findFirst({
      where: {
        AND: [
          {
            OR: [
              { state_name: trimmedName },
              { state_name: trimmedName.toLowerCase() }
            ]
          },
          { id: { not: stateId } }
        ]
      }
    })

    if (duplicateState) {
      return res.status(409).json({
        message: 'Another state with this name already exists'
      })
    }

    if (stateCode !== undefined) {
      const codeConflict = await prisma.states.findFirst({
        where: { code: stateCode, id: { not: stateId } }
      })

      if (codeConflict) {
        return res.status(409).json({
          message: `GST state code ${stateCode} is already used by "${codeConflict.state_name}"`
        })
      }
    }

    // Update state
    const updatedState = await prisma.states.update({
      where: { id: stateId },
      data: {
        state_name: trimmedName,
        ...(stateCode !== undefined ? { code: stateCode } : {})
      },
      select: {
        id: true,
        state_name: true,
        code: true
      }
    })

    res.status(200).json({
      message: 'State updated successfully',
      state: {
        id: updatedState.id.toString(),
        state_name: updatedState.state_name,
        code: updatedState.code
      }
    })
  } catch (error) {
    console.error('State update error:', error)
    res.status(500).json({
      message: 'Failed to update state',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const stateId = parseInt(id, 10)
    if (isNaN(stateId)) {
      return res.status(400).json({ message: 'Invalid state ID' })
    }

    // Check if state exists
    const existingState = await prisma.states.findUnique({
      where: { id: stateId }
    })

    if (!existingState) {
      return res.status(404).json({ message: 'State not found' })
    }

    // Check if state is being used by any customers or vendors
    // Get state name for customer filtering (customers store state names as strings)
    const stateRecord = await prisma.states.findUnique({
      where: { id: stateId }
    })

    const customersUsingState = await prisma.customer_details.findFirst({
      where: {
        OR: [
          { billing_state: stateRecord?.state_name || '' },
          { shipping_state: stateRecord?.state_name || '' }
        ]
      }
    })

    const vendorsUsingState = await prisma.vendor_details.findFirst({
      where: { state: stateId.toString() }
    })

    if (customersUsingState || vendorsUsingState) {
      return res.status(409).json({
        message: 'Cannot delete state as it is being used by customers or vendors'
      })
    }

    // Delete the state
    await prisma.states.delete({
      where: { id: stateId }
    })

    res.status(200).json({
      message: 'State deleted successfully'
    })
  } catch (error) {
    console.error('State deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete state',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}


export default withObservability(handler)