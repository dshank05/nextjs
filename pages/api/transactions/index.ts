import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'PUT':
      return handlePut(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      page = '1',
      limit = '50',
      search = '',
      transactionType = '',
      startDate = '',
      endDate = '',
      fy = '',
      amountMin = '',
      amountMax = '',
      paymentMode = ''
    } = req.query

    const pageNum = parseInt(Array.isArray(page) ? page[0] : page)
    const limitNum = parseInt(Array.isArray(limit) ? limit[0] : limit)
    const skip = (pageNum - 1) * limitNum

    // Build where conditions
    const incexpWhere: any = {}
    const incexpxWhere: any = {}

    // Search filter
    const searchStr = Array.isArray(search) ? search[0] : search
    if (searchStr && searchStr.trim()) {
      const searchLower = searchStr.toLowerCase()
      incexpWhere.notes = { contains: searchLower }
      incexpxWhere.notes = { contains: searchLower }
    }

    // Transaction type filter
    const typeStr = Array.isArray(transactionType) ? transactionType[0] : transactionType
    if (typeStr && typeStr.trim()) {
      const typeNum = parseInt(typeStr)
      incexpWhere.type = typeNum
      incexpxWhere.type = typeNum
    }

    // Date filters
    const startDateStr = Array.isArray(startDate) ? startDate[0] : startDate
    const endDateStr = Array.isArray(endDate) ? endDate[0] : endDate
    if (startDateStr && startDateStr.trim()) {
      const start = new Date(startDateStr).toISOString().split('T')[0]
      incexpWhere.incexp_date = { gte: start }
      incexpxWhere.incexp_date = { gte: start }
    }
    if (endDateStr && endDateStr.trim()) {
      const end = new Date(endDateStr).toISOString().split('T')[0]
      incexpWhere.incexp_date = incexpWhere.incexp_date
        ? { ...incexpWhere.incexp_date, lte: end }
        : { lte: end }
      incexpxWhere.incexp_date = incexpxWhere.incexp_date
        ? { ...incexpxWhere.incexp_date, lte: end }
        : { lte: end }
    }

    // Financial year filter
    const fyStr = Array.isArray(fy) ? fy[0] : fy
    if (fyStr && fyStr.trim()) {
      incexpWhere.fy = parseInt(fyStr)
      incexpxWhere.fy = parseInt(fyStr)
    }

    // Amount filters
    const amountMinStr = Array.isArray(amountMin) ? amountMin[0] : amountMin
    const amountMaxStr = Array.isArray(amountMax) ? amountMax[0] : amountMax
    if (amountMinStr && amountMinStr.trim()) {
      const minAmt = parseFloat(amountMinStr)
      incexpWhere.amt = { gte: minAmt }
      incexpxWhere.amt = { gte: minAmt }
    }
    if (amountMaxStr && amountMaxStr.trim()) {
      const maxAmt = parseFloat(amountMaxStr)
      incexpWhere.amt = incexpWhere.amt ? { ...incexpWhere.amt, lte: maxAmt } : { lte: maxAmt }
      incexpxWhere.amt = incexpxWhere.amt ? { ...incexpxWhere.amt, lte: maxAmt } : { lte: maxAmt }
    }

    // Payment mode filter
    const paymentModeStr = Array.isArray(paymentMode) ? paymentMode[0] : paymentMode
    if (paymentModeStr && paymentModeStr.trim()) {
      incexpWhere.payment_mode = parseInt(paymentModeStr)
      incexpxWhere.payment_mode = parseInt(paymentModeStr)
    }

    // Fetch data from both tables
    const [incexpResults, incexpxResults] = await Promise.all([
      // Regular sales transactions
      prisma.incexp.findMany({
        where: incexpWhere,
        skip,
        take: limitNum,
        orderBy: { id: 'desc' }
      }),
      // Tax-exempt sales transactions
      prisma.incexpx.findMany({
        where: incexpxWhere,
        skip,
        take: limitNum,
        orderBy: { id: 'desc' }
      })
    ])

    // Get billing details separately for related invoices
    const invoiceIds = incexpResults.filter(tx => tx.invoice_id).map(tx => tx.invoice_id!)
    const invoiceXIds = incexpxResults.filter(tx => tx.invoice_id).map(tx => tx.invoice_id!)

    const [invoices, invoicesx, billToSales, billToSalesX] = await Promise.all([
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, invoice_no: true }
      }),
      prisma.invoicex.findMany({
        where: { id: { in: invoiceXIds } },
        select: { id: true, invoice_no: true }
      }),
      prisma.customer_details.findMany({
        where: {
          bill_tosales: {
            some: {
              invoice_no: { in: invoiceIds }
            }
          }
        },
        select: {
          id: true,
          billing_name: true,
          billing_gstin: true,
          bill_tosales: {
            select: {
              invoice_no: true
            }
          }
        }
      }),
      prisma.customer_details.findMany({
        where: {
          bill_tosalesx: {
            some: {
              invoice_no: { in: invoiceXIds }
            }
          }
        },
        select: {
          id: true,
          billing_name: true,
          billing_gstin: true,
          bill_tosalesx: {
            select: {
              invoice_no: true
            }
          }
        }
      })
    ])

    // Create lookup maps
    const invoiceMap = new Map(invoices.map(inv => [inv.id, inv.invoice_no]))
    const invoiceXMap = new Map(invoicesx.map(inv => [inv.id, inv.invoice_no]))

    const billToMap = new Map()
    billToSales.forEach(customer => {
      customer.bill_tosales.forEach(billToRecord => {
        const invoiceNo = billToRecord.invoice_no
        billToMap.set(invoiceNo, customer)
      })
    })

    const billToXMap = new Map()
    billToSalesX.forEach(customer => {
      customer.bill_tosalesx.forEach(billToRecord => {
        const invoiceNo = billToRecord.invoice_no
        billToXMap.set(invoiceNo, customer)
      })
    })

    // Combine results from both tables
    const allTransactions = [
      ...incexpResults.map(tx => {
        const invoice_no = tx.invoice_id ? invoiceMap.get(tx.invoice_id) : null
        const billing = invoice_no ? billToMap.get(invoice_no) : null
        return {
          ...tx,
          transaction_type: 'regular_sale' as const,
          customer_name: billing?.billing_name,
          customer_gstin: billing?.billing_gstin || '',
          invoice_no: invoice_no,
          invoice_id: tx.invoice_id
        }
      }),
      ...incexpxResults.map(tx => {
        const invoice_no = tx.invoice_id ? invoiceXMap.get(tx.invoice_id) : null
        const billing = invoice_no ? billToXMap.get(invoice_no) : null
        return {
          ...tx,
          transaction_type: 'tax_exempt_sale' as const,
          customer_name: billing?.billing_name,
          customer_gstin: billing?.billing_gstin || '',
          invoice_no: invoice_no,
          invoice_id: tx.invoice_id
        }
      })
    ]

    // Sort combined results by date (newest first) and apply pagination
    const sortedTransactions = allTransactions
      .sort((a, b) => new Date(b.incexp_date).getTime() - new Date(a.incexp_date).getTime())
      .slice(0, limitNum)

    // Get total counts for pagination
    const [incexpTotal, incexpxTotal] = await Promise.all([
      prisma.incexp.count({ where: incexpWhere }),
      prisma.incexpx.count({ where: incexpxWhere })
    ])

    const totalRecords = incexpTotal + incexpxTotal
    const totalPages = Math.ceil(totalRecords / limitNum)

    // Format transactions for frontend
    const formattedTransactions = sortedTransactions.map(tx => ({
      id: tx.id,
      date: tx.incexp_date,
      type: tx.type === 1 ? 'income' : 'expense',
      amount: tx.amt,
      payment_mode: tx.payment_mode,
      notes: tx.notes,
      fy: tx.fy,
      user_id: tx.user_id,
      transaction_type: tx.transaction_type,
      customer_name: tx.customer_name,
      customer_gstin: tx.customer_gstin,
      invoice_no: tx.invoice_no,
      invoice_id: tx.invoice_id
    }))

    res.status(200).json({
      transactions: formattedTransactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalRecords,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Transaction fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch transactions',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, transaction_type, type, amt, payment_mode, notes } = req.body

    if (!id || !transaction_type) {
      return res.status(400).json({ message: 'Transaction ID and type required' })
    }

    let updatedTransaction

    if (transaction_type === 'regular_sale') {
      updatedTransaction = await prisma.incexp.update({
        where: { id: parseInt(id) },
        data: {
          type: type ? parseInt(type) : undefined,
          amt: amt ? parseFloat(amt) : undefined,
          payment_mode: payment_mode ? parseInt(payment_mode) : undefined,
          notes
        }
      })
    } else if (transaction_type === 'tax_exempt_sale') {
      updatedTransaction = await prisma.incexpx.update({
        where: { id: parseInt(id) },
        data: {
          type: type ? parseInt(type) : undefined,
          amt: amt ? parseFloat(amt) : undefined,
          payment_mode: payment_mode ? parseInt(payment_mode) : undefined,
          notes
        }
      })
    } else {
      return res.status(400).json({ message: 'Invalid transaction type' })
    }

    res.status(200).json(updatedTransaction)
  } catch (error) {
    console.error('Transaction update error:', error)
    res.status(500).json({
      message: 'Failed to update transaction',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, transaction_type } = req.body

    if (!id || !transaction_type) {
      return res.status(400).json({ message: 'Transaction ID and type required' })
    }

    if (transaction_type === 'regular_sale') {
      await prisma.incexp.delete({
        where: { id: parseInt(id) }
      })
    } else if (transaction_type === 'tax_exempt_sale') {
      await prisma.incexpx.delete({
        where: { id: parseInt(id) }
      })
    } else {
      return res.status(400).json({ message: 'Invalid transaction type' })
    }

    res.status(200).json({ message: 'Transaction deleted successfully' })
  } catch (error) {
    console.error('Transaction delete error:', error)
    res.status(500).json({
      message: 'Failed to delete transaction',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}


export default withObservability(handler)