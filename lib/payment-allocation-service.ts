/**
 * Payment & Refund Allocation Service
 * 
 * Helper functions for managing vendor payment and refund allocations.
 * Handles partial payments, payment status calculation, and allocation validation.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// PAYMENT STATUS CALCULATION
// ============================================================================

/**
 * Calculate payment status for a purchase based on allocated payments
 * @param purchaseId - ID of the purchase
 * @returns 0 (Unpaid), 1 (Fully Paid), or 2 (Partially Paid)
 */
export async function calculatePurchasePaymentStatus(
  purchaseId: number
): Promise<number> {
  try {
    // Get purchase total
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: { total: true }
    });

    if (!purchase) {
      throw new Error(`Purchase with ID ${purchaseId} not found`);
    }

    // Get total allocated to this purchase
    const allocations = await prisma.payment_allocations.aggregate({
      where: { purchase_id: purchaseId },
      _sum: { allocated_amount: true }
    });

    const totalPaid = Number(allocations._sum.allocated_amount || 0);
    const totalBill = Number(purchase.total);

    // Determine status
    if (totalPaid === 0) {
      return 0; // Unpaid
    } else if (totalPaid >= totalBill) {
      return 1; // Fully Paid
    } else {
      return 2; // Partially Paid
    }
  } catch (error) {
    console.error('Error calculating purchase payment status:', error);
    throw error;
  }
}

/**
 * Calculate refund status for a return based on allocated refunds
 * @param returnId - ID of the purchase return
 * @returns 0 (Unpaid), 1 (Fully Refunded), or 2 (Partially Refunded)
 */
export async function calculateReturnRefundStatus(
  returnId: number
): Promise<number> {
  try {
    // Get return refund amount
    const returnRecord = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: { refund_amount: true, total_amount: true }
    });

    if (!returnRecord) {
      throw new Error(`Purchase return with ID ${returnId} not found`);
    }

    // Use refund_amount if set, otherwise use total_amount
    const totalReturn = Number(returnRecord.refund_amount || returnRecord.total_amount);

    // Get total allocated to this return
    const allocations = await prisma.refund_allocations.aggregate({
      where: { return_id: returnId },
      _sum: { allocated_amount: true }
    });

    const totalRefunded = Number(allocations._sum.allocated_amount || 0);

    // Determine status
    if (totalRefunded === 0) {
      return 0; // Unpaid (no refund received)
    } else if (totalRefunded >= totalReturn) {
      return 1; // Fully Refunded
    } else {
      return 2; // Partially Refunded
    }
  } catch (error) {
    console.error('Error calculating return refund status:', error);
    throw error;
  }
}

// ============================================================================
// PAYMENT HISTORY
// ============================================================================

/**
 * Get payment history for a purchase
 * @param purchaseId - ID of the purchase
 * @returns Array of payment allocations with payment details
 */
export async function getPaymentHistory(purchaseId: number) {
  try {
    const allocations = await prisma.payment_allocations.findMany({
      where: { purchase_id: purchaseId },
      include: {
        payment: {
          select: {
            id: true,
            payment_date: true,
            payment_amount: true,
            payment_mode: true,
            payment_type: true,
            notes: true,
            created_at: true
          }
        }
      },
      orderBy: {
        allocation_date: 'desc'
      }
    });

    return allocations.map(allocation => ({
      allocation_id: allocation.id,
      payment_id: allocation.payment_id,
      allocated_amount: Number(allocation.allocated_amount),
      allocation_date: allocation.allocation_date,
      allocation_notes: allocation.notes,
      payment_date: allocation.payment.payment_date,
      payment_amount: Number(allocation.payment.payment_amount),
      payment_mode: allocation.payment.payment_mode,
      payment_type: allocation.payment.payment_type,
      payment_notes: allocation.payment.notes,
      created_at: allocation.created_at
    }));
  } catch (error) {
    console.error('Error fetching payment history:', error);
    throw error;
  }
}

/**
 * Get refund history for a purchase return
 * @param returnId - ID of the purchase return
 * @returns Array of refund allocations with refund details
 */
export async function getRefundHistory(returnId: number) {
  try {
    const allocations = await prisma.refund_allocations.findMany({
      where: { return_id: returnId },
      include: {
        refund: {
          select: {
            id: true,
            refund_date: true,
            refund_amount: true,
            refund_mode: true,
            refund_type: true,
            notes: true,
            created_at: true
          }
        }
      },
      orderBy: {
        allocation_date: 'desc'
      }
    });

    return allocations.map(allocation => ({
      allocation_id: allocation.id,
      refund_id: allocation.refund_id,
      allocated_amount: Number(allocation.allocated_amount),
      allocation_date: allocation.allocation_date,
      allocation_notes: allocation.notes,
      refund_date: allocation.refund.refund_date,
      refund_amount: Number(allocation.refund.refund_amount),
      refund_mode: allocation.refund.refund_mode,
      refund_type: allocation.refund.refund_type,
      refund_notes: allocation.refund.notes,
      created_at: allocation.created_at
    }));
  } catch (error) {
    console.error('Error fetching refund history:', error);
    throw error;
  }
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate payment allocation request
 * @param vendorId - ID of the vendor
 * @param paymentAmount - Total payment amount
 * @param allocations - Array of allocations to validate
 * @returns Object with validation result and any errors
 */
export async function validatePaymentAllocation(
  vendorId: number,
  paymentAmount: number,
  allocations: Array<{ purchase_id: number; allocated_amount: number }>
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    // 1. Check if payment amount is positive
    if (paymentAmount <= 0) {
      errors.push('Payment amount must be greater than 0');
    }

    // 2. Check if allocations exist
    if (!allocations || allocations.length === 0) {
      errors.push('At least one allocation is required');
      return { valid: false, errors };
    }

    // 3. Calculate total allocated amount
    const totalAllocated = allocations.reduce(
      (sum, alloc) => sum + Number(alloc.allocated_amount),
      0
    );

    // 4. Check if total allocated matches payment amount
    if (Math.abs(totalAllocated - paymentAmount) > 0.01) {
      errors.push(
        `Total allocated amount (${totalAllocated}) must equal payment amount (${paymentAmount})`
      );
    }

    // 5. Validate each allocation
    for (const allocation of allocations) {
      // Check if allocated amount is positive
      if (allocation.allocated_amount <= 0) {
        errors.push(
          `Allocation amount for purchase ${allocation.purchase_id} must be greater than 0`
        );
        continue;
      }

      // Check if purchase exists and belongs to vendor
      const purchase = await prisma.purchase.findUnique({
        where: { id: allocation.purchase_id },
        select: {
          id: true,
          vendor_id: true,
          total: true,
          payment_status: true
        }
      });

      if (!purchase) {
        errors.push(`Purchase with ID ${allocation.purchase_id} not found`);
        continue;
      }

      if (purchase.vendor_id !== vendorId) {
        errors.push(
          `Purchase ${allocation.purchase_id} does not belong to vendor ${vendorId}`
        );
        continue;
      }

      // Get current paid amount
      const currentAllocations = await prisma.payment_allocations.aggregate({
        where: { purchase_id: allocation.purchase_id },
        _sum: { allocated_amount: true }
      });

      const currentPaid = Number(currentAllocations._sum.allocated_amount || 0);
      const newTotal = currentPaid + allocation.allocated_amount;
      const purchaseTotal = Number(purchase.total);

      // Check if new allocation would exceed purchase total
      if (newTotal > purchaseTotal + 0.01) {
        errors.push(
          `Allocation for purchase ${allocation.purchase_id} would exceed bill amount. ` +
          `Current: ₹${currentPaid}, New: ₹${allocation.allocated_amount}, Total: ₹${purchaseTotal}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  } catch (error) {
    console.error('Error validating payment allocation:', error);
    errors.push('An error occurred during validation');
    return { valid: false, errors };
  }
}

/**
 * Validate refund allocation request
 * @param vendorId - ID of the vendor
 * @param refundAmount - Total refund amount
 * @param allocations - Array of allocations to validate
 * @returns Object with validation result and any errors
 */
export async function validateRefundAllocation(
  vendorId: number,
  refundAmount: number,
  allocations: Array<{ return_id: number; allocated_amount: number }>
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    // 1. Check if refund amount is positive
    if (refundAmount <= 0) {
      errors.push('Refund amount must be greater than 0');
    }

    // 2. Check if allocations exist
    if (!allocations || allocations.length === 0) {
      errors.push('At least one allocation is required');
      return { valid: false, errors };
    }

    // 3. Calculate total allocated amount
    const totalAllocated = allocations.reduce(
      (sum, alloc) => sum + Number(alloc.allocated_amount),
      0
    );

    // 4. Check if total allocated matches refund amount
    if (Math.abs(totalAllocated - refundAmount) > 0.01) {
      errors.push(
        `Total allocated amount (${totalAllocated}) must equal refund amount (${refundAmount})`
      );
    }

    // 5. Validate each allocation
    for (const allocation of allocations) {
      // Check if allocated amount is positive
      if (allocation.allocated_amount <= 0) {
        errors.push(
          `Allocation amount for return ${allocation.return_id} must be greater than 0`
        );
        continue;
      }

      // Check if return exists and belongs to vendor
      const returnRecord = await prisma.purchase_returns.findUnique({
        where: { id: allocation.return_id },
        select: {
          id: true,
          vendor_id: true,
          refund_amount: true,
          total_amount: true,
          payment_status: true
        }
      });

      if (!returnRecord) {
        errors.push(`Purchase return with ID ${allocation.return_id} not found`);
        continue;
      }

      if (returnRecord.vendor_id !== vendorId) {
        errors.push(
          `Return ${allocation.return_id} does not belong to vendor ${vendorId}`
        );
        continue;
      }

      // Get current refunded amount
      const currentAllocations = await prisma.refund_allocations.aggregate({
        where: { return_id: allocation.return_id },
        _sum: { allocated_amount: true }
      });

      const currentRefunded = Number(currentAllocations._sum.allocated_amount || 0);
      const newTotal = currentRefunded + allocation.allocated_amount;
      const returnTotal = Number(returnRecord.refund_amount || returnRecord.total_amount);

      // Check if new allocation would exceed return total
      if (newTotal > returnTotal + 0.01) {
        errors.push(
          `Allocation for return ${allocation.return_id} would exceed return amount. ` +
          `Current: ₹${currentRefunded}, New: ₹${allocation.allocated_amount}, Total: ₹${returnTotal}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  } catch (error) {
    console.error('Error validating refund allocation:', error);
    errors.push('An error occurred during validation');
    return { valid: false, errors };
  }
}

// ============================================================================
// SUMMARY FUNCTIONS
// ============================================================================

/**
 * Get payment summary for a purchase
 * @param purchaseId - ID of the purchase
 * @returns Payment summary with totals and status
 */
export async function getPurchasePaymentSummary(purchaseId: number) {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        invoice_no: true,
        total: true,
        payment_status: true
      }
    });

    if (!purchase) {
      throw new Error(`Purchase with ID ${purchaseId} not found`);
    }

    const allocations = await prisma.payment_allocations.aggregate({
      where: { purchase_id: purchaseId },
      _sum: { allocated_amount: true },
      _count: true
    });

    const totalPaid = Number(allocations._sum.allocated_amount || 0);
    const totalBill = Number(purchase.total);
    const remaining = totalBill - totalPaid;

    return {
      purchase_id: purchase.id,
      invoice_no: purchase.invoice_no,
      total_bill: totalBill,
      total_paid: totalPaid,
      remaining_amount: remaining,
      payment_status: purchase.payment_status,
      payment_count: allocations._count
    };
  } catch (error) {
    console.error('Error fetching purchase payment summary:', error);
    throw error;
  }
}

/**
 * Get refund summary for a return
 * @param returnId - ID of the purchase return
 * @returns Refund summary with totals and status
 */
export async function getReturnRefundSummary(returnId: number) {
  try {
    const returnRecord = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        debit_note_no: true,
        refund_amount: true,
        total_amount: true,
        payment_status: true
      }
    });

    if (!returnRecord) {
      throw new Error(`Purchase return with ID ${returnId} not found`);
    }

    const allocations = await prisma.refund_allocations.aggregate({
      where: { return_id: returnId },
      _sum: { allocated_amount: true },
      _count: true
    });

    const totalRefunded = Number(allocations._sum.allocated_amount || 0);
    const totalReturn = Number(returnRecord.refund_amount || returnRecord.total_amount);
    const remaining = totalReturn - totalRefunded;

    return {
      return_id: returnRecord.id,
      debit_note_no: returnRecord.debit_note_no,
      total_return: totalReturn,
      total_refunded: totalRefunded,
      remaining_amount: remaining,
      payment_status: returnRecord.payment_status,
      refund_count: allocations._count
    };
  } catch (error) {
    console.error('Error fetching return refund summary:', error);
    throw error;
  }
}

// ============================================================================
// VENDOR SUMMARY
// ============================================================================

/**
 * Get outstanding bills for a vendor (unpaid or partially paid)
 * @param vendorId - ID of the vendor
 * @returns Array of outstanding purchases
 */
export async function getVendorOutstandingBills(vendorId: number) {
  try {
    const purchases = await prisma.purchase.findMany({
      where: {
        vendor_id: vendorId,
        payment_status: {
          in: [0, 2] // Unpaid or Partially Paid
        }
      },
      select: {
        id: true,
        invoice_no: true,
        invoice_date: true,
        total: true,
        payment_status: true,
        payment_allocations: {
          select: {
            allocated_amount: true
          }
        }
      },
      orderBy: {
        invoice_date: 'asc'
      }
    });

    return purchases.map(purchase => {
      const totalPaid = purchase.payment_allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount),
        0
      );
      const totalBill = Number(purchase.total);
      const outstanding = totalBill - totalPaid;

      return {
        purchase_id: purchase.id,
        invoice_no: purchase.invoice_no,
        invoice_date: purchase.invoice_date,
        total_bill: totalBill,
        total_paid: totalPaid,
        outstanding_amount: outstanding,
        payment_status: purchase.payment_status
      };
    });
  } catch (error) {
    console.error('Error fetching vendor outstanding bills:', error);
    throw error;
  }
}

/**
 * Get outstanding returns for a vendor (unpaid or partially refunded)
 * @param vendorId - ID of the vendor
 * @returns Array of outstanding returns
 */
export async function getVendorOutstandingReturns(vendorId: number) {
  try {
    const returns = await prisma.purchase_returns.findMany({
      where: {
        vendor_id: vendorId,
        payment_status: {
          in: [0, 2] // Unpaid or Partially Refunded
        }
      },
      select: {
        id: true,
        debit_note_no: true,
        return_date: true,
        refund_amount: true,
        total_amount: true,
        payment_status: true,
        refund_allocations: {
          select: {
            allocated_amount: true
          }
        }
      },
      orderBy: {
        return_date: 'asc'
      }
    });

    return returns.map(returnRecord => {
      const totalRefunded = returnRecord.refund_allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount),
        0
      );
      const totalReturn = Number(returnRecord.refund_amount || returnRecord.total_amount);
      const outstanding = totalReturn - totalRefunded;

      return {
        return_id: returnRecord.id,
        debit_note_no: returnRecord.debit_note_no,
        return_date: returnRecord.return_date,
        total_return: totalReturn,
        total_refunded: totalRefunded,
        outstanding_amount: outstanding,
        payment_status: returnRecord.payment_status
      };
    });
  } catch (error) {
    console.error('Error fetching vendor outstanding returns:', error);
    throw error;
  }
}
