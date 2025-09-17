# Baijnath Sons Inventory Management System

A modern NextJS application replacing the legacy Yii2 PHP system for comprehensive inventory management of auto parts business.

## Features

- **Product Management**: Complete CRUD operations for products with categories, subcategories, and companies
- **Invoice Management**: Sales invoice creation with GST calculations and PDF generation
- **Purchase Management**: Purchase order management with automatic stock updates
- **Customer/Vendor Management**: Complete contact management system
- **Dashboard**: Real-time statistics and low stock alerts
- **Responsive Design**: Dark theme professional interface
- **Role-based Access**: Admin, Manager, and Cashier roles

## Technology Stack

- **Frontend**: NextJS 14, React 18, TypeScript
- **Backend**: NextJS API Routes
- **Database**: MySQL with Prisma ORM
- **Styling**: Tailwind CSS with custom dark theme
- **PDF Generation**: jsPDF for invoice printing

## Quick Start

### Prerequisites

- Node.js 18+ 
- MySQL database (local or remote via Hostinger)
- npm or yarn package manager

### 1. Installation

```bash
cd nextjs
npm install
```

### 2. Database Setup

Choose one of the database setup options from `../DATABASE_SETUP.md`:

**Option A: Connect to Remote Database (Hostinger)**
```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local and add your Hostinger MySQL host
# DATABASE_URL="mysql://u348217822_baij_fq87p:8rQm~O-;94Yf@[HOSTINGER_MYSQL_HOST]:3306/u348217822_baij_mc8qp"
```

**Option B: Local Database**
```bash
# Create local database
mysql -u root -p
CREATE DATABASE baijnath_inventory;

# Configure .env.local
DATABASE_URL="mysql://root:your_password@localhost:3306/baijnath_inventory"
```

### 3. Database Schema Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Push schema to database (creates tables)
npm run prisma:db:push

# Optional: Open Prisma Studio to view data
npm run prisma:studio
```

### 4. Start Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the application.

## Project Structure

```
nextjs/
├── components/          # React components
│   └── Layout.tsx      # Main layout with sidebar navigation
├── pages/              # NextJS pages and API routes
│   ├── api/            # Backend API endpoints
│   │   ├── dashboard/  # Dashboard statistics
│   │   └── products/   # Product management APIs
│   ├── _app.tsx        # App wrapper
│   └── index.tsx       # Dashboard page
├── lib/                # Utility libraries
│   └── db.ts          # Prisma database client
├── prisma/             # Database schema and migrations
│   └── schema.prisma   # Database schema definition
├── styles/             # CSS styles
│   └── globals.css     # Global styles with Tailwind
└── public/             # Static assets
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:db:push` - Push schema to database
- `npm run prisma:db:pull` - Pull schema from database
- `npm run prisma:studio` - Open Prisma Studio

## API Endpoints

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

### Products
- `GET /api/products` - List products (with pagination, search, filters)
- `POST /api/products` - Create new product
- `GET /api/products/[id]` - Get product details
- `PUT /api/products/[id]` - Update product
- `DELETE /api/products/[id]` - Delete product

### Invoices
- `GET /api/invoices` - List invoices
- `POST /api/invoices` - Create new invoice
- `GET /api/invoices/[id]` - Get invoice details
- `PUT /api/invoices/[id]` - Update invoice
- `DELETE /api/invoices/[id]` - Delete invoice

### Purchases
- `GET /api/purchases` - List purchases
- `POST /api/purchases` - Create new purchase
- `GET /api/purchases/[id]` - Get purchase details
- `PUT /api/purchases/[id]` - Update purchase
- `DELETE /api/purchases/[id]` - Delete purchase

## Database Schema

The application maintains the same database structure as the legacy PHP system:

- **Products**: Auto parts inventory with categories, companies, stock levels
- **Invoices**: Sales transactions with line items and GST calculations
- **Purchases**: Purchase orders with automatic stock updates
- **Customers**: Customer details with billing/shipping addresses
- **Vendors**: Supplier information
- **Supporting Tables**: Categories, companies, states, financial years, etc.

## Business Logic

### Stock Management
- Purchase orders **increase** stock levels
- Sales invoices **decrease** stock levels
- Automatic low stock alerts when stock < min_stock

### GST Calculations
- **Intra-state**: CGST + SGST (both states same)
- **Inter-state**: IGST only (different states)
- Tax rates configurable per product

### Invoice Numbering
- Sequential numbering per financial year
- Format: Invoice number based on current financial year setting

## Deployment

### Hostinger Deployment

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Configure for Node.js hosting**
   - Hostinger supports Node.js applications
   - Upload built files to your hosting account
   - Configure environment variables in hosting panel

3. **Database Connection**
   - Ensure remote MySQL access is enabled
   - Update DATABASE_URL for production environment

## Troubleshooting

### Common Issues

1. **Connection Timeout**
   - Check Hostinger MySQL external access settings
   - Verify IP address is whitelisted

2. **Prisma Connection Errors**
   - Ensure DATABASE_URL is correctly formatted
   - Test connection with `npm run prisma:db:push`

3. **TypeScript Errors**
   - Run `npm install` to install all dependencies
   - Generate Prisma client: `npm run prisma:generate`

### Development Tips

- Use `npm run prisma:studio` to browse database visually
- Check browser console for client-side errors
- Check terminal/server logs for API errors
- Use database logs to debug SQL issues

## Migration from Legacy System

The NextJS application is designed as a drop-in replacement for the legacy Yii2 system:

1. **Same Database**: Uses identical MySQL schema
2. **Same Business Logic**: Maintains all existing functionality
3. **Same GST Calculations**: Preserves tax calculation logic
4. **Same Workflows**: Invoice/Purchase processes unchanged
5. **Enhanced UI**: Modern responsive interface
6. **Better Performance**: Faster load times and better user experience

## Support

For issues and questions:
1. Check this README and DATABASE_SETUP.md
2. Review the implementation_plan.md for technical details
3. Check browser console and server logs for error details

## License

Private project for Baijnath Sons inventory management.
