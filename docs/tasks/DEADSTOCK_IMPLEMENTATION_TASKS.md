# Deadstock Implementation Tasks

## Overview
Implementation of deadstock management system for handling faulty, obsolete, and non-moving inventory. Integrates with returns system and provides direct marking capabilities.

## Core Business Logic

### Deadstock Sources
1. **From Returns**: Faulty items identified during sale/purchase return processing
2. **Direct Marking**: Products marked as faulty/deadstock directly from product management
3. **Automated Identification**: Future enhancement for automatic deadstock detection

### Inventory Impact
- **Stock Reduction**: `inventory -= deadstock_qty` (permanent removal from active inventory)
- **Separate Tracking**: Deadstock quantities tracked separately from regular stock
- **No Restocking**: Deadstock items cannot be returned to active inventory

### Financial Impact
- **Write-offs**: Deadstock represents lost value/write-offs
- **Disposal Tracking**: Track disposal methods and costs
- **Asset Management**: Remove from active asset calculations

## Database Schema Implementation

### Deadstock Tables
```sql
-- Main deadstock tracking table
model deadstock {
  id               Int      @id @default(autoincrement())
  product_id       Int      // FK to Product
  quantity         Float    // Quantity marked as deadstock
  reason           String   @db.VarChar(255) // "Faulty", "Damaged", "Obsolete", "Expired"
  source_type      String   @db.VarChar(20)  // "return", "direct", "write_off", "auto"
  source_id        Int?     // FK to return record if from return, null for direct
  disposal_method  String?  @db.VarChar(100) // "Scrap", "Donate", "Destroy", "Sell", "Recycle"
  disposal_cost    Float?   // Cost associated with disposal
  disposal_date    DateTime? // When disposal was completed
  notes            String?  @db.Text // Additional details
  fy               Int      // Financial year
  created_by       Int?     // User who created the deadstock entry
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt

  // Relationships
  product          Product  @relation(fields: [product_id], references: [id])
}

-- Deadstock reasons catalog (reusable)
model deadstock_reasons {
  id           Int      @id @default(autoincrement())
  reason_name  String   @db.VarChar(255) // "Faulty from manufacturer", "Customer return damaged", etc.
  category     String   @db.VarChar(50)  // "Quality", "Damage", "Obsolete", "Expired"
  status       String   @default("Active") @db.VarChar(20)
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
}
```

### Integration with Existing Tables
- **Product Table**: Reference for product details and current stock
- **Return Tables**: Link deadstock to originating return when applicable
- **User Table**: Track who created deadstock entries

## Relationship with Returns System

### Integration Points
1. **Return Processing**: Option to mark returned items as deadstock
2. **Automatic Flagging**: Certain return reasons trigger deadstock consideration
3. **Separate Workflows**: Deadstock can exist independently of returns

### Workflow Options
#### Option A: Integrated with Returns
```
Sale Return (Faulty) → Mark as Deadstock → Remove from Inventory
Purchase Return (Faulty) → Mark as Deadstock → Remove from Inventory
```

#### Option B: Standalone Deadstock
```
Product Management → Mark as Deadstock → Remove from Inventory
```

#### Option C: Hybrid Approach (Recommended)
```
Returns Flow:
├── Normal Returns → Standard processing
└── Faulty Returns → Deadstock option available

Standalone Flow:
└── Direct deadstock marking from product pages
```

## Implementation Phases

### Phase 1: Database & Infrastructure
#### Tasks:
1. **Create Migration**: Add deadstock tables with relationships
2. **Seed Data**: Populate deadstock_reasons with standard reasons
3. **API Infrastructure**: Basic CRUD for deadstock management
4. **Product Integration**: Add deadstock quantity tracking to Product model

#### Success Criteria:
- Deadstock tables created with proper constraints
- API endpoints functional
- Product table extended for deadstock tracking

### Phase 2: Return System Integration
#### Tasks:
1. **Return UI Enhancement**: Add deadstock option to return processing
2. **Reason Mapping**: Configure which return reasons suggest deadstock
3. **Workflow Integration**: Seamless flow from return to deadstock
4. **Validation Logic**: Ensure deadstock quantities don't exceed available stock

#### Success Criteria:
- Return processing can create deadstock entries
- UI clearly indicates deadstock option
- Validation prevents over-allocation

### Phase 3: Standalone Deadstock Interface
#### Tasks:
1. **Product Page Integration**: Add deadstock button/marking capability
2. **Bulk Deadstock Operations**: Allow marking multiple products as deadstock
3. **Reason Selection**: Comprehensive deadstock reason management
4. **Quantity Controls**: Partial or full deadstock marking

#### Success Criteria:
- Direct deadstock marking from product management
- Bulk operations supported
- All deadstock reasons available

### Phase 4: Disposal & Reporting
#### Tasks:
1. **Disposal Tracking**: Record disposal methods and costs
2. **Status Management**: Track deadstock lifecycle (created → disposed)
3. **Reporting Dashboard**: Deadstock analytics and summaries
4. **Financial Integration**: Write-off tracking and calculations

#### Success Criteria:
- Complete disposal workflow
- Financial impact tracking
- Comprehensive reporting

### Phase 5: Advanced Features
#### Tasks:
1. **Automated Detection**: Rules for automatic deadstock identification
2. **Expiry Management**: Track product expiry dates for deadstock
3. **Disposal Optimization**: Recommendations for disposal methods
4. **Integration Testing**: End-to-end workflow testing

#### Success Criteria:
- Automated processes working
- Advanced analytics available
- Performance optimized

## Business Rules & Validations

### Core Validations
1. **Stock Availability**: Deadstock quantity cannot exceed current inventory
2. **Return Integration**: Deadstock from returns cannot exceed return quantities
3. **Financial Year Tracking**: Deadstock entries tracked by FY
4. **User Permissions**: Only authorized users can create deadstock

### Inventory Rules
1. **Immediate Removal**: Stock reduced immediately upon deadstock creation
2. **No Reversals**: Deadstock cannot be returned to active inventory
3. **Separate Accounting**: Deadstock tracked separately from regular stock
4. **Audit Trail**: Complete history of deadstock operations

### Disposal Rules
1. **Method Tracking**: All disposal methods recorded
2. **Cost Accounting**: Disposal costs tracked and reported
3. **Timeline Management**: Disposal completion tracked
4. **Regulatory Compliance**: Disposal methods meet legal requirements

## Technical Implementation Notes

### Performance Considerations
- **Indexing**: Index deadstock tables on product_id, status, fy
- **Query Optimization**: Efficient lookups for deadstock reporting
- **Caching**: Cache deadstock reasons and common queries
- **Background Processing**: Handle bulk deadstock operations asynchronously

### Data Integrity
- **Transaction Safety**: Use database transactions for stock adjustments
- **Foreign Key Constraints**: Maintain referential integrity
- **Audit Logging**: Track all deadstock operations
- **Rollback Support**: Ability to correct deadstock entries

### API Design
- **RESTful Endpoints**: Consistent with existing API patterns
- **Bulk Operations**: Support for bulk deadstock creation
- **Filtering**: Advanced filtering for deadstock lists
- **Export**: Data export capabilities for reporting

## Integration Points

### Returns System Integration
- **Shared Reasons**: Return reasons integrated with deadstock reasons
- **Workflow Continuity**: Smooth transition from returns to deadstock
- **Data Consistency**: Shared product and quantity data

### Product Management Integration
- **Stock Display**: Show deadstock quantities separately
- **Direct Actions**: Quick deadstock marking from product views
- **Bulk Operations**: Multi-product deadstock processing

### Reporting System Integration
- **Financial Reports**: Deadstock impact on financial statements
- **Inventory Reports**: Separate deadstock inventory tracking
- **Analytics**: Deadstock trends and patterns

## Disposal Workflow

### Disposal Methods
1. **Scrap**: Metal/plastic recycling, value recovery
2. **Donate**: Charitable organizations, tax benefits
3. **Destroy**: Secure destruction for sensitive items
4. **Sell**: Discounted sales to secondary markets
5. **Recycle**: Material-specific recycling processes

### Process Flow
```
Identify Deadstock → Record Disposal Method → Execute Disposal → Update Status → Financial Write-off
```

## Reporting & Analytics

### Key Metrics
- **Deadstock Rate**: Percentage of inventory marked as deadstock
- **Disposal Costs**: Total costs incurred for deadstock disposal
- **Value Impact**: Financial impact of deadstock write-offs
- **Reason Analysis**: Most common deadstock reasons

### Report Types
1. **Deadstock Summary**: Current deadstock by product/category
2. **Disposal Report**: Completed disposal activities
3. **Financial Impact**: Write-off amounts and disposal costs
4. **Trend Analysis**: Deadstock patterns over time

## Success Metrics

### Operational Metrics
- **Processing Time**: Time to mark and process deadstock
- **Accuracy Rate**: Correctness of deadstock identifications
- **Disposal Completion**: Percentage of deadstock properly disposed

### Financial Metrics
- **Write-off Amounts**: Total value written off as deadstock
- **Disposal Costs**: Costs incurred in disposal processes
- **Recovery Value**: Value recovered through recycling/sales

### Inventory Metrics
- **Deadstock Ratio**: Deadstock as percentage of total inventory
- **Turnover Impact**: Effect on inventory turnover calculations
- **Stock Accuracy**: Improvement in inventory accuracy

## Risk Mitigation

### Operational Risks
- **Over-classification**: Products incorrectly marked as deadstock
- **Under-disposal**: Deadstock not properly disposed of
- **Cost Overruns**: Disposal costs exceeding expectations

### Mitigation Strategies
- **Review Processes**: Multi-step approval for deadstock creation
- **Training**: Clear guidelines for deadstock identification
- **Auditing**: Regular review of deadstock classifications

### Technical Risks
- **Data Loss**: Deadstock data corruption or loss
- **Performance Issues**: Large deadstock tables impacting performance
- **Integration Problems**: Conflicts with existing inventory system

## Future Enhancements

### Advanced Features
1. **AI Detection**: Machine learning for automatic deadstock identification
2. **Predictive Analytics**: Forecast potential deadstock items
3. **Supplier Analysis**: Track deadstock by supplier/vendor
4. **Sustainability Tracking**: Environmental impact of disposal methods

### Integration Opportunities
1. **Warehouse Management**: Advanced inventory location tracking
2. **E-commerce**: Online deadstock sales channels
3. **Accounting Integration**: Automatic write-off entries
4. **Compliance Systems**: Regulatory reporting for hazardous materials

## Rollback & Recovery

### Rollback Scenarios
- **Incorrect Deadstock**: Ability to reverse deadstock entries
- **Disposal Errors**: Correction of disposal method records
- **Quantity Adjustments**: Modify deadstock quantities

### Recovery Procedures
- **Data Backup**: Regular backups of deadstock data
- **Audit Trails**: Complete history for reconstruction
- **Manual Processes**: Fallback procedures for critical operations

## Implementation Sequencing

### Recommended Order with Returns
1. **Implement Returns System** (Foundation)
   - Core return processing
   - Inventory adjustment logic
   - Transaction management

2. **Add Deadstock Infrastructure**
   - Database schema
   - Basic API endpoints
   - Product integration

3. **Integrate Returns + Deadstock**
   - Return workflow enhancements
   - Deadstock option in returns
   - Shared business logic

4. **Complete Standalone Features**
   - Direct deadstock marking
   - Disposal management
   - Advanced reporting

This approach ensures returns logic is solid before adding deadstock complexity, while maintaining clean integration between the systems.
