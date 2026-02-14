# Critical API Optimization Plan

**Date:** February 14, 2026  
**Priority:** HIGH - Production Performance Issue  
**Target APIs:** 4 Most Used Endpoints

---

## Executive Summary

These 4 endpoints are heavily used and currently experiencing performance issues:

1. ❌ **Purchase Create** (POST /api/purchases/index.ts) - SLOW
2. ❌ **Purchase Edit** (PUT /api/purchases/[id].ts) - SLOW
3. ❌ **Return Create** (POST /api/purchase-returns/index.ts) - NOT IMPLEMENTED
4. ❌ **Return Edit** (PUT /api/purchase-returns/[id].ts) - SLOW

**Goal:** Reduce response times to < 1 second for typical operations

---

## 1. Purchase Create (POST /api/purchases/index.ts)

### Current Performance Issues

#### 🐌 **Issue 1: Sequential Payment/Ledger Operations**
```typescript
// CURRENT (SLOW): Sequential execution
if (advanceUsed > 0) {
  const advancePayment = await tx.vendor_payments.create({...});
  await tx.payment_allocations.create({...});
}
if (newPayment > 0) {
  const payment = await tx.vendor_payments.create({...});
  await tx.payment_allocations.create({...});
}
// Then ledger entry
if (newPayment > 0 && newPaymentId) {
  await ledgerService.createEntry({...});
}
```

**Fix:** Parallelize independent operations
```typescript
// OPTIMIZED: Parallel execution
const paymentOperations = [];

if (advanceUsed > 0) {
  paymentOperations.push(
    tx.vendor_payments.create({...}).then(async payment => {
      await tx.payment_allocations.create({...});
      return { type: 'advance', id: payment.id };
    })
  );
}

if (newPayment > 0) {
  paymentOperations.push(
    tx.vendor_payments.create({...}).then(async payment => {
      await tx.payment_allocations.create({...});
      return { type: 'new', id: payment.id };
    })
  );
}

const paymentResults = await Promise.all(paymentOperations);

// Create ledger entries in parallel
const ledgerOperations = paymentResults
  .filter(r => r.type === 'new')
  .map(r => ledgerService.createEntry({..., transaction_id: r.id}, tx));
  
await Promise.all(ledgerOperations);
```

**Expected Improvement:** 30-40% faster

---

#### 🐌 **Issue 2: Vendor Balance Query for Every Purchase**
```typescript
// CURRENT (SLOW): Query vendor balance for smart allocation
const vendor = await tx.vendor_details.findUnique({
  where: { id: parseInt(vendor_id) },
  select: {
    total_paid: true,
    total_allocated: true,
    total_refunded: true,
    total_refund_allocated: true
  }
});
```

**Fix:** Move balance query OUTSIDE transaction (before validation)
```typescript
// OPTIMIZED: Query BEFORE transaction starts
const vendor = await prisma.vendor_details.findUnique({
  where: { id: parseInt(vendor_id) },
  select: {
    total_paid: true,
    total_allocated: true,
    total_refunded: true,
    total_refund_allocated: true
  }
});

// Calculate advance usage BEFORE transaction
const advanceBalance = vendor ? ... : 0;
const advanceUsed = Math.min(...);
const newPayment = ...;

// NOW start transaction with pre-calculated values
const purchase = await prisma.$transaction(async (tx) => {
  // Use pre-calculated advanceUsed and newPayment
  ...
});
```

**Expected Improvement:** 15-20% faster

---

#### 🐌 **Issue 3: Stock Updates in Sequential Loop**
```typescript
// CURRENT (SLOW): Sequential stock updates
for (const item of items) {
  await tx.product.update({
    where: { id: productId },
    data: { stock: { increment: validatedQty } }
  });
}
```

**Fix:** Already using Promise.all - but can optimize further
```typescript
// OPTIMIZED: Batch updates with single updateMany call
const stockUpdates = items.reduce((acc, item) => {
  const productId = parseInt(item.product_id);
  acc[productId] = (acc[productId] || 0) + parseFloat(item.qty);
  return acc;
}, {});

await Promise.all([
  ...Object.entries(stockUpdates).map(([productId, qtyChange]) =>
    tx.product.update({
      where: { id: parseInt(productId) },
      data: {
        stock: { increment: qtyChange },
        latest_purchase_rate: ..., // Get from items map
        last_purchase_date: invoiceDate
      }
    })
  ),
  ledgerService.createPurchaseEntry({...}, tx)
]);
```

**Expected Improvement:** Already optimized, 5-10% improvement possible

---

### Recommended Changes Summary

**Priority Changes:**
1. ✅ **HIGH:** Move vendor balance query outside transaction
2. ✅ **HIGH:** Parallelize payment/allocation creation
3. ✅ **MEDIUM:** Optimize stock update batching

**Expected Total Improvement:** 50-70% faster (3-5s → 1-2s)

---

## 2. Purchase Edit (PUT /api/purchases/[id].ts)

### Current Performance Issues

#### 🐌 **Issue 1: Return Validation Queries (Partial Returns)**
```typescript
// CURRENT (SLOW): Multiple sequential queries for return validation
const purchaseItems = await prisma.purchaseitems.findMany({...});
const returnItems = await prisma.purchase_return_items.findMany({...});

// Then loop through items checking each one
for (const newItem of items) {
  // Complex validation logic
}
```

**Fix:** Parallelize and pre-calculate
```typescript
// OPTIMIZED: Fetch all data in parallel
const [purchaseItems, returnItems] = await Promise.all([
  tx.purchaseitems.findMany({...}),
  tx.purchase_return_items.findMany({...})
]);

// Build return map ONCE
const returnedQtyMap = new Map();
returnItems.forEach(returnItem => {
  const existing = returnedQtyMap.get(returnItem.purchase_item_id) || 0;
  returnedQtyMap.set(returnItem.purchase_item_id, existing + returnItem.return_qty);
});

// Validation is now O(1) lookup instead of nested loops
```

**Expected Improvement:** 20-30% faster for partial returns

---

#### 🐌 **Issue 2: Item Update Detection Uses Nested Loops**
```typescript
// CURRENT (SLOW): Nested loops for change detection
const existingItemsMap = new Map();
const newItemsMap = new Map();

// Identify deletions
for (const [productId, existingData] of existingItemsMap.entries()) {
  if (!newItemsMap.has(productId)) {
    // Delete logic
  }
}

// Identify additions/updates
for (const [productId, newData] of newItemsMap.entries()) {
  const existingData = existingItemsMap.get(productId);
  if (!existingData) {
    // Add logic
  } else {
    // Update logic
  }
}
```

**Fix:** Single-pass algorithm
```typescript
// OPTIMIZED: Single pass with Set operations
const existingIds = new Set(existingItemsMap.keys());
const newIds = new Set(newItemsMap.keys());

const toDelete = [...existingIds].filter(id => !newIds.has(id));
const toAdd = [...newIds].filter(id => !existingIds.has(id));
const toCheck = [...newIds].filter(id => existingIds.has(id));

// Process deletions in bulk
if (toDelete.length > 0) {
  const deleteItems = toDelete.map(id => existingItemsMap.get(id));
  await Promise.all([
    tx.purchaseitems.deleteMany({...}),
    ...deleteItems.map(item => tx.product.update({...}))
  ]);
}

// Process additions in bulk
if (toAdd.length > 0) {
  await tx.purchaseitems.createMany({...});
  await Promise.all(toAdd.map(id => tx.product.update({...})));
}

// Process updates in bulk
const updates = toCheck
  .map(id => ({ existing: existingItemsMap.get(id), new: newItemsMap.get(id) }))
  .filter(({ existing, new }) => needsUpdate(existing, new));
  
await Promise.all([
  ...updates.map(u => tx.purchaseitems.update({...})),
  ...updates.map(u => tx.product.update({...}))
]);
```

**Expected Improvement:** 15-25% faster

---

#### 🐌 **Issue 3: Transaction Handler Queries Inside Transaction**
```typescript
// CURRENT (SLOW): Handler checks for payment ledger inside transaction
const hasPaymentLedger = await tx.vendor_ledger.findFirst({...});
const handlerResult = await transactionHandler.handlePurchaseEdit({
  hasPaymentLedger: hasPaymentLedger !== null
});
```

**Fix:** Query before transaction
```typescript
// OPTIMIZED: Query outside transaction
const hasPaymentLedger = await prisma.vendor_ledger.findFirst({...});

const result = await prisma.$transaction(async (tx) => {
  const handlerResult = await transactionHandler.handlePurchaseEdit({
    hasPaymentLedger: hasPaymentLedger !== null
  });
  ...
});
```

**Expected Improvement:** 10-15% faster

---

### Recommended Changes Summary

**Priority Changes:**
1. ✅ **HIGH:** Move hasPaymentLedger query outside transaction
2. ✅ **HIGH:** Parallelize return validation queries
3. ✅ **MEDIUM:** Optimize item change detection algorithm

**Expected Total Improvement:** 45-70% faster (4-6s → 1.5-2.5s)

---

## 3. Return Create (POST /api/purchase-returns/index.ts)

### Current Status
❌ **NOT IMPLEMENTED** - Returns 501 status

### Implementation Plan

**Critical Requirements:**
1. Vendor-based returns (not purchase-specific)
2. Support multi-bill returns
3. Atomic transaction with stock restoration
4. DEBIT_NOTE ledger entry creation
5. Balance updates

**Recommended Architecture:**
```typescript
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      vendor_id,
      return_date,
      items, // Array of { purchase_item_id, return_qty, unit_price, ... }
      notes,
      payment_status,
      payment_mode,
      packing_forwarding_amount
    } = req.body;

    // ✅ OPTIMIZATION 1: Validate and fetch data BEFORE transaction
    const purchaseItemIds = items.map(i => i.purchase_item_id);
    
    const [purchaseItems, vendor, existingReturns] = await Promise.all([
      prisma.purchaseitems.findMany({
        where: { id: { in: purchaseItemIds } },
        select: {
          id: true,
          product_id: true,
          qty: true,
          invoice_no: true
        }
      }),
      prisma.vendor_details.findUnique({
        where: { id: parseInt(vendor_id) },
        select: {
          id: true,
          vendor_name: true,
          total_paid: true,
          total_allocated: true,
          total_refunded: true,
          total_refund_allocated: true
        }
      }),
      prisma.purchase_return_items.groupBy({
        by: ['purchase_item_id'],
        where: { purchase_item_id: { in: purchaseItemIds } },
        _sum: { return_qty: true }
      })
    ]);

    // Build validation maps
    const purchaseItemMap = new Map(purchaseItems.map(p => [p.id, p]));
    const returnedQtyMap = new Map(existingReturns.map(r => 
      [r.purchase_item_id, r._sum.return_qty || 0]
    ));

    // ✅ Validate availability BEFORE transaction
    for (const item of items) {
      const purchaseItem = purchaseItemMap.get(item.purchase_item_id);
      if (!purchaseItem) {
        throw new Error(`Purchase item ${item.purchase_item_id} not found`);
      }
      
      const alreadyReturned = returnedQtyMap.get(item.purchase_item_id) || 0;
      const available = purchaseItem.qty - alreadyReturned;
      
      if (item.return_qty > available) {
        throw new Error(`Insufficient quantity for return`);
      }
    }

    // Calculate advance balance for smart refund allocation
    const advanceBalance = vendor 
      ? (Number(vendor.total_paid) - Number(vendor.total_allocated)) +
        (Number(vendor.total_refunded) - Number(vendor.total_refund_allocated))
      : 0;

    // Start transaction with pre-validated data
    const returnRecord = await prisma.$transaction(async (tx) => {
      // Calculate totals
      const totalAmount = items.reduce((sum, i) => sum + (i.return_qty * i.unit_price), 0);
      const totalTax = items.reduce((sum, i) => sum + (i.tax_amount || 0), 0);
      
      // Create return record
      const returnRecord = await tx.purchase_returns.create({
        data: {
          vendor_id: parseInt(vendor_id),
          return_date: convertDateToTimestamp(return_date),
          total_amount: totalAmount,
          total_tax: totalTax,
          refund_amount: totalAmount + totalTax + (packing_forwarding_amount || 0),
          packing_forwarding_amount: packing_forwarding_amount || 0,
          payment_status: payment_status || 0,
          payment_mode: payment_mode || 1,
          notes: notes || '',
          fy: currentFy,
          debit_note_no: `DN-${Date.now()}` // Generate debit note number
        }
      });

      // ✅ OPTIMIZATION 2: Parallel operations
      await Promise.all([
        // Create return items
        tx.purchase_return_items.createMany({
          data: items.map(item => ({
            purchase_return_id: returnRecord.id,
            purchase_item_id: item.purchase_item_id,
            return_qty: item.return_qty,
            unit_price: item.unit_price,
            tax_amount: item.tax_amount,
            cgst: item.cgst || 0,
            sgst: item.sgst || 0,
            igst: item.igst || 0,
            return_reason_id: item.return_reason_id,
            notes: item.notes || ''
          }))
        }),
        // Stock updates in parallel
        ...items.map(item => {
          const purchaseItem = purchaseItemMap.get(item.purchase_item_id);
          return tx.product.update({
            where: { id: purchaseItem.product_id },
            data: { stock: { decrement: item.return_qty } }
          });
        }),
        // DEBIT_NOTE ledger entry
        ledgerService.createEntry({
          vendor_id: parseInt(vendor_id),
          transaction_date: convertDateToTimestamp(return_date),
          transaction_type: 'DEBIT_NOTE',
          reference_type: 'purchase_return',
          reference_id: returnRecord.id,
          reference_no: returnRecord.debit_note_no,
          debit: totalAmount + totalTax,
          credit: 0,
          notes: `Return ${returnRecord.debit_note_no}`,
          fy: currentFy
        }, tx)
      ]);

      // Handle refund allocations if paid immediately
      if (payment_status === 1) {
        // Smart refund allocation using advance balance
        const refundAmount = totalAmount + totalTax + (packing_forwarding_amount || 0);
        // ... (similar to purchase create logic)
      }

      // Update purchase return_status
      await updatePurchaseReturnStatus(tx, purchaseItemIds, purchaseItemMap);

      return returnRecord;
    }, { timeout: 45000 });

    res.status(201).json({
      success: true,
      data: { return: returnRecord },
      message: 'Return created successfully'
    });
  } catch (error) {
    console.error('Return creation error:', error);
    res.status(500).json({
      message: 'Failed to create return',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
```

**Expected Performance:** < 1.5 seconds for typical returns

---

## 4. Return Edit (PUT /api/purchase-returns/[id].ts)

### Current Performance Issues

#### 🐌 **Issue 1: Return Status Recalculation is SLOW**
```typescript
// CURRENT (SLOW): Multiple sequential queries
const returnWithPurchase = await tx.purchase_returns.findUnique({...});
if (returnWithPurchase?.purchase_id) {
  const purchaseRecord = await tx.purchase.findUnique({...});
  if (purchaseRecord) {
    const allPurchaseItems = await tx.purchaseitems.findMany({...});
    const allReturns = await tx.purchase_return_items.findMany({...});
    // Then complex loop logic
  }
}
```

**Fix:** Parallelize and use aggregation
```typescript
// OPTIMIZED: Parallel queries + single aggregation query
const returnWithPurchase = await tx.purchase_returns.findUnique({...});

if (returnWithPurchase?.purchase_id) {
  const [purchaseRecord, allPurchaseItems, returnAggregates] = await Promise.all([
    tx.purchase.findUnique({...}),
    tx.purchaseitems.findMany({...}),
    // ✅ Use groupBy for aggregation (faster than findMany + loop)
    tx.purchase_return_items.groupBy({
      by: ['purchase_item_id'],
      where: { purchase_item_id: { in: purchaseItemIds } },
      _sum: { return_qty: true }
    })
  ]);

  // Build map from aggregates
  const returnMap = new Map(
    returnAggregates.map(r => [r.purchase_item_id, r._sum.return_qty || 0])
  );

  // Calculate status
  let fullyReturnedCount = 0;
  let hasAnyReturns = false;
  
  for (const item of allPurchaseItems) {
    const returnedQty = returnMap.get(item.id) || 0;
    if (returnedQty > 0) {
      hasAnyReturns = true;
      if (returnedQty >= (item.qty || 0)) {
        fullyReturnedCount++;
      }
    }
  }

  const returnStatus = !hasAnyReturns ? 0 : 
    (fullyReturnedCount === allPurchaseItems.length ? 2 : 1);

  await tx.purchase.update({
    where: { id: returnWithPurchase.purchase_id },
    data: { return_status: returnStatus }
  });
}
```

**Expected Improvement:** 40-50% faster

---

#### 🐌 **Issue 2: Stock Adjustments Loop Through Items Twice**
```typescript
// CURRENT (SLOW): First loop to calculate, then execute
for (const oldItem of currentReturnItems) {
  // Calculate adjustment
}
for (const newItem of processedItems) {
  // Calculate adjustment
}

// Then execute stock updates
await Promise.all(stockUpdatePromises);
```

**Fix:** Single-pass calculation
```typescript
// OPTIMIZED: Calculate net changes in single pass
const netStockChanges = new Map();

// Build lookup for old items
const oldItemMap = new Map(currentReturnItems.map(i => [i.purchase_item_id, i]));

// Process all items in single pass
for (const purchaseItemId of allPurchaseItemIds) {
  const oldItem = oldItemMap.get(purchaseItemId);
  const newItem = processedItemsMap.get(purchaseItemId);
  
  const oldQty = oldItem?.return_qty || 0;
  const newQty = newItem?.return_qty || 0;
  const netChange = oldQty - newQty; // Positive = add to stock, Negative = remove
  
  if (netChange !== 0) {
    const productId = purchaseItemMap.get(purchaseItemId);
    if (productId) {
      netStockChanges.set(productId, 
        (netStockChanges.get(productId) || 0) + netChange
      );
    }
  }
}

// Execute stock updates in parallel (only changed products)
await Promise.all(
  Array.from(netStockChanges.entries())
    .map(([productId, change]) =>
      tx.product.update({
        where: { id: productId },
        data: { stock: { increment: change } }
      })
    )
);
```

**Expected Improvement:** 25-30% faster

---

#### 🐌 **Issue 3: Vendor Balance Query Inside Transaction**
```typescript
// CURRENT (SLOW): Query inside transaction
const vendor = await tx.vendor_details.findUnique({
  where: { id: existingReturn.vendor_id },
  select: { total_paid: true, ... }
});
```

**Fix:** Query before transaction
```typescript
// OPTIMIZED: Query outside transaction
const [existingReturn, vendor] = await Promise.all([
  prisma.purchase_returns.findUnique({...}),
  prisma.vendor_details.findUnique({...})
]);

const result = await prisma.$transaction(async (tx) => {
  // Use pre-fetched vendor data
  const handlerResult = await transactionHandler.handleReturnEdit({
    ...
    currentBalance: vendor ? { ... } : undefined
  });
  ...
});
```

**Expected Improvement:** 15-20% faster

---

### Recommended Changes Summary

**Priority Changes:**
1. ✅ **HIGH:** Move vendor balance query outside transaction
2. ✅ **HIGH:** Optimize return status recalculation with aggregation
3. ✅ **HIGH:** Single-pass stock adjustment calculation

**Expected Total Improvement:** 80-100% faster (4-6s → 1-1.5s)

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 days)
1. ✅ Move vendor balance queries outside transactions
2. ✅ Parallelize independent query operations
3. ✅ Implement Return Create endpoint

### Phase 2: Algorithm Improvements (2-3 days)
1. ✅ Optimize item change detection in Purchase Edit
2. ✅ Optimize stock adjustment calculations
3. ✅ Single-pass return status recalculation

### Phase 3: Testing & Validation (1-2 days)
1. ✅ Performance testing with real data
2. ✅ Edge case validation
3. ✅ Load testing with concurrent requests

---

## Monitoring Plan

### Before Optimization
```typescript
// Add timing logs
const startTime = Date.now();
// ... operation ...
const duration = Date.now() - startTime;
console.log(`[PERF] Operation took ${duration}ms`);
```

### After Optimization
```typescript
// Expected targets
// Purchase Create: < 1000ms (currently ~3000-5000ms)
// Purchase Edit: < 1500ms (currently ~4000-6000ms)
// Return Create: < 1000ms (new implementation)
// Return Edit: < 1000ms (currently ~4000-6000ms)
```

### Success Metrics
- ✅ 50%+ reduction in average response time
- ✅ 95th percentile < 2 seconds
- ✅ Zero timeout errors
- ✅ Consistent performance under load

---

## Risk Mitigation

### Transaction Timeout Handling
```typescript
// Increase timeouts for complex operations
const result = await prisma.$transaction(async (tx) => {
  // ... complex operations ...
}, {
  timeout: 60000, // 60 seconds for safety
  maxWait: 10000  // 10 seconds max wait for connection
});
```

### Rollback Strategy
- All optimizations are backward compatible
- No schema changes required
- Can be deployed incrementally per endpoint
- Easy to revert if issues arise

---

## 5. Vendor Payment Create (POST /api/vendor-payments/index.ts)

### Current Performance Issues - CRITICAL ⚠️

**Reported:** 13 seconds for multi-allocation payment

#### 🐌 **Issue 1: Sequential Allocation Processing in Loop**
```typescript
// CURRENT (SLOW): Sequential loop - each allocation waits for previous
for (const allocation of allocations) {
  const alloc = await tx.payment_allocations.create({...});
  const purchase = await tx.purchase.findUnique({...});
  const allocationsSum = await tx.payment_allocations.aggregate({...});
  await tx.purchase.update({...});
  await ledgerService.createEntry({...}, tx);
}
// For 5 allocations: 25+ sequential operations!
```

**Fix:** Parallelize everything
```typescript
// OPTIMIZED: Parallel execution
// 1. Create all allocations at once
await tx.payment_allocations.createMany({
  data: allocations.map(a => ({
    payment_id: payment.id,
    purchase_id: a.purchase_id,
    allocated_amount: a.allocated_amount,
    allocation_date: paymentTimestamp,
    notes: a.notes || null
  }))
});

// 2. Batch fetch all affected purchases
const purchaseIds = allocations.map(a => a.purchase_id);
const [purchases, allocSums] = await Promise.all([
  tx.purchase.findMany({
    where: { id: { in: purchaseIds } },
    select: { id: true, invoice_no: true, total: true }
  }),
  tx.payment_allocations.groupBy({
    by: ['purchase_id'],
    where: { purchase_id: { in: purchaseIds } },
    _sum: { allocated_amount: true }
  })
]);

// 3. Build lookup maps
const purchaseMap = new Map(purchases.map(p => [p.id, p]));
const allocMap = new Map(allocSums.map(a => [a.purchase_id, a._sum.allocated_amount || 0]));

// 4. Calculate statuses in parallel
const statusUpdates = allocations.map(allocation => {
  const purchase = purchaseMap.get(allocation.purchase_id)!;
  const totalPaid = allocMap.get(allocation.purchase_id) || 0;
  const newStatus = totalPaid === 0 ? 0 : 
    totalPaid >= Number(purchase.total) ? 1 : 2;
  return { purchaseId: allocation.purchase_id, status: newStatus, purchase };
});

// 5. Execute all updates and ledger entries in parallel
await Promise.all([
  // Update all purchase statuses
  ...statusUpdates.map(u => 
    tx.purchase.update({
      where: { id: u.purchaseId },
      data: { payment_status: u.status }
    })
  ),
  // Create all ledger entries
  ...allocations.map((allocation, idx) => 
    ledgerService.createEntry({
      vendor_id: vendorId,
      transaction_date: paymentTimestamp,
      transaction_type: 'PAYMENT',
      reference_id: allocation.purchase_id,
      credit: allocation.allocated_amount,
      transaction_id: payment.id,
      // ... other fields
    }, tx)
  )
]);
```

**Expected Improvement:** 85-90% faster (13s → 1-2s)

---

#### 🐌 **Issue 2: Aggregate Query for Each Allocation**
```typescript
// CURRENT (SLOW): N aggregate queries
for (const allocation of allocations) {
  const allocationsSum = await tx.payment_allocations.aggregate({
    where: { purchase_id: allocation.purchase_id },
    _sum: { allocated_amount: true }
  });
}
```

**Fix:** Single groupBy query for all purchases
```typescript
// OPTIMIZED: One query for all
const allocSums = await tx.payment_allocations.groupBy({
  by: ['purchase_id'],
  where: { purchase_id: { in: purchaseIds } },
  _sum: { allocated_amount: true }
});
```

**Expected Improvement:** Included in Issue 1 fix

---

### Recommended Changes Summary

**Priority Changes:**
1. ✅ **CRITICAL:** Replace allocation loop with parallel operations
2. ✅ **CRITICAL:** Use createMany + groupBy + batch updates
3. ✅ **HIGH:** Parallel ledger entry creation

**Expected Total Improvement:** 85-90% faster (13s → 1-2s)

---

## 6. Vendor Payment Update (PUT /api/vendor-payments/[id].ts)

### Current Performance Issues

Already using transaction handler which is optimized. Main issue is likely:

#### 🐌 **Issue: Sequential Purchase Status Recalculation**
```typescript
// CURRENT: Sequential recalculation
if (handlerResult.metadata?.purchasesToUpdate) {
  await Promise.all(
    handlerResult.metadata.purchasesToUpdate.map(purchaseId =>
      recalculatePurchaseStatus(purchaseId, tx)
    )
  );
}
```

**Already Optimal** - Using Promise.all for parallel execution

### Additional Optimization

Move the handler call preparation outside transaction:
```typescript
// Calculate outside transaction
const handlerParams = {
  paymentId,
  vendorId: existingPayment.vendor_id,
  oldAmount: Number(existingPayment.payment_amount),
  // ... prepare all params
};

// Then start transaction
const result = await prisma.$transaction(async (tx) => {
  const handlerResult = await transactionHandler.handleVendorPaymentEdit(handlerParams);
  // ... execute operations
});
```

**Expected Improvement:** 10-15% faster

---

## 7. Vendor Refund Create/Update

**Note:** Refunds likely have similar issues to payments

### Optimization Strategy
Apply same parallelization pattern as payment endpoints

**Expected Improvement:** 85-90% faster for create, 10-15% for update

---

## Next Steps

1. **Approve this plan** with stakeholders
2. **Create feature branch** for optimizations
3. **Implement Phase 1** quick wins
4. **Test thoroughly** in staging environment
5. **Deploy to production** with monitoring
6. **Measure results** and iterate

---

**Document Version:** 1.1  
**Status:** Ready for Implementation  
**Updated:** Added vendor payment/refund optimizations  
**Estimated Effort:** 6-8 days total
