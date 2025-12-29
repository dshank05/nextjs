import { prisma } from './db'

/**
 * Payment Allocation Service
 * Handles payment and refund allocation logic for sales and purchases
 */

/**
 * Calculate payment status for sales/invoices (0/1/2)
 * 0 = Unpaid, 1 = Paid, 2 = Partially Paid
 */
export async function calculatePaymentStatus(invoiceId: number, type: 'sale'|'salex'): Promise<number> {
  // Get invoice total
  const invoice = type === 'sale'
    ? await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { total: true } })
    : await prisma.invoicex.findUnique({ where: { id: invoiceId }, select: { total: true } });

  if (!invoice) return 0;

  // Get total allocated payments
  const allocations = type === 'sale'
    ? await prisma.customer_payment_allocations.aggregate({
        where: { invoice_id: invoiceId },
        _sum: { allocated_amount: true }
      })
    : await prisma.customer_payment_allocations.aggregate({
        where: { invoicex_id: invoiceId },
        _sum: { allocated_amount: true }
      });

  const totalPaid = Number(allocations._sum.allocated_amount || 0);
  const totalAmount = Number(invoice.total);

  if (totalPaid === 0) return 0;        // Unpaid
  if (totalPaid >= totalAmount) return 1; // Fully Paid
  return 2;                             // Partially Paid
}

/**
 * Calculate refund status for returns (0/1/2)
 * 0 = Unpaid, 1 = Refunded, 2 = Partially Refunded
 */
export async function calculateRefundStatus(returnId: number, type: 'sale'|'salex'): Promise<number> {
  // Get return refund amount
  const returnRecord = type === 'sale'
    ? await prisma.sale_returns.findUnique({ where: { id: returnId }, select: { refund_amount: true } })
    : await prisma.salex_returns.findUnique({ where: { id: returnId }, select: { refund_amount: true } });

  if (!returnRecord) return 0;

  // Get total allocated refunds
  const allocations = type === 'sale'
    ? await prisma.customer_refund_allocations.aggregate({
        where: { sale_return_id: returnId },
        _sum: { allocated_amount: true }
      })
    : await prisma.customer_refund_allocations.aggregate({
        where: { salex_return_id: returnId },
        _sum: { allocated_amount: true }
      });

  const totalRefunded = Number(allocations._sum.allocated_amount || 0);
  const totalRefund = Number(returnRecord.refund_amount);

  if (totalRefunded === 0) return 0;        // Unpaid
  if (totalRefunded >= totalRefund) return 1; // Fully Refunded
  return 2;                                 // Partially Refunded
}

/**
 * Get outstanding amount for an invoice
 */
export function getOutstandingAmount(invoiceId: number, type: 'sale'|'salex'): Promise<number> {
  // This will be implemented when we add the allocation queries
  return Promise.resolve(0);
}

/**
 * Validate payment allocation
 */
export async function validatePaymentAllocation(
  customerId: number,
  paymentAmount: number,
  allocations: Array<{ invoice_id?: number; invoicex_id?: number; allocated_amount: number }>
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check total allocation doesn't exceed payment amount
  const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.allocated_amount, 0);
  if (totalAllocated > paymentAmount) {
    errors.push(`Total allocated amount (${totalAllocated}) exceeds payment amount (${paymentAmount})`);
  }

  // Check each allocation against outstanding amounts
  for (const allocation of allocations) {
    const invoiceId = allocation.invoice_id || allocation.invoicex_id;
    const type = allocation.invoice_id ? 'sale' : 'salex';

    if (!invoiceId) continue;

    // Get invoice total
    const invoice = type === 'sale'
      ? await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { total: true } })
      : await prisma.invoicex.findUnique({ where: { id: invoiceId }, select: { total: true } });

    if (!invoice) {
      errors.push(`Invoice ${invoiceId} not found`);
      continue;
    }

    // Get already allocated amount
    const existingAllocations = type === 'sale'
      ? await prisma.customer_payment_allocations.aggregate({
          where: { invoice_id: invoiceId },
          _sum: { allocated_amount: true }
        })
      : await prisma.customer_payment_allocations.aggregate({
          where: { invoicex_id: invoiceId },
          _sum: { allocated_amount: true }
        });

    const alreadyAllocated = Number(existingAllocations._sum.allocated_amount || 0);
    const outstanding = Number(invoice.total) - alreadyAllocated;

    if (allocation.allocated_amount > outstanding) {
      errors.push(`Allocation to invoice ${invoiceId} (${allocation.allocated_amount}) exceeds outstanding amount (${outstanding})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate refund allocation
 */
export async function validateRefundAllocation(
  customerId: number,
  refundAmount: number,
  allocations: Array<{ return_id?: number; allocated_amount: number }>
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check total allocation doesn't exceed refund amount
  const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.allocated_amount, 0);
  if (totalAllocated > refundAmount) {
    errors.push(`Total allocated amount (${totalAllocated}) exceeds refund amount (${refundAmount})`);
  }

  // Check each allocation against outstanding refund amounts
  for (const allocation of allocations) {
    if (!allocation.return_id) continue;

    // Determine if it's sale or salex return
    const saleReturn = await prisma.sale_returns.findUnique({
      where: { id: allocation.return_id },
      select: { refund_amount: true }
    });

    const salexReturn = !saleReturn ? await prisma.salex_returns.findUnique({
      where: { id: allocation.return_id },
      select: { refund_amount: true }
    }) : null;

    const returnRecord = saleReturn || salexReturn;
    if (!returnRecord) {
      errors.push(`Return ${allocation.return_id} not found`);
      continue;
    }

    // Get already allocated refund amount
    const existingAllocations = saleReturn
      ? await prisma.customer_refund_allocations.aggregate({
          where: { sale_return_id: allocation.return_id },
          _sum: { allocated_amount: true }
        })
      : await prisma.customer_refund_allocations.aggregate({
          where: { salex_return_id: allocation.return_id },
          _sum: { allocated_amount: true }
        });

    const alreadyAllocated = Number(existingAllocations._sum.allocated_amount || 0);
    const outstanding = Number(returnRecord.refund_amount) - alreadyAllocated;

    if (allocation.allocated_amount > outstanding) {
      errors.push(`Allocation to return ${allocation.return_id} (${allocation.allocated_amount}) exceeds outstanding refund amount (${outstanding})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
