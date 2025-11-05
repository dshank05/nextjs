# Purchase & Product API Update Analysis

## Overview
This document analyzes the current implementation of product and purchase APIs to identify issues with the last purchase rate, date, and stock update logic.

## Database Schema (Product Table)
```sql
model Product {
  id                     Int      @id @default(autoincrement())
  -- ... other fields ...
  last_purchase_date     Int?     -- Unix timestamp (seconds)
  latest_purchase_rate   Float?   -- Latest purchase price
  stock                  Int?     -- Current stock quantity
  -- ... other fields ...
}
```

## Expected Behavior
When a product is purchased:
1. `latest_purchase_rate` should be updated with the purchase rate
2. `last_purchase_date` should be updated with the purchase date (Unix timestamp)
3. `stock` should be increased by the purchased quantity

---

## 1. PRODUCT API - POST (Create Product)

### File: `pages/api/products/index.ts`

### Current Implementation
```javascript
// POST handler creates new products
const finalProductData = {
  product_name: productData.product_name,
  // ... other fields ...
  stock: productData.stock ? parseInt(productData.stock) : 0,
  opening_stock: productData.opening_stock ? parseInt(productData.opening_stock) : 0,
  opening_rate: productData.opening_rate ? parseFloat(productData.opening_rate) : 0,
  // ... other fields ...
  // NOTE: last_purchase_date and latest_purchase_rate are NOT set during creation
};
```

### Issues Identified
- ✅ **Correctly implemented**: Does NOT set `last_purchase_date` and `latest_purchase_rate` during product creation
- ✅ **Correctly implemented**: Only sets opening stock and opening rate
- ✅ **Correct behavior**: Purchase tracking should only happen during actual purchases

### Status: ✅ WORKING CORRECTLY
Product creation should not update purchase tracking fields. These are only updated when actual purchases occur.

---

## 2. PRODUCT API - PUT (Update Product)

### File: `pages/api/products/[id].ts`

### Current Implementation
```javascript
// PUT handler updates existing products
const finalData = {
  product_name: productData.product_name,
  // ... other fields ...
  stock: productData.stock ? parseInt(productData.stock) : 0,
  opening_stock: productData.opening_stock ? parseInt(productData.opening_stock) : 0,
  opening_rate: productData.opening_rate ? parseFloat(productData.opening_rate) : 0,
  // ... other fields ...
  // NOTE: last_purchase_date and latest_purchase_rate are NOT updated
};
```

### Issues Identified
- ✅ **Correctly implemented**: Does NOT update `last_purchase_date` and `latest_purchase_rate`
- ✅ **Correct behavior**: Product updates should not affect purchase tracking
- ✅ **Stock management**: Updates stock quantity (manual adjustment)

### Status: ✅ WORKING CORRECTLY
Product updates should not interfere with purchase tracking. Stock can be manually adjusted, but purchase history should remain separate.

---

## 3. PURCHASE API - POST (Create Purchase)

### File: `pages/api/purchases/index.ts`

### Current Implementation
```javascript
// After creating purchase record, updates product stock and rates
for (const item of items) {
  // ... create purchaseitems record ...

  // Update product stock and purchase tracking
  await prisma.product.update({
    where: { id: parseInt(item.product_id) },
    data: {
      stock: { increment: validatedQty },
      latest_purchase_rate: item.rate,
      last_purchase_date: invoiceDate
    }
  });
}
```

### Issues Identified
1. ❌ **MAJOR ISSUE**: Product updates happen OUTSIDE the main transaction
2. ❌ **ERROR HANDLING**: No validation that product exists before update
3. ❌ **LOGGING**: No logging to track if updates succeed/fail
4. ❌ **ATOMICITY**: If purchase creation fails, products are still updated (inconsistent state)
5. ✅ **LOGIC**: The update logic itself is correct (stock increment + rate/date update)

### Required Fixes
1. **Move product updates inside database transaction**
2. **Add product existence validation**
3. **Add error handling and logging**
4. **Ensure atomic operations**

---

## 4. PURCHASE API - PUT (Update Purchase)

### File: `pages/api/purchases/index.ts`

### Current Implementation
```javascript
// Uses database transaction for updates
const result = await prisma.$transaction(async (tx) => {
  // Update purchase record
  const purchase = await tx.purchase.update({ ... });

  // Handle item updates
  for (const [productId, newData] of Array.from(newItemsMap.entries())) {
    if (!existingData) {
      // New item - create and update product
      await tx.product.update({
        where: { id: productId },
        data: {
          stock: { increment: validatedNewQty },
          latest_purchase_rate: newData.rate,
          last_purchase_date: invoiceDate
        }
      });
    } else {
      // Existing item - adjust stock
      await tx.product.update({
        where: { id: productId },
        data: {
          stock: { increment: qtyDifference }
        }
      });
    }
  }
});
```

### Issues Identified
1. ✅ **TRANSACTION**: Uses proper database transaction
2. ✅ **ATOMICITY**: All operations are atomic
3. ❌ **VALIDATION**: No validation that product exists before update
4. ❌ **LOGGING**: No logging for debugging
5. ❌ **ERROR HANDLING**: Limited error handling within transaction
6. ✅ **LOGIC**: Update logic is mostly correct

### Required Fixes
1. **Add product existence validation**
2. **Add logging for debugging**
3. **Improve error handling within transaction**

---

## Summary of Issues & Fixes Needed

### Critical Issues (Breaking Functionality)
1. **Purchase POST**: Product updates happen outside transaction - can cause inconsistent state
2. **Missing validation**: No checks if products exist before updating
3. **Silent failures**: No error handling means failures go unnoticed

### Minor Issues (Debugging/Maintenance)
1. **No logging**: Hard to debug when updates fail
2. **Limited error handling**: Errors within transactions not well handled

### Implementation Plan

#### Phase 1: Fix Purchase POST (Critical)
```javascript
// Move product updates inside transaction
const purchase = await prisma.$transaction(async (tx) => {
  // Create purchase record
  const purchase = await tx.purchase.create({ ... });

  // Create purchase items and update products (all in same transaction)
  for (const item of items) {
    // Create purchaseitems record
    await tx.purchaseitems.create({ ... });

    // Validate product exists
    const product = await tx.product.findUnique({
      where: { id: parseInt(item.product_id) }
    });
    if (!product) throw new Error(`Product ${item.product_id} not found`);

    // Update product (atomic with purchase creation)
    await tx.product.update({
      where: { id: parseInt(item.product_id) },
      data: {
        stock: { increment: validatedQty },
        latest_purchase_rate: item.rate,
        last_purchase_date: invoiceDate
      }
    });
  }

  return purchase;
});
```

#### Phase 2: Enhance Purchase PUT
- Add product validation
- Add logging
- Improve error messages

#### Phase 3: Add Logging & Monitoring
- Log successful product updates
- Track update failures
- Add debugging information

### Testing Requirements
1. **Create purchase** → Verify product stock/rate/date updated
2. **Update purchase** → Verify product adjustments work
3. **Error scenarios** → Invalid product IDs, transaction failures
4. **Concurrent purchases** → Race condition handling

---

## Files to Modify
1. `pages/api/purchases/index.ts` - POST and PUT methods
2. Add comprehensive logging and error handling
3. Ensure all product updates happen within transactions

## Expected Outcome
After fixes, every product purchase will reliably update:
- `stock` (increased by purchase quantity)
- `latest_purchase_rate` (set to purchase rate)
- `last_purchase_date` (set to purchase date)

All operations will be atomic and properly validated.
