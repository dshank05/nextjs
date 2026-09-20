import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isValidGstin } from '../../../lib/gst'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'PUT':
      return handlePut(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get the first (and should be only) business details record.
    // Ordered explicitly: without it, "first" is whatever the database feels
    // like returning, so a second row would make this endpoint answer
    // inconsistently between calls.
    const businessDetails = await prisma.business_details.findFirst({
      orderBy: { id: 'asc' }
    })

    // If no data exists, return an empty object
    if (!businessDetails) {
      return res.status(200).json({})
    }

    res.status(200).json(businessDetails)
  } catch (error) {
    console.error('Business details fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch business details',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      id,
      gstin,
      name,
      tagline,
      address_line_1,
      address_line_2,
      pin_code,
      phone,
      phone2,
      email,
      fax,
      terms
    } = req.body

    // Required fields validation
    if (!gstin || !name || !address_line_1) {
      return res.status(400).json({
        message: 'GSTIN, name, and address line 1 are required'
      })
    }

    // GSTIN format. The first two digits are the supplier state code that
    // decides CGST+SGST vs IGST on every invoice, so a malformed GSTIN saved
    // here quietly mistaxes every document the business issues.
    if (!isValidGstin(gstin)) {
      return res.status(400).json({
        message: 'GSTIN is not valid. Expected 15 characters, e.g. 09ABFPM3900M1ZI, starting with a state code of 01-38.'
      })
    }

    // Phone validation: if present, exactly 10 DIGITS. This used to check
    // `.length !== 10`, which accepted any ten characters - "abcdefghij" was a
    // valid phone number.
    const isTenDigits = (value: string) => /^[0-9]{10}$/.test(value.trim())

    if (phone && !isTenDigits(phone)) {
      return res.status(400).json({
        message: 'Phone number must be exactly 10 digits'
      })
    }

    if (phone2 && !isTenDigits(phone2)) {
      return res.status(400).json({
        message: 'Phone 2 number must be exactly 10 digits'
      })
    }

    if (fax && !isTenDigits(fax)) {
      return res.status(400).json({
        message: 'Landline number must be exactly 10 digits'
      })
    }

    const data = {
      gstin: gstin.trim(),
      name: name.trim(),
      tagline: tagline?.trim() || null,
      address_line_1: address_line_1.trim(),
      address_line_2: address_line_2?.trim() || null,
      pin_code: pin_code?.trim() || null,
      phone: phone?.trim() || null,
      phone2: phone2?.trim() || null,
      email: email?.trim() || null,
      fax: fax?.trim() || null,
      terms: terms?.trim() || null
    }

    // If id is 0 or not provided, create a new record - but only if there is
    // genuinely no record yet. business_details is a singleton: the whole app
    // reads it with findFirst(), so a second row means some screens show one
    // set of company details and some show the other. This used to create a
    // new row on every id-less PUT.
    if (!id || id === 0) {
      const existing = await prisma.business_details.findFirst({
        orderBy: { id: 'asc' }
      })

      if (existing) {
        const updated = await prisma.business_details.update({
          where: { id: existing.id },
          data
        })

        return res.status(200).json({
          status: "success",
          message: "Business details updated successfully",
          data: updated
        })
      }

      const newDetails = await prisma.business_details.create({
        data
      })

      return res.status(200).json({
        status: "success",
        message: "Business details created successfully",
        data: newDetails
      })
    }

    // Otherwise, update existing record
    const existingDetails = await prisma.business_details.findUnique({
      where: { id: parseInt(id) }
    })

    if (!existingDetails) {
      return res.status(404).json({
        message: 'Business details not found'
      })
    }

    const updatedDetails = await prisma.business_details.update({
      where: { id: parseInt(id) },
      data
    })

    res.status(200).json({
      status: "success",
      message: "Business details updated successfully",
      data: updatedDetails
    })
  } catch (error) {
    console.error('Business details update error:', error)
    res.status(500).json({
      message: 'Failed to update business details',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
