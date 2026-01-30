# Vendor Transaction Ledger Entry Fix

## Issue
When creating vendor transactions (payments/refunds) through the vendor transaction screen, certain types of transactions were not creating ledger entries, causing discrepancies in the vendor ledger.

### Missing Ledger Entries

1. **EXPENSE - DIRECT Payments**: Direct advance payments to vendor with no bill allocation
2. **EXPENSE - MIXED Payments**: Unallocated portion of mixed payments (part allocated to bills, part advance)
3. **INCOME - DIRECT Refunds**: Random refunds received from vendor

## Root Cause

The payment/refund creation logic only created ledger entries **inside the allocations loop**, meaning:
- If `allocations` array was empty (DIRECT) → No ledger entry
- If payment amount > total allocated (MIXED) → Only allocated amounts got entries, unallocated portion missing

## Business Logic

### Vendor Transactions - EXPENSE (Payments)

| Type | Description | Ledger Behavior |
|------|-------------|-----------------|
| **BILL_SPECIFIC** | Pay specific bills only | ✅ Creates PAYMENT entry per allocation |
| **MIXED** | Pay bills + advance | ✅ Creates PAYMENT entries for allocations<br>✅ **NOW**: Creates PAYMENT entry for unallocated amount |
| **DIRECT** | Advance payment to vendor | ✅ **NOW**: Creates standalone PAYMENT entry |

### Vendor Transactions - INCOME (Refunds)

| Type | Description | Ledger Behavior |
|------|-------------|-----------------|
| **DIRECT** | Random refund from vendor | ✅ **NOW**: Creates standalone REFUND_RECEIVED entry |
| **MIXED** | Refund for returns + extra | ✅ Creates REFUND_RECEIVED for allocations<br>✅ **NOW**: Creates REFUND_RECEIVED for unallocated |

**Note**: INCOME is always DIRECT in the UI (no allocation system for vendor refunds without returns)

## Solution Implemented

### Files Modified

1. **`pages/api/vendor-payments/index.ts`** - POST handler
2. **`pages/api/vendor-refunds/index.ts`** - POST handler

### Changes Made

#### 1. vendor-payments/index.ts

```typescript
// After allocations loop, before balance update

if (payment_type === 'DIRECT') {
  // Create standalone PAYMENT ledger entry
  await ledgerService.createEntry({
    vendor_id: vendorId,
    transaction_type: 'PAYMENT',
    reference_type: 'payment',        // Links to payment record
    reference_id: payment.id,
    debit: 0,
    credit: payment_amount,           // Decreases balance
    notes: `Direct advance payment ₹${payment_amount}`,
    ...
  }, tx);
} else if (payment_type === 'MIXED') {
  const unallocatedAmount = payment_amount - totalAllocated;
  
  if (unallocatedAmount > 0) {
    // Create PAYMENT ledger entry for unallocated advance
    await ledgerService.createEntry({
      vendor_id: vendorId,
      transaction_type: 'PAYMENT',
      reference_type: 'payment',
      reference_id: payment.id,
      debit: 0,
      credit: unallocatedAmount,      // Decreases balance
      notes: `Advance payment ₹${unallocatedAmount} (unallocated from Payment #${payment.id})`,
      ...
    }, tx);
  }
}
```

#### 2. vendor-refunds/index.ts

```typescript
// After allocations loop, before balance update

if (refund_type === 'DIRECT') {
  // Create standalone REFUND_RECEIVED ledger entry
  await ledgerService.createEntry({
    vendor_id: vendorId,
    transaction_type: 'REFUND_RECEIVED',
    reference_type: undefined,        // Standalone entry
    reference_id: undefined,
    debit: refund_amount,             // Increases balance (vendor owes us less)
    credit: 0,
    notes: `Direct refund received ₹${refund_amount}`,
    ...
  }, tx);
} else if (refund_type === 'MIXED') {
  const unallocatedAmount = refund_amount - totalAllocated;
  
  if (unallocatedAmount > 0) {
    // Create REFUND_RECEIVED entry for unallocated
    await ledgerService.createEntry({
      vendor_id: vendorId,
      transaction_type: 'REFUND_RECEIVED',
      reference_type: undefined,
      reference_id: undefined,
      debit: unallocatedAmount,
      credit: 0,
      notes: `Unallocated refund received ₹${unallocatedAmount} (from Refund #${refund.id})`,
      ...
    }, tx);
  }
}
```

## Ledger Display Behavior

### Merge Logic (`lib/ledger-merge-utils.ts`)

- **PAYMENT** entries with `reference_type: 'payment'` → Shown as standalone entries (NOT merged)
- **REFUND_RECEIVED** with `reference_type: undefined` → Shown as standalone entries
- Entries WITH reference_id get merged with their base transactions (PURCHASE, DEBIT_NOTE, etc.)

### Example Ledger After Fix

```
Date       | Particulars      | Voucher Type | Debit  | Credit | Balance
-----------|------------------|--------------|--------|--------|--------
30/1/2026  | Purchase         | Purchase     | 2,500  | 0      | 2,500
30/1/2026  | Bank             | Payment      | 0      | 2,500  | 0      (allocated to bill)
30/1/2026  | Bank             | Payment      | 0      | 2,500  | -2,500 (unallocated advance) ✅ NEW
30/1/2026  | Cash             | Refund       | 1,000  | 0      | -1,500 (direct refund) ✅ NEW
```

## Testing Scenarios

### Test 1: DIRECT Payment
1. Go to `/entry/vendor-transaction`
2. Select EXPENSE, choose vendor
3. Select DIRECT payment type
4. Enter amount: ₹5,000
5. Submit
6. **Verify**: Ledger shows standalone PAYMENT entry with credit ₹5,000

### Test 2: MIXED Payment
1. Select EXPENSE, choose vendor with outstanding bills
2. Select MIXED payment type
3. Total amount: ₹10,000
4. Allocate ₹6,000 to bills
5. Submit
6. **Verify**: Ledger shows:
   - PAYMENT entries for ₹6,000 (allocated, merged with bills)
   - Standalone PAYMENT entry for ₹4,000 (unallocated advance)

### Test 3: DIRECT Refund
1. Select INCOME, choose vendor
2. (Automatically DIRECT type)
3. Enter amount: ₹3,000
4. Submit
5. **Verify**: Ledger shows standalone REFUND_RECEIVED entry with debit ₹3,000

## Impact on Balance

- ✅ **vendor_details.balance** was already being updated correctly
- ✅ **vendor_ledger.balance** now correctly reflects all transactions
- ✅ Running balance calculation now matches actual vendor balance

## Edit/Delete Operations

**PUT handlers** - Already working correctly, uses `transaction-handler.ts`

**DELETE handlers** - Fixed to properly reverse ALL ledger entries:
- **Issue**: DELETE was only reversing entries with matching `reference_type`
- **Problem**: Allocated payments have `reference_type: 'purchase'`, DIRECT have `reference_type: 'payment'`
- **Solution**: 
  1. Store allocated purchase/return IDs before deleting allocations
  2. Query both DIRECT entries AND allocated entries
  3. Filter allocated entries by notes containing payment/refund ID to ensure specificity
  4. Reverse all entries found

**Changes Made in `lib/transaction-handler.ts`:**

```typescript
// Store allocation IDs before deletion
private async executeDeleteAllocations(tx: any, data: any): Promise<void> {
  if (data.entityType === 'payment') {
    const allocations = await tx.payment_allocations.findMany({
      where: { payment_id: data.entityId },
      select: { purchase_id: true }
    });
    data.allocatedPurchaseIds = allocations.map(a => a.purchase_id); // ✅ Store for later
    // ... delete allocations
  }
}

// Find and reverse both direct AND allocated entries
private async executeLedgerReversal(tx: any, data: any): Promise<void> {
  if (data.entityType === 'payment') {
    // Get DIRECT entries (reference_type: 'payment')
    const directEntries = await tx.vendor_ledger.findMany({
      where: { reference_type: 'payment', reference_id: data.entityId }
    });
    
    // Get allocated entries (reference_type: 'purchase')
    const allocatedEntries = data.allocatedPurchaseIds?.length > 0 ? 
      await tx.vendor_ledger.findMany({
        where: {
          transaction_type: 'PAYMENT',
          reference_type: 'purchase',
          reference_id: { in: data.allocatedPurchaseIds },
          notes: { contains: `Payment #${data.entityId}` } // ✅ Ensure it's THIS payment
        }
      }) : [];
    
    ledgerEntries = [...directEntries, ...allocatedEntries]; // ✅ Reverse both!
  }
}
```

## Related Files

### No Changes Required
- ✅ `lib/ledger-service.ts` - Generic ledger entry creation
- ✅ `lib/payment-allocation-service.ts` - Allocation validation only
- ✅ `lib/balance-handler.ts` - Balance calculations
- ✅ `lib/transaction-handler.ts` - Edit/delete reversals
- ✅ `lib/ledger-merge-utils.ts` - Client-side merging logic

## Date Fixed
January 30, 2026

## Related Issues
- Vendor ledger not showing advance payments
- Running balance mismatch for vendors with mixed transactions
- Direct refunds not appearing in ledger

## References
- `docs/INTEGRATED_PAYMENT_SYSTEM_ANALYSIS.md`
- `docs/VENDOR_TRANSACTIONS_IMPLEMENTATION.md`
- `docs/PAYMENT_ALLOCATION_SYSTEM.md`
