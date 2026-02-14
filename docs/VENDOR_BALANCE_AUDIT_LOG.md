# Vendor Balance Audit Log System

## Overview

Track every atomic update to vendor balance columns (`total_paid`, `total_allocated`, `total_refunded`, `total_refund_allocated`) with a complete audit trail showing:
- What changed (column name)
- How much it changed (delta)
- Before/after values
- Source transaction details
- Timestamp and user

## Business Need

Users need to:
1. **Debug balance discrepancies** - See exactly when and why a balance changed
2. **Audit compliance** - Track all financial changes for regulatory requirements
3. **Historical analysis** - Understand payment/allocation patterns over time
4. **Transparency** - Know which transaction caused each balance update

## Balance Column Update Mapping

### Column 1: `total_paid` (Total Payments Made)

| Operation | Trigger | Amount | Notes |
|-----------|---------|--------|-------|
| Payment CREATE | New vendor payment | +payment_amount | Increases when payment is made |
| Payment EDIT | Payment amount changed | ±amount_diff | Can increase or decrease |
| Payment DELETE | Payment removed | -payment_amount | Reverses the original payment |

### Column 2: `total_allocated` (Payments Allocated to Bills)

| Operation | Trigger | Amount | Notes |
|-----------|---------|--------|-------|
| Purchase CREATE | Unpaid→Paid status | +purchase_total | Bill is marked paid |
| Purchase EDIT | Status change | ±amount | Status transitions (unpaid↔paid) |
| Purchase EDIT | Amount change (paid) | ±amount_diff | Total changes while paid |
| Purchase DELETE | Paid purchase deleted | -allocated_amount | Frees up allocation |
| Payment CREATE | With allocations | +allocated_amount | Payment allocated to bills |
| Payment EDIT | Allocation change | ±allocation_diff | Re-allocation |
| Payment DELETE | With allocations | -allocated_amount | Frees up allocation |

### Column 3: `total_refunded` (Total Refunds Received)

| Operation | Trigger | Amount | Notes |
|-----------|---------|--------|-------|
| Refund CREATE | New vendor refund | +refund_amount | Increases when refund is received |
| Refund EDIT | Refund amount changed | ±amount_diff | Can increase or decrease |
| Refund DELETE | Refund removed | -refund_amount | Reverses the original refund |

### Column 4: `total_refund_allocated` (Refunds Allocated to Returns)

| Operation | Trigger | Amount | Notes |
|-----------|---------|--------|-------|
| Return EDIT | Incomplete→Complete | +return_total | Return is marked complete |
| Return DELETE | Complete return deleted | -allocated_amount | Frees up refund allocation |
| Refund CREATE | With allocations | +allocated_amount | Refund allocated to returns |
| Refund EDIT | Allocation change | ±allocation_diff | Re-allocation |
| Refund DELETE | With allocations | -allocated_amount | Frees up allocation |

## Database Schema

### New Table: `vendor_balance_logs`

```sql
CREATE TABLE vendor_balance_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  
  -- What changed
  column_name ENUM(
    'total_paid',
    'total_allocated', 
    'total_refunded',
    'total_refund_allocated'
  ) NOT NULL,
  
  -- Change details
  change_amount DECIMAL(10,2) NOT NULL,  -- Can be positive (increase) or negative (decrease)
  old_value DECIMAL(10,2) NOT NULL,      -- Value before change
  new_value DECIMAL(10,2) NOT NULL,      -- Value after change
  
  -- Source transaction (what caused this change)
  source_type ENUM(
    'purchase_create',
    'purchase_edit',
    'purchase_delete',
    'return_edit',
    'return_delete',
    'payment_create',
    'payment_edit',
    'payment_delete',
    'refund_create',
    'refund_edit',
    'refund_delete'
  ) NOT NULL,
  source_id INT NOT NULL,                -- Purchase/Return/Payment/Refund ID
  reference_no VARCHAR(50),              -- INV-123, DN-456, Payment #789
  
  -- Audit info
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,                        -- User ID from session
  notes TEXT,                            -- Optional description (e.g., "Marked as paid", "Amount changed from 1000 to 1500")
  
  -- Foreign keys
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  
  -- Indexes for fast queries
  INDEX idx_vendor_date (vendor_id, created_at DESC),
  INDEX idx_column (column_name),
  INDEX idx_source (source_type, source_id)
);
```

### Migration Script

Create file: `scripts/add_vendor_balance_logs.sql`

```sql
-- Create vendor balance audit log table
CREATE TABLE IF NOT EXISTS vendor_balance_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  column_name ENUM('total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated') NOT NULL,
  change_amount DECIMAL(10,2) NOT NULL,
  old_value DECIMAL(10,2) NOT NULL,
  new_value DECIMAL(10,2) NOT NULL,
  source_type ENUM(
    'purchase_create', 'purchase_edit', 'purchase_delete',
    'return_edit', 'return_delete',
    'payment_create', 'payment_edit', 'payment_delete',
    'refund_create', 'refund_edit', 'refund_delete'
  ) NOT NULL,
  source_id INT NOT NULL,
  reference_no VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  notes TEXT,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  INDEX idx_vendor_date (vendor_id, created_at DESC),
  INDEX idx_column (column_name),
  INDEX idx_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Implementation Steps

### Step 1: Update Prisma Schema

Add to `prisma/schema.prisma`:

```prisma
model vendor_balance_logs {
  id            Int       @id @default(autoincrement())
  vendor_id     Int
  column_name   String    // 'total_paid' | 'total_allocated' | 'total_refunded' | 'total_refund_allocated'
  change_amount Decimal   @db.Decimal(10, 2)
  old_value     Decimal   @db.Decimal(10, 2)
  new_value     Decimal   @db.Decimal(10, 2)
  source_type   String    // 'purchase_create' | 'purchase_edit' | etc.
  source_id     Int
  reference_no  String?   @db.VarChar(50)
  created_at    DateTime  @default(now())
  created_by    Int?
  notes         String?   @db.Text
  
  vendor        vendors   @relation(fields: [vendor_id], references: [id], onDelete: Cascade)
  
  @@index([vendor_id, created_at(sort: Desc)], name: "idx_vendor_date")
  @@index([column_name], name: "idx_column")
  @@index([source_type, source_id], name: "idx_source")
}
```

### Step 2: Create Logging Service

Create file: `lib/balance-log-service.ts`

```typescript
import { PrismaClient } from '@prisma/client';

export type BalanceColumn = 'total_paid' | 'total_allocated' | 'total_refunded' | 'total_refund_allocated';

export type SourceType = 
  | 'purchase_create' | 'purchase_edit' | 'purchase_delete'
  | 'return_edit' | 'return_delete'
  | 'payment_create' | 'payment_edit' | 'payment_delete'
  | 'refund_create' | 'refund_edit' | 'refund_delete';

export interface BalanceLogEntry {
  vendor_id: number;
  column_name: BalanceColumn;
  change_amount: number;
  old_value: number;
  new_value: number;
  source_type: SourceType;
  source_id: number;
  reference_no?: string;
  created_by?: number;
  notes?: string;
}

export class BalanceLogService {
  /**
   * Log a balance column change
   * Should be called AFTER the balance update in the same transaction
   */
  static async logChange(
    tx: any,  // Prisma transaction
    entry: BalanceLogEntry
  ): Promise<void> {
    await tx.vendor_balance_logs.create({
      data: {
        vendor_id: entry.vendor_id,
        column_name: entry.column_name,
        change_amount: entry.change_amount,
        old_value: entry.old_value,
        new_value: entry.new_value,
        source_type: entry.source_type,
        source_id: entry.source_id,
        reference_no: entry.reference_no,
        created_by: entry.created_by,
        notes: entry.notes
      }
    });
  }

  /**
   * Log multiple changes at once (for operations that update multiple columns)
   */
  static async logMultipleChanges(
    tx: any,
    entries: BalanceLogEntry[]
  ): Promise<void> {
    await Promise.all(
      entries.map(entry => this.logChange(tx, entry))
    );
  }
}

export const balanceLogService = new BalanceLogService();
```

### Step 3: Update Balance Handler

Modify `lib/balance-handler.ts` to log all changes:

```typescript
// Add at top
import { balanceLogService, BalanceColumn, SourceType } from './balance-log-service';

// Add to BalanceOperation interface
export interface BalanceOperation {
  vendorId: number;
  update: {
    total_paid?: number;
    total_allocated?: number;
    total_refunded?: number;
    total_refund_allocated?: number;
  };
  // NEW: Source info for logging
  source?: {
    type: SourceType;
    id: number;
    reference_no?: string;
    userId?: number;
    notes?: string;
  };
}

// Update incrementBalanceInTransaction method
async incrementBalanceInTransaction(
  tx: any,
  vendorId: number,
  update: BalanceOperation['update'],
  source?: BalanceOperation['source']
): Promise<void> {
  // Get current balance BEFORE update
  const currentBalance = await tx.vendors.findUnique({
    where: { id: vendorId },
    select: {
      total_paid: true,
      total_allocated: true,
      total_refunded: true,
      total_refund_allocated: true
    }
  });

  if (!currentBalance) {
    throw new Error(`Vendor ${vendorId} not found`);
  }

  // Prepare update data
  const updateData: any = {};
  const logEntries: any[] = [];

  // Process each column update
  const columns: Array<{ key: BalanceColumn; value?: number }> = [
    { key: 'total_paid', value: update.total_paid },
    { key: 'total_allocated', value: update.total_allocated },
    { key: 'total_refunded', value: update.total_refunded },
    { key: 'total_refund_allocated', value: update.total_refund_allocated }
  ];

  for (const col of columns) {
    if (col.value !== undefined && col.value !== 0) {
      const oldValue = Number(currentBalance[col.key]);
      const changeAmount = col.value;
      const newValue = oldValue + changeAmount;

      // Update data for vendor table
      updateData[col.key] = { increment: changeAmount };

      // Log entry for audit trail
      if (source) {
        logEntries.push({
          vendor_id: vendorId,
          column_name: col.key,
          change_amount: changeAmount,
          old_value: oldValue,
          new_value: newValue,
          source_type: source.type,
          source_id: source.id,
          reference_no: source.reference_no,
          created_by: source.userId,
          notes: source.notes
        });
      }
    }
  }

  // Execute update
  if (Object.keys(updateData).length > 0) {
    await tx.vendors.update({
      where: { id: vendorId },
      data: updateData
    });

    // Log all changes
    if (logEntries.length > 0) {
      await balanceLogService.logMultipleChanges(tx, logEntries);
    }
  }
}
```

### Step 4: Update Transaction Handler

Modify `lib/transaction-handler.ts` to pass source info:

```typescript
// Example: In executeInTransaction method
if (result.balanceOp) {
  await balanceHandler.incrementBalanceInTransaction(
    tx,
    result.balanceOp.vendorId,
    result.balanceOp.update,
    // NEW: Pass source info
    {
      type: 'purchase_edit',  // Determine from context
      id: purchaseId,
      reference_no: `INV-${invoiceNo}`,
      userId: session?.user?.id,
      notes: 'Status changed from unpaid to paid'
    }
  );
}
```

### Step 5: Create API Endpoint

Create file: `pages/api/reports/vendor-balance-logs.ts`

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      vendor_id,
      column_name,
      source_type,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (vendor_id) {
      where.vendor_id = parseInt(vendor_id as string);
    }

    if (column_name) {
      where.column_name = column_name;
    }

    if (source_type) {
      where.source_type = source_type;
    }

    if (dateFrom && dateTo) {
      where.created_at = {
        gte: new Date(dateFrom as string),
        lte: new Date(dateTo as string)
      };
    }

    // Get logs with vendor info
    const [logs, total] = await Promise.all([
      prisma.vendor_balance_logs.findMany({
        where,
        include: {
          vendor: {
            select: {
              id: true,
              vendor_name: true
            }
          }
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.vendor_balance_logs.count({ where })
    ]);

    // Format response
    const formattedLogs = logs.map(log => ({
      id: log.id,
      vendor_id: log.vendor_id,
      vendor_name: log.vendor.vendor_name,
      column_name: log.column_name,
      change_amount: Number(log.change_amount),
      old_value: Number(log.old_value),
      new_value: Number(log.new_value),
      source_type: log.source_type,
      source_id: log.source_id,
      reference_no: log.reference_no,
      created_at: log.created_at,
      created_by: log.created_by,
      notes: log.notes
    }));

    return res.status(200).json({
      success: true,
      data: formattedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching balance logs:', error);
    return res.status(500).json({
      error: 'Failed to fetch balance logs',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
```

### Step 6: Create UI Report Page

Create file: `pages/reports/vendor-balance-logs.tsx`

```typescript
import { useState, useEffect } from 'react';
import { FileText, TrendingUp, TrendingDown } from 'lucide-react';
import { SearchableSelect } from '../../components/common';

interface BalanceLog {
  id: number;
  vendor_name: string;
  column_name: string;
  change_amount: number;
  old_value: number;
  new_value: number;
  source_type: string;
  reference_no: string;
  created_at: string;
  notes: string;
}

export default function VendorBalanceLogsPage() {
  const [logs, setLogs] = useState<BalanceLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [vendors, setVendors] = useState<any[]>([]);

  // Fetch vendors on mount
  useEffect(() => {
    fetchVendors();
  }, []);

  // Fetch logs when filters change
  useEffect(() => {
    if (selectedVendor) {
      fetchLogs();
    }
  }, [selectedVendor, selectedColumn]);

  const fetchVendors = async () => {
    const response = await fetch('/api/vendors');
    if (response.ok) {
      const data = await response.json();
      setVendors(data.vendors || []);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        vendor_id: selectedVendor,
        ...(selectedColumn && { column_name: selectedColumn })
      });

      const response = await fetch(`/api/reports/vendor-balance-logs?${params}`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data.data);
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getColumnLabel = (column: string) => {
    const labels: Record<string, string> = {
      'total_paid': 'Total Paid',
      'total_allocated': 'Total Allocated',
      'total_refunded': 'Total Refunded',
      'total_refund_allocated': 'Refund Allocated'
    };
    return labels[column] || column;
  };

  const getSourceLabel = (source: string) => {
    return source.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold mb-6">Vendor Balance Audit Log</h1>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Vendor <span className="text-red-400">*</span>
            </label>
            <SearchableSelect
              options={vendors.map(v => ({
                id: v.id.toString(),
                name: v.vendor_name
              }))}
              selectedValue={selectedVendor}
              onSelectionChange={(value) => setSelectedVendor(value || '')}
              placeholder="Select vendor..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Column (Optional)
            </label>
            <select
              value={selectedColumn}
              onChange={(e) => setSelectedColumn(e.target.value)}
              className="input-field"
            >
              <option value="">All Columns</option>
              <option value="total_paid">Total Paid</option>
              <option value="total_allocated">Total Allocated</option>
              <option value="total_refunded">Total Refunded</option>
              <option value="total_refund_allocated">Refund Allocated</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {selectedVendor && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Column</th>
                  <th>Change</th>
                  <th className="text-right">Before</th>
                  <th className="text-right">After</th>
                  <th>Source</th>
                  <th>Reference</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="text-slate-300">
                      {new Date(log.created_at).toLocaleString('en-IN')}
                    </td>
                    <td className="text-slate-300 font-medium">
                      {getColumnLabel(log.column_name)}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {log.change_amount > 0 ? (
                          <>
                            <TrendingUp className="w-4 h-4 text-green-400" />
                            <span className="text-green-400">
                              +₹{Math.abs(log.change_amount).toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <>
                            <TrendingDown className="w-4 h-4 text-red-400" />
                            <span className="text-red-400">
                              -₹{Math.abs(log.change_amount).toFixed(2)}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="text-right text-slate-300">
                      ₹{log.old_value.toFixed(2)}
                    </td>
                    <td className="text-right font-semibold text-white">
                      ₹{log.new_value.toFixed(2)}
                    </td>
                    <td className="text-slate-300">
                      {getSourceLabel(log.source_type)}
                    </td>
                    <td className="font-medium text-white">
                      {log.reference_no || '-'}
                    </td>
                    <td className="text-slate-400 text-sm">
                      {log.notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {logs.length === 0 && !loading && (
              <div className="text-center py-8 text-slate-400">
                No balance changes found for this vendor.
              </div>
            )}
          </div>
        )}

        {!selectedVendor && (
          <div className="text-center py-12 text-slate-400">
            <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Please select a vendor to view balance audit log</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Benefits

1. **Complete Audit Trail**: Every balance change is logged with before/after values
2. **Debugging**: Quickly identify when and why a balance became incorrect
3. **Compliance**: Meet regulatory requirements for financial record keeping
4. **Analysis**: Understand payment and allocation patterns
5. **Transparency**: Users can see exactly what caused each balance update

## Future Enhancements

1. **Auto-reconciliation**: Compare logged changes with current balance to detect discrepancies
2. **Export**: Download audit logs as CSV/Excel
3. **Alerts**: Notify when unusual balance changes occur (e.g., large negative allocation)
4. **Dashboard**: Visualize balance changes over time with charts
5. **User tracking**: Show which user made each change (from session)

## Implementation Timeline

1. **Phase 1** (30 min): Create database table and migration
2. **Phase 2** (1 hour): Update balance-handler to log changes
3. **Phase 3** (1 hour): Update all APIs to pass source info
4. **Phase 4** (1 hour): Create API endpoint and UI report
5. **Phase 5** (30 min): Testing and validation

**Total Estimated Time**: 4 hours
