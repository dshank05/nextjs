# Payment and Refund Flow Comparison: Vendor vs Customer

## Summary
Both vendor and customer transaction flows follow similar patterns with key differences in terminology and ledger entry types.

---

## VENDOR PAYMENT FLOW (Purchase Side)

### API: `pages/api/vendor-payments/index.ts` (POST)

**When Payment is Created:**
1. ✅ **Always creates PAYMENT ledger entry** (regardless of payment type)
2. ✅ **Always updates vendor balance** (`total_paid`, `total_allocated`)
3. ✅ **Creates payment_allocations** records
4. ✅ **Updates purchase payment_status** (0=Unpaid, 1=Paid, 2=Partial)

**Ledger Entry Types by Payment Type:**
- **DIRECT**: Single `PAYMENT` entry with full amount
- **MIXED**: Single `PAYMENT` entry with full amount (notes show allocation breakdown)
- **BILL_SPECIFIC**: Multiple `PAYMENT` entries (one per allocated purchase)

**Key Points:**
- Payment ledger entry is ALWAYS created immediately
- Balance is ALWAYS updated immediately
- Uses `ledgerService.createEntry()` with `transaction_type: 'PAYMENT'`
- Uses `balanceHandler.incrementBalanceInTransaction()`

---

## CUSTOMER PAYMENT FLOW (Sale Side)

### API: `pages/api/customer-payments/index.ts` (POST)

**When Payment is Created:**
1. ✅ **Always creates PAYMENT_RECEIVED ledger entry** (via `recordReceiptTransaction`)
2. ✅ **Creates customer_payment_allocations** records
3. ✅ **Updates invoice/invoicex payment_status** (0=Unpaid, 1=Paid, 2=Partial)
4. ❌ **Does NOT update customer balance fields** (no balance tracking like vendor)

**Ledger Entry:**
- Uses `recordReceiptTransaction()` from `customer-ledger-service.ts`
- Creates single ledger entry with `transaction_type: 'PAYMENT_RECEIVED'`
- Entry is created OUTSIDE transaction (with try-catch, doesn't fail payment if ledger fails)

**Key Differences from Vendor:**
- No balance field updates (customer_details doesn't have total_paid/total_allocated fields)
- Simpler flow - just ledger entry + allocations
- Ledger entry created outside transaction (vendor does it inside)

---

## VENDOR REFUND FLOW (Purchase Return Side)

### API: `pages/api/purchase-returns/vendor-return.ts` (POST)

**When Return is Created:**
1. ✅ **Always creates DEBIT_NOTE ledger entry** (reduces what you owe vendor)
2. ✅ **Only when `payment_status === 1` (Complete):**
   - Updates vendor balance fields (`total_refunded`, `total_refund_allocated`)
   - Creates balance log entry

**Pattern:**
```typescript
// ALWAYS create DEBIT_NOTE (outside payment_status check)
await ledgerService.createDebitNoteEntry({...}, tx)

// ONLY when payment_status === 1
if (paymentStatusValue === 1) {
  await balanceHandler.incrementBalanceInTransaction(tx, vendorId, {
    total_refunded: refundAmount,
    total_refund_allocated: refundAmount
  }, {...})
}
```

**Key Points:**
- DEBIT_NOTE is created immediately (adjusts ledger balance automatically)
- Balance fields only updated when refund is actually received (payment_status === 1)
- No separate REFUND_RECEIVED entry (commented out in code)

---

## CUSTOMER REFUND FLOW (Sale Return Side)

### API: `pages/api/sale-returns/index.ts` (POST)
### API: `pages/api/sale-returns/customer-return.ts` (POST) - NEW

**When Return is Created:**
1. ✅ **Always creates CREDIT_NOTE ledger entry** (reduces what customer owes you)
2. ✅ **Only when `payment_status === 1` (Paid/Refunded):**
   - Creates REFUND_PAID ledger entry

**Pattern:**
```typescript
// ALWAYS create CREDIT_NOTE (via recordReturnTransaction)
await recordReturnTransaction(
  customerId,
  returnId,
  returnNo,
  refundAmount,
  returnDate,
  fy,
  notes
)

// ONLY when payment_status === 1
if (paymentStatus === 1) {
  await recordRefundPaidTransaction(
    customerId,
    refundId,
    refundNo,
    refundAmount,
    returnDate,
    paymentMode,
    fy,
    notes
  )
}
```

**Key Points:**
- CREDIT_NOTE is created immediately (adjusts ledger balance automatically)
- REFUND_PAID only created when refund is actually paid (payment_status === 1)
- No balance field updates (customer_details doesn't have balance tracking fields)
- Mirrors vendor return pattern exactly

---

## KEY DIFFERENCES SUMMARY

| Aspect | Vendor (Purchase) | Customer (Sale) |
|--------|------------------|-----------------|
| **Payment Ledger Entry** | PAYMENT (always) | PAYMENT_RECEIVED (always) |
| **Payment Balance Update** | Yes (total_paid, total_allocated) | No (no balance fields) |
| **Return Ledger Entry** | DEBIT_NOTE (always) | CREDIT_NOTE (always) |
| **Refund Ledger Entry** | None (commented out) | REFUND_PAID (when paid) |
| **Refund Balance Update** | Yes (when payment_status=1) | No (no balance fields) |
| **Balance Tracking** | vendor_details has balance fields | customer_details has NO balance fields |

---

## CONSISTENCY CHECK ✅

Both flows are now consistent:

1. **Payments**: Always create ledger entry immediately
2. **Returns**: Always create NOTE entry (DEBIT/CREDIT) immediately
3. **Refunds**: Only track when actually paid/received (payment_status === 1)
4. **Balance Updates**: Only vendor side has balance fields (by design)

The customer side correctly mirrors the vendor side pattern, with the main difference being that customer_details doesn't have balance tracking fields (total_paid, total_allocated, etc.) like vendor_details does.

---

## LEDGER ENTRY TYPES

### Vendor Ledger (`vendor_ledger` table):
- `PURCHASE` - When purchase is created
- `DEBIT_NOTE` - When return is created (reduces balance)
- `PAYMENT` - When payment is made
- `REFUND_RECEIVED` - (Not used anymore, commented out)

### Customer Ledger (`customer_ledger` table):
- `SALE` - When sale/salex is created
- `CREDIT_NOTE` - When return is created (reduces balance)
- `PAYMENT_RECEIVED` - When payment is received
- `REFUND_PAID` - When refund is actually paid out

---

## CONCLUSION

The flows are consistent and follow the same logical pattern:
- Transactions (purchase/sale) create ledger entries
- Payments always create ledger entries and update status
- Returns always create NOTE entries (DEBIT/CREDIT) for automatic adjustment
- Refunds are only tracked when actually paid/received
- Balance field updates only happen on vendor side (customer side doesn't have these fields)

✅ **No changes needed** - both flows are correctly implemented and consistent with each other.
