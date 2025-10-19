# Business Logic Documentation

## Rate Calculation System

### Overview
The "Rate" displayed in the products table shows the **Latest Purchase Rate** as the primary rate, with Opening Rate as fallback only for new products that haven't been purchased yet.

### Rate Display Logic

#### Primary Rate Source: Latest Purchase Rate (Always Primary)
```sql
-- Current System Query
SELECT rate FROM purchase_items
WHERE product_id = [product_id]
ORDER BY invoice_date DESC
LIMIT 1
```

#### NextJS Implementation
```typescript
// Current API Logic (/api/products/index.ts)
const latestPurchase = await prisma.purchaseitems.findFirst({
  where: { product_id: product.id },
  orderBy: { invoice_date: 'desc' }
})

// Display rate prioritizes latest purchase rate always
const displayRate = (latestPurchase?.rate || 0) || product.opening_rate || 0
```

### Rate Priority System

1. **Latest Purchase Rate** (Primary - Always Displayed)
   - Most recent purchase cost becomes the display rate immediately
   - Reflects current market pricing and actual costs paid
   - Updates automatically on every purchase transaction

2. **Opening Rate** (Fallback - New Products Only)
   - Used only when no purchases have ever been made
   - Serves as initial rate when product is first created
   - Becomes irrelevant once first purchase occurs

3. **Zero Rate** (Default)
   - Only when neither latest purchase nor opening rate exists

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

### Current Logic (Pre-Migration)
- **Categories**: Stored as IDs, displayed as names from `product_category` table
- **Companies**: Stored as IDs, displayed as names from `product_company` table

### Current NextJS Implementation
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

## 🚧 Upcoming Changes (Post-Migration)

### New Product Categorization Structure
After the product categorization migration:

- **Product Names**: Stored in `product_category` table (e.g., "Oil Filter", "Air Filter")
- **Subcategories**: Stored in `product_subcategory` table (e.g., "Filters")
- **Car Models**: Stored in `car_models` table (e.g., "Toyota Camry")
- **Product Table**: Will have foreign key relationships instead of string storage

### Post-Migration Logic (Planned)
```typescript
// Get product name from new structure
const productName = await prisma.product_category.findFirst({
  where: { id: product.product_category_id }
})
const displayProductName = product.display_name // Main product identifier

// Get subcategory name
const subcategory = await prisma.product_subcategory.findFirst({
  where: { id: product.product_subcategory_id }
})

// Get car model name
const carModel = await prisma.car_models.findFirst({
  where: { id: product.car_model_id }
})

// Full display format
const fullDisplayName = `${displayProductName} - ${subcategory?.subcategory_name} - ${carModel?.model_name}`
```

### Migration Impact on Business Logic
- **Rate Display**: Unchanged - still uses latest purchase rate
- **Stock Management**: Unchanged - same stock level calculations
- **Display Logic**: Will be enhanced to use proper relational data
- **Filtering**: Improved with foreign key relationships
- **Data Integrity**: Enhanced through database constraints

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
