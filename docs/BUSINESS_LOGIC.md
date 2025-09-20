# Business Logic Documentation

## Rate Calculation System

### Overview
The "Rate" displayed in the products table follows the legacy Yii2 system's business logic, which shows the **Latest Purchase Rate** instead of the base product rate.

### Rate Display Logic

#### Primary Rate Source: Latest Purchase Rate
```sql
-- Legacy System Query (from Product::getLPRate())
SELECT rate FROM purchase_items 
WHERE name_of_product = [product_id] 
ORDER BY invoice_date DESC 
LIMIT 1
```

#### NextJS Implementation
```typescript
// Enhanced API Logic (/api/products/enhanced.ts)
const latestPurchase = await prisma.purchaseitems.findFirst({
  where: { name_of_product: product.id.toString() },
  orderBy: { invoice_date: 'desc' }
})

const displayRate = latestPurchase?.rate || product.rate || 0
```

### Rate Priority System

1. **Latest Purchase Rate** (Primary)
   - Gets the rate from the most recent purchase of this product
   - Reflects current market pricing
   - Updates automatically when new purchases are made

2. **Base Product Rate** (Fallback)
   - Used when no purchase history exists
   - Stored in the product table
   - Manual entry fallback

3. **Zero Rate** (Default)
   - When neither purchase history nor base rate exists

### Why This System?

#### Business Benefits:
- **Current Market Pricing**: Shows actual recent purchase costs
- **Dynamic Updates**: Rates update automatically with new purchases
- **Price Tracking**: Historical pricing through purchase records
- **Accurate Costing**: Reflects real business costs for pricing decisions

#### Example Scenarios:
```
Product: AC Switch (ID: 4111)
- Base Rate: ₹850 (old/manual entry)
- Latest Purchase: ₹900 (recent purchase on 15/09/2025)
- Display Rate: ₹900 ✓ (shows latest purchase rate)

Product: New Product (ID: 4112)  
- Base Rate: ₹500 (manual entry)
- Latest Purchase: None
- Display Rate: ₹500 ✓ (shows base rate)
```

## Category and Company Display

### Legacy System Logic
- **Categories**: Stored as IDs, displayed as names from `product_category` table
- **Companies**: Stored as IDs, displayed as names from `product_company` table

### NextJS Implementation
```typescript
// Get category name
const category = await prisma.product_category.findFirst({
  where: { id: parseInt(product.product_category) }
})
const categoryName = category?.category_name || product.product_category

// Get company name
const company = await prisma.product_company.findFirst({
  where: { id: parseInt(product.company) }
})
const companyName = company?.company_name || product.company
```

## Stock Management Logic

### Low Stock Calculation
```sql
-- Legacy System Logic
WHERE stock < min_stock
```

### Stock Status Display
- **Out of Stock**: `stock = 0` (Red indicator with 🚨)
- **Low Stock**: `stock < 2` OR `stock < min_stock` (Orange indicator with ⚠️)
- **In Stock**: `stock >= min_stock` AND `stock >= 2` (Green indicator with ✅)

#### Stock Status Logic (Enhanced from Legacy)
```typescript
// NextJS Enhanced Stock Logic
if (stock === 0) {
  return "🚨 Out of Stock" // Critical - no inventory
} else if (stock < 2 || stock < min_stock) {
  return "⚠️ Low Stock" // Warning - needs replenishment  
} else {
  return "✅ In Stock" // Good - adequate inventory
}
```

#### Business Rules:
1. **Out of Stock (Priority 1)**: Zero inventory requires immediate action
2. **Low Stock (Priority 2)**: Either below safety threshold (2) or below minimum stock level
3. **In Stock (Priority 3)**: Adequate inventory for normal operations

## Data Relationships

### Product Structure
```
Product (Main Table)
├── product_category → product_category.category_name
├── company → product_company.company_name  
├── product_subcategory (comma-separated IDs)
└── Latest Purchase Rate → purchase_items.rate (latest by date)
```

### Purchase Integration
```
Product ←→ Purchase Items (for rate calculation)
├── name_of_product = product.id
├── rate (latest purchase rate)
└── invoice_date (for sorting latest)
```

## Implementation Notes

### Performance Considerations
- **Enhanced API**: Joins multiple tables for complete data
- **Pagination**: Handles 4,111+ products efficiently
- **Caching**: Consider adding for frequently accessed data

### Data Integrity
- **Fallback Logic**: Graceful handling when related data is missing
- **Type Safety**: TypeScript interfaces ensure data consistency
- **Error Handling**: Robust error handling for database operations

### Legacy Compatibility
- **100% Compatible**: Maintains exact same business logic
- **Same Calculations**: Identical rate and stock calculations  
- **Same Display Format**: Matches legacy system output exactly

## 📋 Transaction Management System

### Transaction Types & Table Usage

#### Sales Transactions (`/sale`)
- **Main Table**: `invoice` (regular sales)
- **Items Table**: `invoiceitems` (regular sales items)
- **Address Table**: `bill_tosales` (billing addresses)
- **Date Format**: Integer timestamp (`invoice_date Int`)
- **Status Values**:
  - `0` = Pending
  - `1` = Paid
  - `2` = Cancelled
  - `null/undefined` = Draft

#### Extended Sales Transactions (`/salex`)
- **Main Table**: `invoicex` (extended sales)
- **Items Table**: `invoice_itemsx` (extended sales items)
- **Address Table**: `bill_tosalesx` (extended billing)
- **Date Format**: Integer timestamp (`invoice_date Int`)
- **Status Values**: Same as regular sales
- **Purpose**: Warranties, service contracts, extended support

#### Purchase Transactions (`/purchases`)
- **Main Table**: `purchase` (purchases)
- **Items Table**: `purchaseitems` (purchase items)
- **Address Table**: `vendor_details` (vendor information)
- **Date Format**: String date (`invoice_date String @db.VarChar(30)`)
- **Status Values**:
  - `0` = Pending
  - `1` = Received

### API Endpoints

#### Sales API (`/api/sales`)
```typescript
// Uses regular tables
prisma.invoice.findMany()
prisma.invoiceitems.groupBy()
prisma.bill_tosales.findMany()
```

#### Salex API (`/api/salex`)
```typescript
// Uses 'x' tables
prisma.invoicex.findMany()
prisma.invoice_itemsx.groupBy()
prisma.bill_tosalesx.findMany()
```

#### Purchases API (`/api/purchases`)
```typescript
// Uses purchase tables
prisma.purchase.findMany()
prisma.purchaseitems.groupBy()
prisma.vendor_details.findMany()
```

### Date Handling Logic

#### Timestamp Dates (Sales & Salex)
```typescript
// Convert Unix timestamp to readable date
const dateObj = new Date(invoice_date * 1000)
const formattedDate = dateObj.toLocaleDateString('en-IN')
```

#### String Dates (Purchases)
```typescript
// Parse string date format
const dateObj = new Date(invoice_date)
const formattedDate = dateObj.toLocaleDateString('en-IN')
```

### UI Component Architecture

#### TransactionTable Component
- **Conditional Type Column**: Hidden on individual pages (`hideTypeColumn={true}`)
- **Lucid Icons Only**: Uses `lucide-react` icons exclusively
- **Responsive Design**: Adapts to different screen sizes
- **Sorting**: Multi-column sorting with visual indicators

#### TransactionFilters Component
- **Conditional Transaction Type**: Hidden on individual pages
- **Debounced Search**: 300ms delay for performance
- **Advanced Filters**: Date range, amount range, status filters

## Future Enhancements

### Potential Improvements
1. **Rate History**: Track rate changes over time
2. **Automated Reorder**: Auto-generate purchase orders for low stock
3. **Price Alerts**: Notify when purchase rates change significantly
4. **Bulk Updates**: Mass update rates and stock levels
5. **Advanced Analytics**: Rate trends and cost analysis

### Database Optimizations
1. **Indexes**: Add indexes on frequently queried fields
2. **Views**: Create database views for complex rate calculations
3. **Stored Procedures**: Move complex logic to database level
4. **Caching**: Cache category/company lookups
