# QR Code Integration Guide

## Table of Contents
1. [Overview](#overview)
2. [Tally QR Code Format Discovery](#tally-qr-code-format-discovery)
3. [Database Changes](#database-changes)
4. [NPM Dependencies](#npm-dependencies)
5. [API Implementation](#api-implementation)
6. [UI Components](#ui-components)
7. [Page Modifications](#page-modifications)
8. [Testing & Verification](#testing--verification)
9. [Migration Guide](#migration-guide)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### What is This System?

This QR code system allows you to:
- Store QR code values from Tally in your product database
- Scan products using a barcode scanner to quickly add them to Purchase/Sale/Invoice forms
- Display and print QR codes for products
- Maintain consistency between Tally and your system

### How It Works

```
Tally System
    ↓
Generates QR Code (e.g., "PROD-12345")
    ↓
You manually enter this value in your system
    ↓
Scanner reads QR code → Looks up product → Adds to form
```

### Key Concepts

- **QR codes are deterministic**: Same text = same QR image
- **QR codes are optional**: Products can exist without them
- **Scanner is toggle-based**: Enable when needed, disable when done
- **Works with existing workflows**: Manual selection still available

---

## Tally QR Code Format Discovery

### Step 1: Check Existing Tally QR Codes

1. **Open Tally** and navigate to a product with QR code
2. **View the QR code** label or print a sample
3. **Use a QR scanner app** on your phone to read the code
4. **Note the format** - this is what you'll enter in your system

### Step 2: Common Tally QR Formats

Tally typically uses one of these formats:

```
Format 1: Simple ID
Example: "12345"

Format 2: Prefixed ID
Example: "PROD-12345"

Format 3: Stock Code
Example: "STK-ABC-001"

Format 4: Part Number
Example: "PART-12345"

Format 5: Custom Format
Example: "COMPANY-PROD-12345"
```

### Step 3: Test and Verify

1. Scan a Tally QR code with your phone
2. Note the exact text value
3. This is what you'll enter in the "QR Code" field
4. Keep format consistent across all products

### Example Discovery Process

```
1. Print label from Tally
2. Scan with phone QR reader app
3. Phone displays: "STK-WIDGET-001"
4. This is your format! Use for all products
```

---

## Database Changes

### File: `prisma/schema.prisma`

**Location:** In the `Product` model, after existing fields

**Change Type:** ADD

```prisma
model Product {
  id                     Int       @id @default(autoincrement())
  product_name           String
  // ... other existing fields ...
  
  // ADD THIS LINE:
  qr_code                String?   @unique
  
  // ... rest of fields ...
}
```

**Full Context:**
```prisma
model Product {
  id                     Int                  @id @default(autoincrement())
  product_name           String               @db.VarChar(255)
  display_name           String?              @db.VarChar(255)
  hsn                    String?              @db.VarChar(50)
  product_category_id    Int?
  product_subcategory_id Int?
  car_model_ids          String?
  pic                    String?              @db.VarChar(255)
  part_no                String?              @db.VarChar(100)
  min_stock              Int?
  stock                  Int?
  opening_rate           Float?
  notes                  String?              @db.VarChar(255)
  warehouse_id           Int?
  gst_rate_id            Int?
  opening_stock          Int?
  is_active              Boolean              @default(true)
  descriptions           String?              @db.Text
  discount               Float?
  margin                 Float?
  mrp                    Float?
  rack_number            String?              @db.VarChar(100)
  rack_id                Int?
  company_id             Int?
  last_purchase_date     Int?
  latest_purchase_rate   Float?
  qr_code                String?              @unique  // ← ADD THIS
  
  // ... relations ...
}
```

**Migration Command:**
```bash
npx prisma db push
```

**Expected Output:**
```
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": MySQL database at "your-database"

Your database is now in sync with your Prisma schema. Done in X.XXs
```

---

## NPM Dependencies

### Required Packages

**File: `package.json`**

```bash
npm install react-qr-code html-to-image
```

**Packages:**
- `react-qr-code@^2.0.12` - Display QR codes in React
- `html-to-image@^1.11.11` - Convert QR to downloadable PNG

**Add to package.json dependencies:**
```json
{
  "dependencies": {
    "react-qr-code": "^2.0.12",
    "html-to-image": "^1.11.11"
  }
}
```

---

## API Implementation

### File: `pages/api/products/by-qr.ts` (NEW FILE)

**Purpose:** Lookup product by QR code

**Location:** Create new file at `pages/api/products/by-qr.ts`

**Full Code:**

```typescript
import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const { code } = req.query

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ 
        message: 'QR code parameter is required' 
      })
    }

    // Lookup product by QR code
    const product = await prisma.product.findUnique({
      where: {
        qr_code: code.trim()
      },
      include: {
        category_ref: true,
        subcategory_ref: true,
        product_company_ref: true,
        gst_rate: true
      }
    })

    if (!product) {
      return res.status(404).json({ 
        message: 'Product not found',
        qr_code: code 
      })
    }

    // Check if product is active
    if (!product.is_active) {
      return res.status(400).json({ 
        message: 'Product is inactive',
        product_name: product.product_name 
      })
    }

    res.status(200).json(product)
  } catch (error) {
    console.error('QR code lookup error:', error)
    res.status(500).json({
      message: 'Failed to lookup product',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
```

**API Usage:**
```
GET /api/products/by-qr?code=PROD-12345

Success Response (200):
{
  id: 1,
  product_name: "Widget A",
  qr_code: "PROD-12345",
  mrp: 100,
  // ... other product fields
}

Error Response (404):
{
  message: "Product not found",
  qr_code: "PROD-12345"
}
```

---

## UI Components

### Component 1: QR Scanner Hook

**File: `hooks/useQRScanner.ts`** (NEW FILE)

**Purpose:** Reusable hook for QR scanner functionality

```typescript
import { useState, useEffect, useCallback } from 'react'

interface UseQRScannerOptions {
  onScan: (qrCode: string) => void
  enabled: boolean
}

export function useQRScanner({ onScan, enabled }: UseQRScannerOptions) {
  const [lastScanned, setLastScanned] = useState<string>('')

  useEffect(() => {
    if (!enabled) return

    let scanBuffer = ''
    let scanTimeout: NodeJS.Timeout

    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if typing in input fields
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Scanner sends Enter after code
      if (e.key === 'Enter') {
        if (scanBuffer.length > 0) {
          setLastScanned(scanBuffer)
          onScan(scanBuffer)
          scanBuffer = ''
        }
      } else {
        // Build up scan buffer
        scanBuffer += e.key
        
        // Reset buffer if typing too slow (not a scanner)
        clearTimeout(scanTimeout)
        scanTimeout = setTimeout(() => {
          scanBuffer = ''
        }, 100)
      }
    }

    window.addEventListener('keypress', handleKeyPress)
    
    return () => {
      window.removeEventListener('keypress', handleKeyPress)
      clearTimeout(scanTimeout)
    }
  }, [enabled, onScan])

  return { lastScanned }
}
```

### Component 2: QR Scanner Toggle

**File: `components/QRScannerToggle.tsx`** (NEW FILE)

**Purpose:** UI component for scanner toggle button

```typescript
import { useState } from 'react'

interface QRScannerToggleProps {
  enabled: boolean
  onToggle: () => void
  lastScanned?: string
}

export function QRScannerToggle({ enabled, onToggle, lastScanned }: QRScannerToggleProps) {
  return (
    <div className="mb-4 p-4 bg-slate-800 border border-slate-700 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${enabled ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm font-medium text-slate-300">
            QR Scanner: {enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <button
          onClick={onToggle}
          className={`px-4 py-2 rounded font-medium ${
            enabled
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {enabled ? 'Disable Scanner' : 'Enable Scanner'}
        </button>
      </div>
      {enabled && lastScanned && (
        <div className="mt-2 text-xs text-slate-400">
          Last scanned: <span className="font-mono text-blue-400">{lastScanned}</span>
        </div>
      )}
      {enabled && (
        <div className="mt-2 text-xs text-slate-400">
          ℹ️ Ready to scan... Point scanner at QR code
        </div>
      )}
    </div>
  )
}
```

### Component 3: QR Code Display

**File: `components/QRCodeDisplay.tsx`** (NEW FILE)

**Purpose:** Display QR code with download option

```typescript
import QRCode from 'react-qr-code'
import { toPng } from 'html-to-image'

interface QRCodeDisplayProps {
  value: string
  productName: string
  size?: number
  showDownload?: boolean
}

export function QRCodeDisplay({ 
  value, 
  productName, 
  size = 256,
  showDownload = true 
}: QRCodeDisplayProps) {
  const handleDownload = async () => {
    const element = document.getElementById(`qr-${value}`)
    if (!element) return

    try {
      const dataUrl = await toPng(element, {
        quality: 1.0,
        pixelRatio: 3,
        width: 1024,
        height: 1024,
        backgroundColor: '#ffffff'
      })

      const link = document.createElement('a')
      link.download = `QR-${productName.replace(/[^a-z0-9]/gi, '-')}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('Error downloading QR code:', error)
    }
  }

  return (
    <div className="space-y-4">
      <div 
        id={`qr-${value}`}
        className="bg-white p-4 rounded-lg inline-block"
        style={{ width: size + 32, height: size + 32 }}
      >
        <QRCode
          value={value}
          size={size}
          level="H"
          style={{ height: "auto", maxWidth: "100%", width: "100%" }}
        />
      </div>
      
      {showDownload && (
        <button
          onClick={handleDownload}
          className="btn-secondary text-sm"
        >
          📥 Download PNG
        </button>
      )}
    </div>
  )
}
```

---

## Page Modifications

### Page 1: Product Create/Edit

**File: `pages/products/create.tsx`**

**Change Type:** MODIFY - Add QR code input field

**Location:** After "Part No" field (around line 250)

**Add Import:**
```typescript
import QRCode from 'react-qr-code'
```

**Add to Form:**
```tsx
{/* QR Code Field - ADD THIS SECTION */}
<div className="mb-6">
  <label className="block text-sm font-medium text-slate-300 mb-2">
    QR Code (from Tally)
  </label>
  <input
    type="text"
    value={formData.qr_code || ''}
    onChange={(e) => setFormData(prev => ({ 
      ...prev, 
      qr_code: e.target.value.trim() || null 
    }))}
    className="input w-full"
    placeholder="Enter QR code from Tally (optional)"
  />
  <p className="text-xs text-slate-400 mt-1">
    Copy the QR code value from Tally and paste here. Leave blank if product has no QR code.
  </p>
</div>

{/* QR Code Preview - ADD THIS SECTION */}
{formData.qr_code && (
  <div className="mb-6 p-4 bg-slate-700 border border-slate-600 rounded-lg">
    <p className="text-sm font-medium text-slate-300 mb-3">QR Code Preview:</p>
    <div className="bg-white p-3 rounded inline-block">
      <QRCode
        value={formData.qr_code}
        size={128}
        level="H"
      />
    </div>
    <p className="text-xs text-slate-400 mt-2">
      This QR code will match Tally's QR code for: <span className="font-mono text-blue-400">{formData.qr_code}</span>
    </p>
  </div>
)}
```

### Page 2: Purchase Create

**File: `pages/purchases/create.tsx`**

**Change Type:** MODIFY - Add scanner integration

**Add Imports:**
```typescript
import { useState } from 'react'
import { useQRScanner } from '../../hooks/useQRScanner'
import { QRScannerToggle } from '../../components/QRScannerToggle'
import { useSnackbar } from '../../components/SnackbarProvider'
```

**Add State:**
```typescript
const [scannerEnabled, setScannerEnabled] = useState(false)
const { showSnackbar } = useSnackbar()
```

**Add Scanner Logic:**
```typescript
// Handle scanned QR code
const handleQRScan = async (qrCode: string) => {
  try {
    const response = await fetch(`/api/products/by-qr?code=${encodeURIComponent(qrCode)}`)
    
    if (response.ok) {
      const product = await response.json()
      
      // Check if product already in list
      const existingIndex = products.findIndex(p => p.product_id === product.id)
      
      if (existingIndex >= 0) {
        // Increment quantity
        const updatedProducts = [...products]
        updatedProducts[existingIndex].qty += 1
        setProducts(updatedProducts)
        showSnackbar('success', `Quantity updated: ${product.product_name}`)
      } else {
        // Add new product
        const newProduct = {
          product_id: product.id,
          name_of_product: product.product_name,
          category_id: product.product_category_id,
          subcategory_id: product.product_subcategory_id,
          company_id: product.company_id,
          hsn: product.hsn,
          part: product.part_no,
          qty: 1,
          rate: 0, // User will enter rate
          subtotal: 0,
          gst_percentage: product.gst_rate?.rate || 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          tax: 0
        }
        setProducts([...products, newProduct])
        showSnackbar('success', `Added: ${product.product_name}`)
      }
    } else {
      const error = await response.json()
      showSnackbar('error', error.message || `Product not found: ${qrCode}`)
    }
  } catch (error) {
    console.error('QR scan error:', error)
    showSnackbar('error', 'Failed to scan QR code')
  }
}

// Use scanner hook
const { lastScanned } = useQRScanner({
  onScan: handleQRScan,
  enabled: scannerEnabled
})
```

**Add to UI (before product selection panel):**
```tsx
{/* QR Scanner Toggle - ADD THIS */}
<QRScannerToggle
  enabled={scannerEnabled}
  onToggle={() => setScannerEnabled(!scannerEnabled)}
  lastScanned={lastScanned}
/>

{/* Existing Product Selection Panel */}
<ProductSelectionPanel
  // ... existing props
/>
```

### Page 3: Sale Create

**File: `pages/sale/create.tsx`**

**Change Type:** MODIFY - Add scanner integration

**Same implementation as Purchase Create** - Add the same imports, state, and scanner logic shown above.

### Page 4: Invoice Create (Salex)

**File: `pages/salex/create.tsx`**

**Change Type:** MODIFY - Add scanner integration

**Same implementation as Purchase Create** - Add the same imports, state, and scanner logic shown above.

---

## Testing & Verification

### Test 1: Database Migration

```bash
# Run migration
npx prisma db push

# Verify column exists
# Check your database tool or run:
npx prisma studio
# Navigate to Product table, verify qr_code column exists
```

### Test 2: API Endpoint

```bash
# Method 1: Browser
http://localhost:3000/api/products/by-qr?code=TEST-123

# Method 2: cURL
curl http://localhost:3000/api/products/by-qr?code=TEST-123

# Expected: 404 if no product has this QR code
# Expected: 200 with product data if exists
```

### Test 3: Product Creation

1. Go to Products → Create Product
2. Fill in basic details
3. Enter QR code value: `TEST-12345`
4. Verify QR preview appears
5. Save product
6. Check database - qr_code field should have value

### Test 4: QR Scanner

1. Go to Purchase Create page
2. Click "Enable Scanner"
3. Indicator should turn 🟢 GREEN
4. Type a QR code value manually + press Enter
5. Product should be added to table
6. Success toast should appear

### Test 5: Actual Scanner Hardware

1. Print a test QR code with value matching a product
2. Enable scanner on Purchase/Sale page
3. Scan the QR code with barcode scanner
4. Product should automatically add
5. Scan again - quantity should increment

---

## Migration Guide

### For Existing Products

**Option 1: Manual Entry**
```
1. Open each product in Tally
2. Note the QR code value
3. Edit product in your system
4. Enter QR code value
5. Save product
```

**Option 2: Bulk Import (if you have CSV)**
```sql
-- If you have CSV with product_id and qr_code
UPDATE product 
SET qr_code = 'VALUE_FROM_CSV'
WHERE id = PRODUCT_ID;
```

**Option 3: Leave Blank**
```
- Products without QR codes work fine
- Add QR codes gradually as needed
- No rush to update all products
```

### Rollback Procedure

If you need to remove QR functionality:

```bash
# 1. Remove qr_code field from schema
# Edit prisma/schema.prisma and remove:
# qr_code  String?  @unique

# 2. Push changes
npx prisma db push

# 3. Remove QR components (optional)
# Delete: hooks/useQRScanner.ts
# Delete: components/QRScannerToggle.tsx
# Delete: components/QRCodeDisplay.tsx
# Delete: pages/api/products/by-qr.ts

# 4. Remove QR UI from pages
# Remove scanner toggle from purchase/sale pages
```

---

## Troubleshooting

### Issue 1: Scanner Not Working

**Symptoms:** Scanner enabled but nothing happens when scanning

**Solutions:**
1. **Check scanner mode**: Ensure scanner is in "keyboard emulation" mode
2. **Test scanner**: Scan into a text editor - should type the QR value
3. **Check focus**: Scanner needs window to be focused
4. **Verify settings**: Scanner should send "Enter" after code

### Issue 2: Product Not Found

**Symptoms:** Scan successful but "Product not found" error

**Solutions:**
1. **Check QR value**: Scan with phone app, verify exact text
2. **Check database**: Verify product.qr_code matches scanned value
3. **Case sensitive**: Ensure exact match (PROD-123 ≠ prod-123)
4. **Whitespace**: Check for extra spaces in database value

### Issue 3: Duplicate QR Codes

**Symptoms:** Error when saving product - "QR code already exists"

**Solutions:**
```sql
-- Find duplicate QR codes
SELECT qr_code, COUNT(*) 
FROM product 
WHERE qr_code IS NOT NULL
GROUP BY qr_code 
HAVING COUNT(*) > 1;

-- Remove duplicates (keep first, remove rest)
-- Manual decision needed - which product should keep the QR code?
```

### Issue 4: QR Code Not Displaying

**Symptoms:** QR preview not showing on product page

**Solutions:**
1. **Check library**: Ensure `react-qr-code` is installed
2. **Check value**: QR code field must have a value
3. **Check console**: Look for JavaScript errors
4. **Refresh page**: Clear cache and refresh

### Issue 5: Scanner Interferes with Typing

**Symptoms:** Scanner captures keystrokes from input fields

**Solutions:**
- **By design**: Scanner checks if typing in input field
- **Verify code**: Check `useQRScanner` hook has input detection
- **Disable scanner**: Turn off scanner when entering data

### Issue 6: Scanned Product Has No Stock

**Symptoms:** Product adds but shows stock issues

**Solutions:**
```typescript
// Add stock check to handleQRScan
if (product.stock <= 0) {
  showSnackbar('warning', `${product.product_name} has no stock`)
}
```

---

## Best Practices

### 1. QR Code Format
- **Use consistent format** across all products
- **Keep it simple**: Shorter codes scan faster
- **Include prefix**: PROD-, STK-, PART- helps identification
- **Avoid special characters**: Stick to A-Z, 0-9, dash, underscore

### 2. Scanner Usage
- **Enable only when needed**: Prevents accidental scans
- **Disable before typing**: Avoids interference
- **Visual feedback**: Keep indicator visible
- **Test regularly**: Verify scanner works

### 3. Data Entry
- **Copy exact value** from Tally - no typos
- **Verify with scan**: Test with phone app
- **Document format**: Note format in team docs
- **Train staff**: Show how to enter QR codes

### 4. Maintenance
- **Keep QR codes updated**: If changed in Tally, update system
- **Regular audits**: Check for missing/incorrect QR codes
- **Monitor errors**: Log failed scans for investigation
- **Backup regularly**: QR codes are valuable data

---

## Summary Checklist

Before going live, verify:

- [ ] Database has `qr_code` field
- [ ] NPM packages installed (`react-qr-code`, `html-to-image`)
- [ ] API endpoint `/api/products/by-qr` works
- [ ] Products have QR codes entered
- [ ] Scanner toggles on Purchase page
- [ ] Scanner toggles on Sale page
- [ ] Scanner toggles on Invoice page
- [ ] Scanner detects QR codes correctly
- [ ] Products add to table when scanned
- [ ] Toast notifications appear
- [ ] Scanner disables when needed
- [ ] QR code preview shows on product page
- [ ] Tested with actual scanner hardware
- [ ] Team trained on QR code entry
- [ ] Documented Tally QR format

---

## Support

For issues or questions:
1. Check this documentation
2. Test with browser DevTools console
3. Verify QR code value matches exactly
4. Test scanner in text editor first
5. Check database for QR code value

**Version:** 1.0  
**Last Updated:** 2025-01-28  
**Author:** System Implementation Team
