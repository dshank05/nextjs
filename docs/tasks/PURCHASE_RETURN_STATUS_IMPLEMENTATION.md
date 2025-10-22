# Purchase Return Status Implementation

## Overview
Implement return status tracking for purchases to hide fully returned purchases from the purchase list, addressing performance concerns with database joins.

## Problem Statement
- Current purchase returns work but fully returned purchases still appear in purchase list
- Checking for returns via database joins would significantly slow down the purchases API
- Need efficient way to track and filter returned purchases

## Solution: Return Status Field
Add `return_status` field to Purchase table using numeric codes for optimal performance.

### Status Codes
- **0**: None (no returns) - Show normally
- **1**: Partial (some items returned) - Show with indicator
- **2**: Full (all items returned) - Hide from list

## Implementation Plan

### Phase 1: Database Schema Changes
#### Schema Update
```prisma
model Purchase {
  // ... existing fields ...
  return_status: Int? @default(0)  // 0=none, 1=partial, 2=full
}
```

#### Migration Script
```sql
-- Add return_status column to purchase table
ALTER TABLE purchase ADD COLUMN return_status INT NULL DEFAULT 0;
```

### Phase 2: API Updates

#### Purchase POST (Create)
- Set `return_status: 0` for all new purchases
- **Location**: `pages/api/purchases/index.ts` handlePost function

#### Purchase PUT (Update)
- Preserve existing `return_status` (don't modify during updates)
- **Location**: `pages/api/purchases/index.ts` handlePut function

#### Purchase-returns POST
- **Full Return** (`full_return: true`): Set purchase `return_status: 2`
- **Partial Return**: Set purchase `return_status: 1` (if not already 2)
- Update purchase record within transaction
- **Location**: `pages/api/purchase-returns/index.ts` POST handler

#### Purchases GET (List)
- Filter out purchases with `return_status: 2` (fully returned)
- Add `return_status` to query results for frontend status indicators
- **Location**: `pages/api/purchases/index.ts` handleGet function

### Phase 3: Frontend Updates

#### Purchase List Display
- Hide purchases with `return_status: 2`
- Show indicator for purchases with `return_status: 1` (partial returns)
- **Location**: `pages/entry/purchasereturn.tsx`

## Business Logic

### Return Status Determination
- **Full Return**: When `full_return: true` is processed
  - Create return items for ALL original purchase items
  - Set `return_qty = original_qty` for each item
  - Set purchase `return_status = 2`
- **Partial Return**: When specific items are returned
  - Create return items for selected items only
  - Set `return_status = 1` if not already 2

### Inventory Impact
- **Purchase Returns**: `inventory -= return_qty` (remove defective items)
- Automatic stock adjustment in return transaction

### Performance Considerations
- ✅ **No Database Joins** in purchase list query
- ✅ **Simple Integer Comparison** for filtering
- ✅ **Atomic Updates** within return transactions
- ✅ **Minimal Schema Impact** (single nullable integer field)

## Technical Implementation Details

### Database Transaction Safety
```typescript
// In purchase-returns API
const result = await prisma.$transaction(async (tx) => {
  // 1. Create return record
  const purchaseReturn = await tx.purchase_returns.create({...});

  // 2. Create return items
  await tx.purchase_return_items.createMany({...});

  // 3. Update inventory
  for (const item of finalReturnItems) {
    await tx.product.update({
      where: { id: purchaseItem.product_id },
      data: { stock: { decrement: parseFloat(item.return_qty) } }
    });
  }

  // 4. Update purchase return status
  await tx.purchase.update({
    where: { id: parseInt(purchase_id) },
    data: { return_status: full_return ? 2 : 1 }
  });

  return purchaseReturn;
});
```

### Query Optimization
```typescript
// In purchases GET API
const where: any = {
  // ... existing filters ...
  return_status: { not: 2 } // Exclude fully returned purchases
};
```

## Success Criteria

### Functional Requirements
- ✅ Fully returned purchases hidden from purchase list
- ✅ Partially returned purchases shown with status indicator
- ✅ Return status updates correctly on return processing
- ✅ Inventory adjustments work correctly
- ✅ No performance degradation in purchase list loading

### Technical Requirements
- ✅ Zero database joins added to purchase queries
- ✅ Integer field provides optimal filtering performance
- ✅ Transaction safety maintained for all operations
- ✅ Backward compatibility with existing purchases

## Testing Scenarios

### Test Case 1: Full Purchase Return
1. Create purchase with multiple items
2. Process "Return Whole Order"
3. Verify purchase disappears from purchase list
4. Verify inventory decreased correctly
5. Verify return record created with all items

### Test Case 2: Partial Purchase Return
1. Create purchase with multiple items
2. Process return for single item only
3. Verify purchase still appears in list
4. Verify purchase shows partial return indicator
5. Verify inventory adjusted for returned item only

### Test Case 3: Performance Verification
1. Load purchase list with 1000+ records
2. Verify no performance degradation
3. Confirm filtering works without joins

## Rollback Plan

### Database Rollback
```sql
-- Remove return_status column if needed
ALTER TABLE purchase DROP COLUMN return_status;
```

### Code Rollback
- Remove return_status assignments from APIs
- Remove return_status filtering from purchase list
- Restore original purchase return logic

## Future Enhancements

### Potential Additions
1. **Return History Display**: Show return details for partially returned purchases
2. **Return Analytics**: Dashboard showing return rates and reasons
3. **Return Approval Workflow**: Multi-step approval for large returns
4. **Supplier Notifications**: Automatic notifications for returns

### Integration Points
1. **Accounting System**: Link returns to credit/debit notes
2. **Supplier Portal**: Allow suppliers to view return history
3. **Quality Management**: Track return reasons for quality analysis

## Risk Assessment

### Technical Risks
- **Data Migration**: Existing purchases get default return_status = 0
- **Query Performance**: Minimal impact (single field addition)
- **Transaction Deadlocks**: Unlikely (simple single-row updates)

### Business Risks
- **Hidden Purchases**: Users might not see purchases they need for reference
- **Status Confusion**: Need clear UI indicators for return statuses
- **Audit Trail**: Complete logging of status changes required

## Monitoring & Alerts

### Key Metrics
- Purchase list loading performance
- Return processing success rate
- Inventory accuracy after returns
- User reports of missing purchases

### Alerts
- Performance degradation >10% in purchase queries
- Failed return processing transactions
- Inventory discrepancies detected

---

## Current Status: READY FOR IMPLEMENTATION

All design work completed. Ready to:
1. Add database migration
2. Update APIs with return status logic
3. Test end-to-end return workflows
4. Deploy with monitoring

**Estimated Implementation Time**: 2-3 hours
**Performance Impact**: None (optimized design)
**Risk Level**: Low (simple schema addition)
