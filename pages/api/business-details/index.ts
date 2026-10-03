import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isValidGstin } from '../../../lib/gst'
import { fail, parseId } from '../../../lib/api/respond'
import { isTenDigitPhone, isValidEmail } from '../../../lib/validators'

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
    return fail(res, error, 'fetch business details')
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

    // Required fields validation (trimmed: a name of only spaces is none)
    const blank = (v: unknown) => typeof v !== 'string' || !v.trim()
    if (blank(gstin) || blank(name) || blank(address_line_1)) {
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
    // S-78: this was a third local copy of a rule lib/validators already
    // exports, alongside the one in businessdetails.tsx. One rule, one home.
    const isTenDigits = isTenDigitPhone

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

    // Email was never checked here or on the page (the rule existed in lib/validators).
    if (typeof email === 'string' && email.trim() && !isValidEmail(email)) {
      return res.status(400).json({ message: 'Email address is not valid' })
    }

    if (fax && !isTenDigits(fax)) {
      return res.status(400).json({
        message: 'Landline number must be exactly 10 digits'
      })
    }

    // S-88: this used to write all eleven columns unconditionally, so a caller
    // that omitted `tagline` or `terms` had them NULLed - the F-78 shape. The
    // three required fields are always written, because they are validated
    // above; the optional ones are written only when they were sent.
    //
    // An explicit `null` still clears a field. `undefined` - the key absent
    // altogether - leaves it alone.
    const data: any = {
      // Validated case-insensitively, so stored in the one case GSTINs are written in.
      gstin: gstin.trim().toUpperCase(),
      name: name.trim(),
      address_line_1: address_line_1.trim()
    }

    const optional: Array<[string, unknown]> = [
      ['tagline', tagline],
      ['address_line_2', address_line_2],
      ['pin_code', pin_code],
      ['phone', phone],
      ['phone2', phone2],
      ['email', email],
      ['fax', fax],
      ['terms', terms]
    ]
    for (const [key, value] of optional) {
      if (value !== undefined) {
        // A number (pin code sent as 400001) is kept as text, not wiped to null.
        data[key] = typeof value === 'string' ? (value.trim() || null)
          : typeof value === 'number' && Number.isFinite(value) ? String(value) : null
      }
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
    const recordId = parseId(id)
    if (recordId === null) {
      return res.status(400).json({ message: 'A valid business details ID is required' })
    }

    const existingDetails = await prisma.business_details.findUnique({
      where: { id: recordId }
    })

    if (!existingDetails) {
      return res.status(404).json({
        message: 'Business details not found'
      })
    }

    const updatedDetails = await prisma.business_details.update({
      where: { id: recordId },
      data
    })

    res.status(200).json({
      status: "success",
      message: "Business details updated successfully",
      data: updatedDetails
    })
  } catch (error) {
    return fail(res, error, 'update business details')
  }
}

export default withObservability(handler)
