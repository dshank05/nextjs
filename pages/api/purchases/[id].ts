import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  switch (req.method) {
    case 'GET':
      try {
        const purchaseId = parseInt(id as string)
        if (isNaN(purchaseId)) {
          return res.status(400).json({ message: 'Invalid purchase ID' })
        }

        // Get the purchase record
        const purchase = await prisma.purchase.findUnique({
          where: { id: purchaseId }
        })

        if (!purchase) {
          return res.status(404).json({ message: 'Purchase not found' })
        }

        // Get the purchase items for this invoice
        const purchaseItems = await prisma.purchaseitems.findMany({
          where: { invoice_no: purchase.invoice_no }
        })

        // ✅ Now that Prisma client is regenerated, use direct vendor_id FK lookup
        let vendorData = null;
        if (purchase.vendor_id) {
          vendorData = await prisma.vendor_details.findUnique({
            where: { id: purchase.vendor_id }
          });
        }

        const enhancedPurchase = {
          ...purchase,
          vendor_name: vendorData?.vendor_name || purchase.bill_reference || 'Unknown Vendor',
          vendor_address: vendorData?.address || null,
          vendor_gstin: vendorData?.tax_id || null,
          items: purchaseItems,
          formattedDate: purchase.invoice_date,
          bill_reference: purchase.bill_reference,
          staff_details: purchase.staff_details,
          descriptions: purchase.descriptions,
          contact_number: vendorData?.contact_no || null,
          email_id: vendorData?.email || null
        }

        res.status(200).json(enhancedPurchase)

      } catch (error) {
        console.error('Get purchase error:', error)
        res.status(500).json({ message: 'Failed to fetch purchase', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    case 'PUT':
      try {
        const purchaseId = parseInt(id as string)
        if (isNaN(purchaseId)) {
          return res.status(400).json({ message: 'Invalid purchase ID' })
        }

        const {
          bill_reference,
          staff_details,
          notes,
          descriptions,
          status,
          payment_mode,
          transport
        } = req.body

        const updatedPurchase = await prisma.purchase.update({
          where: { id: purchaseId },
          data: {
            bill_reference: bill_reference || null,
            staff_details: staff_details || null,
            notes: notes || null,
            descriptions: descriptions || null,
            status: status ? parseInt(status) : null,
            payment_mode: payment_mode ? parseInt(payment_mode) : null,
            transport: transport || null,
          }
        })

        // Get updated items
        const purchaseItems = await prisma.purchaseitems.findMany({
          where: { invoice_no: updatedPurchase.invoice_no }
        })

        // ✅ Use vendor_id FK lookup for updated purchase
        let vendorData = null;
        if (updatedPurchase.vendor_id) {
          vendorData = await prisma.vendor_details.findUnique({
            where: { id: updatedPurchase.vendor_id }
          });
        }

        const enhancedPurchase = {
          ...updatedPurchase,
          vendor_name: vendorData?.vendor_name || updatedPurchase.bill_reference || 'Unknown Vendor',
          vendor_address: vendorData?.address || null,
          vendor_gstin: vendorData?.tax_id || null,
          items: purchaseItems,
          formattedDate: updatedPurchase.invoice_date,
          bill_reference: updatedPurchase.bill_reference,
          staff_details: updatedPurchase.staff_details,
          descriptions: updatedPurchase.descriptions,
          contact_number: vendorData?.contact_no || null,
          email_id: vendorData?.email || null
        }

        res.status(200).json(enhancedPurchase)

      } catch (error) {
        console.error('Update purchase error:', error)
        res.status(500).json({ message: 'Failed to update purchase', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    case 'DELETE':
      try {
        const purchaseId = parseInt(id as string)
        if (isNaN(purchaseId)) {
          return res.status(400).json({ message: 'Invalid purchase ID' })
        }

        // First delete associated items
        const purchase = await prisma.purchase.findUnique({
          where: { id: purchaseId },
          select: { invoice_no: true }
        })

        if (purchase) {
          await prisma.purchaseitems.deleteMany({
            where: { invoice_no: purchase.invoice_no }
          })
        }

        // Then delete purchase
        await prisma.purchase.delete({
          where: { id: purchaseId }
        })

        res.status(204).end()

      } catch (error) {
        console.error('Delete purchase error:', error)
        res.status(500).json({ message: 'Failed to delete purchase', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE'])
      res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}
