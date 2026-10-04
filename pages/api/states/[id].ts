 import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isValidGstStateCode, MIN_GST_STATE_CODE, MAX_GST_STATE_CODE } from '../../../lib/gst'
import { fail } from '../../../lib/api/respond'

/**
 * Is anything using this state? Customers, vendors and every bill snapshot store
 * the state's NAME (vendors were checked by id, which they never store, so a
 * state used only by vendors could be deleted). Some older vendor rows may hold
 * the id as text, so both are checked there.
 */
async function stateInUse(stateId: number, name: string): Promise<boolean> {
  const [customer, vendor, sale, salex, purchase, shipto, shiptox] = await Promise.all([
    prisma.customer_details.findFirst({ where: { OR: [{ billing_state: name }, { shipping_state: name }] }, select: { id: true } }),
    prisma.vendor_details.findFirst({ where: { OR: [{ state: name }, { state: String(stateId) }] }, select: { id: true } }),
    prisma.bill_tosales.findFirst({ where: { billing_state: name }, select: { id: true } }),
    (prisma as any).bill_tosalesx.findFirst({ where: { billing_state: name }, select: { id: true } }),
    prisma.bill_to.findFirst({ where: { state: name }, select: { id: true } }),
    // E-09: the sale / Invoice C ship-to snapshots name a state too.
    prisma.shipto.findFirst({ where: { shipping_state: name }, select: { id: true } }),
    (prisma as any).shiptox.findFirst({ where: { shipping_state: name }, select: { id: true } })
  ])
  return !!(customer || vendor || sale || salex || purchase || shipto || shiptox)
}

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

    // Customers and bills hold the name; renaming a state they use would cut
    // them off from it and let it be deleted (owner, 2026-10-03: refuse).
    if (trimmedName !== (existingState.state_name || '') && await stateInUse(stateId, existingState.state_name || '')) {
      return res.status(409).json({
        message: 'Cannot rename this state: it is in use by customers, vendors or existing bills. Its GST state code can still be changed.'
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
    return fail(res, error, 'update state')
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

    if (await stateInUse(stateId, existingState.state_name || '')) {
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
    return fail(res, error, 'delete state')
  }
}


export default withObservability(handler)