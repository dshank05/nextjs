# Development Guide Memory Bank

## 🚀 Quick Start Development Workflow

### Initial Setup (3 Steps)
```bash
# 1. Install dependencies
cd nextjs
npm install

# 2. Setup database connection
npm run prisma:generate
npm run prisma:db:push

# 3. Start development server
npm run dev
```

**Success Indicators:**
- ✅ No errors in terminal after `npm run dev`
- ✅ Dashboard loads at http://localhost:3000
- ✅ Statistics show actual data counts
- ✅ Professional dark theme interface

## 🛠️ Essential Development Commands

### Database Commands
```bash
# Generate Prisma client (after schema changes)
npm run prisma:generate

# Sync database schema
npm run prisma:db:push

# Visual database browser
npm run prisma:studio
# Opens at http://localhost:5555

# Pull schema from database
npx prisma db pull

# Reset database (careful!)
npm run prisma:db:push --force-reset
```

### Development Server
```bash
# Start development server
npm run dev
# Runs at http://localhost:3000

# Build for production
npm run build

# Start production build locally
npm start

# Type checking
npm run type-check
```

## 📁 Project Structure Understanding

### Core Architecture
```
nextjs/
├── pages/              # NextJS pages and API routes
│   ├── api/           # Backend API endpoints
│   ├── products/      # Product management pages
│   ├── invoices/      # Invoice management pages
│   └── index.tsx      # Main dashboard
├── components/        # Reusable React components
├── lib/              # Utility functions and database
├── prisma/           # Database schema and migrations
├── styles/           # Global CSS and Tailwind
├── memory-bank/      # Project documentation and context
└── docs/             # Technical documentation
```

### Key Files and Their Purposes
- **`pages/_app.tsx`** - Global app configuration and layout
- **`pages/index.tsx`** - Main dashboard with statistics
- **`components/Layout.tsx`** - Common layout with navigation
- **`lib/db.ts`** - Database connection utility
- **`prisma/schema.prisma`** - Database schema definition
- **`styles/globals.css`** - Global styles and Tailwind CSS

## 🎨 UI and Styling System

### Tailwind CSS Configuration
- **Theme**: Dark theme as default
- **Colors**: Professional color palette
- **Responsive**: Mobile-first approach
- **Components**: Consistent styling patterns

### Component Development Patterns
```typescript
// Standard component structure
import { useState, useEffect } from 'react'
import Layout from '../components/Layout'

export default function PageName() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch data from API
  }, [])

  return (
    <Layout title="Page Title">
      {/* Page content */}
    </Layout>
  )
}
```

## 🔌 API Development Patterns

### API Route Structure
```typescript
// pages/api/endpoint.ts
import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    try {
      const data = await prisma.table.findMany()
      res.status(200).json(data)
    } catch (error) {
      res.status(500).json({ error: 'Database error' })
    }
  } else {
    res.setHeader('Allow', ['GET'])
    res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}
```

### Enhanced API Pattern (with Business Logic)
```typescript
// Enhanced API with rate calculations
const products = await prisma.product.findMany({
  take: limit,
  skip: offset
})

// Add latest purchase rates
const enhancedProducts = await Promise.all(
  products.map(async (product) => {
    // Get latest purchase rate
    const latestPurchase = await prisma.purchaseitems.findFirst({
      where: { name_of_product: product.id.toString() },
      orderBy: { invoice_date: 'desc' }
    })

    // Get category name
    const category = await prisma.product_category.findFirst({
      where: { id: parseInt(product.product_category) }
    })

    return {
      ...product,
      displayRate: latestPurchase?.rate || product.rate || 0,
      categoryName: category?.category_name || product.product_category
    }
  })
)
```

## 📊 Data Fetching Patterns

### Client-Side Data Fetching
```typescript
// Standard data fetching with loading states
const [data, setData] = useState([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState(null)

useEffect(() => {
  fetch('/api/endpoint')
    .then(res => res.json())
    .then(data => {
      setData(data)
      setLoading(false)
    })
    .catch(err => {
      setError(err.message)
      setLoading(false)
    })
}, [])
```

### Pagination Implementation
```typescript
const [currentPage, setCurrentPage] = useState(1)
const [totalPages, setTotalPages] = useState(1)
const itemsPerPage = 50

const fetchData = async (page: number) => {
  const offset = (page - 1) * itemsPerPage
  const response = await fetch(
    `/api/products?limit=${itemsPerPage}&offset=${offset}`
  )
  const data = await response.json()
  return data
}
```

## 🎯 Business Logic Implementation

### Rate Calculation Integration
```typescript
// Implement Latest Purchase Rate logic in components
const calculateDisplayRate = (product: any, latestPurchaseRate?: number) => {
  return latestPurchaseRate || product.rate || 0
}

// Stock status calculation
const getStockStatus = (stock: number, minStock: number) => {
  if (stock === 0) return { status: 'Out of Stock', color: 'red', icon: '🚨' }
  if (stock < 2 || stock < minStock) return { status: 'Low Stock', color: 'orange', icon: '⚠️' }
  return { status: 'In Stock', color: 'green', icon: '✅' }
}
```

### Form Handling Patterns
```typescript
import { useForm } from 'react-hook-form'

type FormData = {
  productName: string
  rate: number
  stock: number
}

export default function ProductForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>()

  const onSubmit = async (data: FormData) => {
    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      // Handle response
    } catch (error) {
      console.error('Submission error:', error)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields with validation */}
    </form>
  )
}
```

## 🔍 Debugging and Development Tools

### Prisma Studio Usage
```bash
npm run prisma:studio
```
**Perfect for:**
- Exploring database structure (29 tables)
- Understanding data relationships
- Testing data modifications
- Debugging rate calculations
- Viewing actual production data

### Browser DevTools Best Practices
- **Network Tab**: Monitor API response times
- **Console Tab**: Check for JavaScript errors
- **React DevTools**: Inspect component state
- **Performance Tab**: Profile rendering performance

### Logging Strategies
```typescript
// Development logging
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info:', data)
}

// API error logging
catch (error) {
  console.error('API Error:', error)
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  })
}
```

## 🧪 Testing Strategies

### Manual Testing Checklist
- ✅ **Dashboard loads** with real statistics
- ✅ **Product list** shows correct rates (latest purchase rates)
- ✅ **Category names** display (not just IDs)
- ✅ **Stock status** indicators work correctly
- ✅ **Pagination** works with 4,111+ products
- ✅ **API responses** return expected data structure

### Database Testing
```typescript
// Test rate calculations
const testProduct = await prisma.product.findFirst()
const latestRate = await prisma.purchaseitems.findFirst({
  where: { name_of_product: testProduct.id.toString() },
  orderBy: { invoice_date: 'desc' }
})
console.log('Expected rate:', latestRate?.rate || testProduct.rate)
```

## 🎨 Styling and Design System

### Tailwind CSS Patterns
```typescript
// Consistent component styling
const cardClass = "bg-gray-800 p-6 rounded-lg shadow-lg"
const buttonClass = "bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
const inputClass = "bg-gray-700 border border-gray-600 text-white p-2 rounded"
```

### Responsive Design Patterns
```jsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Responsive grid layout */}
</div>
```

## 🔧 Environment Configuration

### Environment Variables
- **`.env.local`** - Local development (never commit)
- **`.env.example`** - Template with placeholder values
- **`.env`** - Active environment file (git ignored)

### Configuration Best Practices
```typescript
// Access environment variables safely
const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  throw new Error('DATABASE_URL environment variable is required')
}
```

## 📈 Performance Optimization

### Database Query Optimization
```typescript
// Efficient pagination
const products = await prisma.product.findMany({
  take: limit,
  skip: offset,
  orderBy: { id: 'asc' } // Consistent ordering for pagination
})

// Batch related data fetching
const [categories, companies] = await Promise.all([
  prisma.product_category.findMany(),
  prisma.product_company.findMany()
])
```

### Caching Strategies
```typescript
// Simple in-memory caching for reference data
let categoriesCache: any[] = []
let cacheExpiry = 0

const getCategories = async () => {
  if (Date.now() > cacheExpiry) {
    categoriesCache = await prisma.product_category.findMany()
    cacheExpiry = Date.now() + 5 * 60 * 1000 // 5 minutes
  }
  return categoriesCache
}
```

## 🐛 Common Issues and Solutions

### Database Connection Issues
```bash
# If connection fails, try alternative hostname
DATABASE_URL="mysql://user:pass@193.203.184.29:3306/database"

# Or disable SSL
DATABASE_URL="mysql://user:pass@host:3306/database?sslmode=DISABLED"
```

### TypeScript Errors
```typescript
// Handle Prisma type safety
type ProductWithRate = {
  id: number
  product_name: string
  displayRate: number
  // ... other fields
}

const products: ProductWithRate[] = enhancedProducts
```

### Performance Issues
- **Large datasets**: Implement proper pagination
- **Slow queries**: Add database indexes
- **Memory usage**: Optimize data fetching patterns

## 🎯 Best Practices Summary

### Code Quality
- **TypeScript**: Use strict typing throughout
- **Error Handling**: Implement comprehensive error boundaries
- **Validation**: Validate all user inputs and API parameters
- **Logging**: Log important operations and errors

### Performance
- **Pagination**: Always paginate large datasets
- **Caching**: Cache frequently accessed reference data
- **Database**: Optimize queries and use proper indexes
- **Bundle Size**: Monitor and optimize client-side bundle

### Security
- **Environment Variables**: Never commit sensitive data
- **Input Validation**: Sanitize all user inputs
- **API Security**: Implement proper authentication when needed
- **SQL Injection**: Use Prisma's query builder (never raw SQL with user input)

### Development Workflow
- **Git**: Use meaningful commit messages and branch names
- **Testing**: Test critical business logic thoroughly
- **Documentation**: Keep memory bank updated with changes
- **Code Review**: Review business logic changes carefully
