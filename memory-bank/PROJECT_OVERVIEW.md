# Project Memory Bank - Baijnath Sons Inventory System

## 🎯 Project Mission
Replace legacy Yii2 PHP inventory management system with modern NextJS application while maintaining 100% functional compatibility and improving performance.

## 📋 System Context

### Current State
- **Legacy System**: Yii2 PHP application for Baijnath Sons (auto parts inventory)
- **Database**: Hostinger MySQL with 29 tables and 4,111+ products
- **Production URL**: Hosted on Hostinger with existing customer data
- **Critical Business Functions**: Products, Invoices, Purchases, Customers, Vendors, GST calculations

### Target State
- **Modern Stack**: NextJS 13+ with TypeScript, Tailwind CSS, Prisma ORM
- **Performance**: Significantly faster than legacy PHP system
- **User Experience**: Professional dark theme dashboard with responsive design
- **Compatibility**: 100% business logic compatibility with legacy system

## 🏗️ System Architecture

### Technology Stack
- **Frontend**: NextJS 13+, React, TypeScript
- **Styling**: Tailwind CSS (dark theme)
- **Database**: MySQL (Hostinger production database)
- **ORM**: Prisma for type-safe database access
- **Forms**: React Hook Form for efficient form handling
- **PDF**: jsPDF for invoice generation

### Core Dependencies
```json
{
  "next": "latest",
  "react": "latest", 
  "typescript": "latest",
  "@prisma/client": "latest",
  "mysql2": "latest",
  "tailwindcss": "latest",
  "jspdf": "latest",
  "react-hook-form": "latest"
}
```

## 📊 Business Entities

### Primary Data Models
1. **Product** - Auto parts with stock tracking, categories, companies
2. **Invoice** - Sales transactions with GST calculations
3. **InvoiceItems** - Line items for each invoice
4. **Purchase** - Purchase orders from vendors
5. **PurchaseItems** - Items purchased in each order
6. **Customer** - Customer details with billing/shipping addresses
7. **Vendor** - Supplier information for purchases

### Key Relationships
- Products ↔ Categories (product_category table)
- Products ↔ Companies (product_company table)
- Products ↔ Purchase Items (for latest rate calculation)
- Invoices ↔ Invoice Items (one-to-many)
- Purchases ↔ Purchase Items (one-to-many)

## 🎯 Core Features Implemented

### ✅ Completed Features
- Professional dark theme dashboard
- Real-time statistics display
- Product management API
- Database integration with existing Hostinger MySQL
- Responsive design (desktop/tablet/mobile)
- TypeScript implementation for error-free development
- Prisma ORM integration

### 🔄 In Development
- Invoice management system
- Purchase order management
- Customer and vendor management
- PDF generation for invoices
- Advanced reporting features

### 📋 Planned Features
- Low stock alerts and automated reordering
- Advanced analytics and reporting
- Multi-user access controls
- Mobile-first responsive enhancements
- API integration for external systems

## 🏃‍♂️ Quick Start Status

### Current Setup State
- ✅ Project structure created
- ✅ Dependencies installed
- ✅ Database connection configured (Hostinger)
- ✅ Prisma schema matching existing database
- ✅ Environment variables configured
- ✅ Basic dashboard functional

### Ready-to-Run Status
The system is **completely configured** and ready to run in 3 commands:
1. `cd nextjs && npm install`
2. `npm run prisma:generate && npm run prisma:db:push`
3. `npm run dev`

## 🎊 Success Indicators
When properly running, you should see:
- ✅ No errors in terminal after `npm run dev`
- ✅ Dashboard loads at http://localhost:3000
- ✅ Statistics show actual data counts from production database
- ✅ Professional dark theme interface
- ✅ Real-time data from existing Hostinger MySQL database

## 📈 Performance Expectations
- **Loading Speed**: Significantly faster than legacy PHP system
- **Database Queries**: Optimized with Prisma ORM
- **UI Responsiveness**: Modern React-based interface
- **Mobile Performance**: Responsive design for all devices

## 🔧 Development Workflow
1. **Local Development**: Connect to remote Hostinger database
2. **Code Changes**: Use TypeScript for type safety
3. **Database Changes**: Use Prisma migrations
4. **Testing**: Prisma Studio for database exploration
5. **Deployment**: Production-ready for Hostinger hosting

## 📚 Documentation Structure
- `PROJECT_OVERVIEW.md` - This file (high-level project context)
- `BUSINESS_LOGIC.md` - Detailed business rules and calculations
- `DATABASE_INFO.md` - Database structure and connection details
- `DEVELOPMENT_GUIDE.md` - Development workflows and best practices
- `DEPLOYMENT_GUIDE.md` - Production deployment instructions
