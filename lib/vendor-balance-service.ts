import { prisma } from './db';

/**
 * Vendor Balance Service
 * Manages vendor account balance tracking for direct payments and credit management
 */

interface BalanceUpdate {
  total_paid?: number;
  total_allocated?: number;
  total_refunded?: number;
  total_refund_allocated?: number;
}

interface VendorBalance {
  balance: number;
  total_paid: number;
  total_allocated: number;
  total_refunded: number;
  total_refund_allocated: number;
  unallocated_payment: number;
  unallocated_refund: number;
}

/**
 * Update vendor account balance
 * Increments/decrements balance fields and recalculates account_balance
 * 
 * @param vendorId - Vendor ID
 * @param updates - Object with fields to update (positive = add, negative = subtract)
 * @returns New balance
 */
export async function updateVendorBalance(
  vendorId: number,
  updates: BalanceUpdate
): Promise<number> {
  // Get current values
  const vendor = await prisma.vendor_details.findUnique({
    where: { id: vendorId },
    select: {
      total_paid: true,
      total_allocated: true,
      total_refunded: true,
      total_refund_allocated: true
    }
  });

  if (!vendor) {
    throw new Error(`Vendor ${vendorId} not found`);
  }

  // Calculate new values (add the updates to current values)
  const newTotalPaid = Number(vendor.total_paid) + (updates.total_paid || 0);
  const newTotalAllocated = Number(vendor.total_allocated) + (updates.total_allocated || 0);
  const newTotalRefunded = Number(vendor.total_refunded) + (updates.total_refunded || 0);
  const newTotalRefundAllocated = Number(vendor.total_refund_allocated) + (updates.total_refund_allocated || 0);

  // Calculate balance
  // Balance = Money In - Money Out
  // Money In: Payments (we pay vendor)
  // Money Out: Allocations (applied to bills) + Refunds (vendor returns money) - Refund Allocations (applied to returns)
  const newBalance = newTotalPaid - newTotalAllocated - newTotalRefunded + newTotalRefundAllocated;

  // Update vendor
  await prisma.vendor_details.update({
    where: { id: vendorId },
    data: {
      total_paid: newTotalPaid,
      total_allocated: newTotalAllocated,
      total_refunded: newTotalRefunded,
      total_refund_allocated: newTotalRefundAllocated,
      account_balance: newBalance
    }
  });

  return newBalance;
}

/**
 * Get vendor balance details
 * 
 * @param vendorId - Vendor ID
 * @returns Balance breakdown
 */
export async function getVendorBalance(vendorId: number): Promise<VendorBalance> {
  const vendor = await prisma.vendor_details.findUnique({
    where: { id: vendorId },
    select: {
      account_balance: true,
      total_paid: true,
      total_allocated: true,
      total_refunded: true,
      total_refund_allocated: true
    }
  });

  if (!vendor) {
    throw new Error(`Vendor ${vendorId} not found`);
  }

  const totalPaid = Number(vendor.total_paid);
  const totalAllocated = Number(vendor.total_allocated);
  const totalRefunded = Number(vendor.total_refunded);
  const totalRefundAllocated = Number(vendor.total_refund_allocated);

  return {
    balance: Number(vendor.account_balance),
    total_paid: totalPaid,
    total_allocated: totalAllocated,
    total_refunded: totalRefunded,
    total_refund_allocated: totalRefundAllocated,
    unallocated_payment: totalPaid - totalAllocated,
    unallocated_refund: totalRefunded - totalRefundAllocated
  };
}

/**
 * Update customer account balance
 * Same logic as vendor but for customers
 * 
 * @param customerId - Customer ID
 * @param updates - Object with fields to update
 * @returns New balance
 */
export async function updateCustomerBalance(
  customerId: number,
  updates: BalanceUpdate
): Promise<number> {
  // Get current values
  const customer = await prisma.customer_details.findUnique({
    where: { id: customerId },
    select: {
      total_paid: true,
      total_allocated: true,
      total_refunded: true,
      total_refund_allocated: true
    }
  });

  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  // Calculate new values
  const newTotalPaid = Number(customer.total_paid) + (updates.total_paid || 0);
  const newTotalAllocated = Number(customer.total_allocated) + (updates.total_allocated || 0);
  const newTotalRefunded = Number(customer.total_refunded) + (updates.total_refunded || 0);
  const newTotalRefundAllocated = Number(customer.total_refund_allocated) + (updates.total_refund_allocated || 0);

  // Calculate balance (for customers: positive = they owe us, negative = we owe them)
  const newBalance = newTotalPaid - newTotalAllocated - newTotalRefunded + newTotalRefundAllocated;

  // Update customer
  await prisma.customer_details.update({
    where: { id: customerId },
    data: {
      total_paid: newTotalPaid,
      total_allocated: newTotalAllocated,
      total_refunded: newTotalRefunded,
      total_refund_allocated: newTotalRefundAllocated,
      account_balance: newBalance
    }
  });

  return newBalance;
}

/**
 * Get customer balance details
 * 
 * @param customerId - Customer ID
 * @returns Balance breakdown
 */
export async function getCustomerBalance(customerId: number): Promise<VendorBalance> {
  const customer = await prisma.customer_details.findUnique({
    where: { id: customerId },
    select: {
      account_balance: true,
      total_paid: true,
      total_allocated: true,
      total_refunded: true,
      total_refund_allocated: true
    }
  });

  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  const totalPaid = Number(customer.total_paid);
  const totalAllocated = Number(customer.total_allocated);
  const totalRefunded = Number(customer.total_refunded);
  const totalRefundAllocated = Number(customer.total_refund_allocated);

  return {
    balance: Number(customer.account_balance),
    total_paid: totalPaid,
    total_allocated: totalAllocated,
    total_refunded: totalRefunded,
    total_refund_allocated: totalRefundAllocated,
    unallocated_payment: totalPaid - totalAllocated,
    unallocated_refund: totalRefunded - totalRefundAllocated
  };
}

/**
 * Initialize balances for existing vendors
 * Calculates balance from existing payment/refund allocation data
 * Run this once after migration to populate balances for existing vendors
 */
export async function initializeVendorBalances(): Promise<void> {
  const vendors = await prisma.vendor_details.findMany({
    select: { id: true }
  });

  for (const vendor of vendors) {
    // Get total payments
    const payments = await prisma.vendor_payments.aggregate({
      where: { vendor_id: vendor.id },
      _sum: { payment_amount: true }
    });

    // Get total payment allocations
    const paymentAllocs = await prisma.payment_allocations.aggregate({
      where: {
        payment: { vendor_id: vendor.id }
      },
      _sum: { allocated_amount: true }
    });

    // Get total refunds
    const refunds = await prisma.vendor_refunds.aggregate({
      where: { vendor_id: vendor.id },
      _sum: { refund_amount: true }
    });

    // Get total refund allocations
    const refundAllocs = await prisma.refund_allocations.aggregate({
      where: {
        refund: { vendor_id: vendor.id }
      },
      _sum: { allocated_amount: true }
    });

    const totalPaid = Number(payments._sum.payment_amount || 0);
    const totalAllocated = Number(paymentAllocs._sum.allocated_amount || 0);
    const totalRefunded = Number(refunds._sum.refund_amount || 0);
    const totalRefundAllocated = Number(refundAllocs._sum.allocated_amount || 0);

    const balance = totalPaid - totalAllocated - totalRefunded + totalRefundAllocated;

    // Update vendor
    await prisma.vendor_details.update({
      where: { id: vendor.id },
      data: {
        total_paid: totalPaid,
        total_allocated: totalAllocated,
        total_refunded: totalRefunded,
        total_refund_allocated: totalRefundAllocated,
        account_balance: balance
      }
    });

    console.log(`Initialized balance for vendor ${vendor.id}: ₹${balance}`);
  }

  console.log(`✅ Initialized balances for ${vendors.length} vendors`);
}

/**
 * Initialize balances for existing customers
 * Run this once after migration
 */
export async function initializeCustomerBalances(): Promise<void> {
  const customers = await prisma.customer_details.findMany({
    select: { id: true }
  });

  for (const customer of customers) {
    // Get total payments
    const payments = await prisma.customer_payments.aggregate({
      where: { customer_id: customer.id },
      _sum: { payment_amount: true }
    });

    // Get total payment allocations
    const paymentAllocs = await prisma.customer_payment_allocations.aggregate({
      where: {
        payment: { customer_id: customer.id }
      },
      _sum: { allocated_amount: true }
    });

    // Get total refunds
    const refunds = await prisma.customer_refunds.aggregate({
      where: { customer_id: customer.id },
      _sum: { refund_amount: true }
    });

    // Get total refund allocations
    const refundAllocs = await prisma.customer_refund_allocations.aggregate({
      where: {
        refund: { customer_id: customer.id }
      },
      _sum: { allocated_amount: true }
    });

    const totalPaid = Number(payments._sum.payment_amount || 0);
    const totalAllocated = Number(paymentAllocs._sum.allocated_amount || 0);
    const totalRefunded = Number(refunds._sum.refund_amount || 0);
    const totalRefundAllocated = Number(refundAllocs._sum.allocated_amount || 0);

    const balance = totalPaid - totalAllocated - totalRefunded + totalRefundAllocated;

    // Update customer
    await prisma.customer_details.update({
      where: { id: customer.id },
      data: {
        total_paid: totalPaid,
        total_allocated: totalAllocated,
        total_refunded: totalRefunded,
        total_refund_allocated: totalRefundAllocated,
        account_balance: balance
      }
    });

    console.log(`Initialized balance for customer ${customer.id}: ₹${balance}`);
  }

  console.log(`✅ Initialized balances for ${customers.length} customers`);
}
