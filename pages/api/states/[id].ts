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
          { state_name: trimmedName },
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

    // S-86: this returned `id` as a STRING while every other endpoint returns a
    // number, so a caller comparing ids had to know which one it was talking to.
    res.status(200).json({
      status: 'success',
      message: 'State updated successfully',
      data: updatedState,
      // Kept for the settings page, which does not read it today. Remove with
      // the rest of the legacy keys once every consumer reads `data`.
      state: updatedState
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

    // S-82: `existingState` above is the same row. This fetched it a second
    // time, four lines later, to read the one field it already had.
    //
    // Note what the two guards below reveal (S-70): customers store the state
    // NAME, vendors store the state ID as a string. Two representations of one
    // concept, in one database, which is why this check has to be written twice.
    const customersUsingState = await prisma.customer_details.findFirst({
      where: {
        OR: [
          { billing_state: existingState.state_name || '' },
          { shipping_state: existingState.state_name || '' }
        ]
      }
    })

    const vendorsUsingState = await prisma.vendor_details.findFirst({
      where: { state: stateId.toString() }
    })

    // S-85: the guard used to stop at live customers and vendors, so a state
    // named on historical invoices could still be destroyed - and those
    // snapshots store the state as free text, so nothing would have repaired
    // them. A billing snapshot is exactly what must not lose its meaning.
    const snapshotUsingState = await prisma.bill_tosales.findFirst({
      where: { billing_state: existingState.state_name || '' },
      select: { id: true }
    })

    if (customersUsingState || vendorsUsingState || snapshotUsingState) {
      return res.status(409).json({
        message: 'Cannot delete this state: it is in use by customers, vendors or existing documents'
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