# Type Conversion Fix - Vendor Payments & Refunds

## Issue
Prisma was throwing a type validation error when creating vendor payments:
```
Invalid `prisma.vendor_payments.create()` invocation:
Argument `vendor_id`: Invalid value provided. Expected Int, provided String.
```

## Root Cause
When data comes from `req.body` in Next.js API routes, all values are received as **strings** by default. The `vendor_id` field was being passed directly to Prisma without type conversion, but Prisma's schema expects an `Int`.

## Files Fixed

### 1. `pages/api/vendor-payments/index.ts`
**Comprehensive Fix** - Convert `vendor_id` to integer at the start and use consistently:

```typescript
// BEFORE
const {
  vendor_id,
  payment_amount,
  // ...
} = req.body;

// Validate required fields
if (!vendor_id || !payment_amount || ...) {
  return res.status(400).json({ error: 'Missing required fields' });
}

// Used string vendor_id everywhere:
validatePaymentAllocation(vendor_id, ...);  // ❌ String
ledgerService.createEntry({ vendor_id, ... }, tx);  // ❌ String
balanceHandler.incrementBalanceInTransaction(tx, vendor_id, ...);  // ❌ String

// AFTER
const {
  vendor_id,
  payment_amount,
  // ...
} = req.body;

// Validate required fields
if (!vendor_id || !payment_amount || ...) {
  return res.status(400).json({ error: 'Missing required fields' });
}

// Convert to integer immediately after validation
const vendorId = parseInt(vendor_id);  // ✅ Convert once at the start

// Use integer vendorId everywhere:
validatePaymentAllocation(vendorId, ...);  // ✅ Int
ledgerService.createEntry({ vendor_id: vendorId, ... }, tx);  // ✅ Int
balanceHandler.incrementBalanceInTransaction(tx, vendorId, ...);  // ✅ Int
tx.vendor_payments.create({ data: { vendor_id: parseInt(vendor_id), ... } });
```

**Why this approach?**
- The string `vendor_id` was being passed to `ledgerService.createEntry()`, which then queried `vendor_ledger` with a string value, causing the error
- Converting once at the start ensures type safety throughout the entire function chain

### 2. `pages/api/vendor-refunds/index.ts`
**Same comprehensive fix applied:**

```typescript
// Convert to integer immediately after validation
const vendorId = parseInt(vendor_id);

// Use consistently throughout:
validateRefundAllocation(vendorId, ...);
ledgerService.createEntry({ vendor_id: vendorId, ... }, tx);
balanceHandler.incrementBalanceInTransaction(tx, vendorId, ...);
```

## Customer APIs Status
The customer payment and refund APIs were already correctly implemented with `parseInt()`:

- ✅ `pages/api/customer-payments/index.ts` - Already has `customer_id: parseInt(customer_id)`
- ✅ `pages/api/customer-refunds/index.ts` - Already has `customer_id: parseInt(customer_id)`
- ✅ `pages/api/customer-adjustments/index.ts` - Uses `parseInt()` throughout for IDs

## Prisma Schema Reference
From `prisma/schema.prisma`:

```prisma
model vendor_payments {
  id             Int       @id @default(autoincrement())
  vendor_id      Int       // ← Expects Int, not String
  payment_date   Int
  payment_amount Decimal   @db.Decimal(10, 2)
  payment_mode   Int
  payment_type   String    @db.VarChar(20)
  notes          String?   @db.Text
  fy             Int
  // ...
}

model vendor_refunds {
  id            Int       @id @default(autoincrement())
  vendor_id     Int       // ← Expects Int, not String
  refund_date   Int
  refund_amount Decimal   @db.Decimal(10, 2)
  refund_mode   Int
  refund_type   String    @db.VarChar(20)
  notes         String?   @db.Text
  fy            Int
  // ...
}
```

## Testing
After this fix:
1. Vendor payments can be created successfully via POST `/api/vendor-payments`
2. Vendor refunds can be created successfully via POST `/api/vendor-refunds`
3. No more type validation errors from Prisma

## Best Practice
**Always convert string IDs to integers when passing to Prisma:**
```typescript
// ✅ Good
vendor_id: parseInt(vendor_id)
customer_id: parseInt(customer_id)
purchase_id: parseInt(purchase_id)

// ❌ Bad
vendor_id,  // String from req.body
customer_id,  // String from req.body
```

## Date Fixed
January 30, 2026

## Related Issues
This same pattern should be checked in all API POST/PUT handlers that accept IDs from `req.body`.
