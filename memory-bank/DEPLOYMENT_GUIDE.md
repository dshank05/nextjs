# Deployment Guide Memory Bank

## 🚀 Production Deployment Overview

### Deployment Strategy
The NextJS application is designed for seamless deployment to Hostinger, connecting directly to the existing production database for zero-downtime migration from the legacy Yii2 system.

### Key Advantages
- **Zero Data Migration**: Uses existing Hostinger MySQL database
- **Parallel Operation**: Can run alongside legacy system during transition
- **Immediate Data Access**: Real-time access to 4,111+ products and historical data
- **No Downtime**: Business operations continue uninterrupted

## 🏗️ Pre-Deployment Checklist

### Environment Preparation
```bash
# 1. Verify all dependencies are production-ready
npm install --production

# 2. Build application for production
npm run build

# 3. Test production build locally
npm start

# 4. Verify database connections work
npm run prisma:generate
npm run prisma:db:push
```

### Critical Configuration Files
- ✅ **`.env.production`** - Production environment variables
- ✅ **`next.config.js`** - NextJS production configuration
- ✅ **`package.json`** - All dependencies specified with exact versions
- ✅ **`prisma/schema.prisma`** - Database schema matching production

### Database Verification
```bash
# Test connection to production database
npm run prisma:studio
# Should show all 29 tables with production data

# Verify rate calculations work
# Check that products show latest purchase rates
# Confirm category/company names resolve correctly
```

## 🌐 Hostinger Deployment Steps

### Step 1: File Upload and Structure
```
public_html/nextjs/
├── .next/              # Built application files
├── public/             # Static assets
├── pages/              # Source pages (needed for API routes)
├── components/         # React components
├── lib/                # Database utilities
├── prisma/             # Database schema
├── package.json        # Dependencies
├── next.config.js      # NextJS configuration
└── .env.production     # Production environment variables
```

### Step 2: Environment Configuration
Create `.env.production` on server:
```env
# Production Database (Already Configured)
DATABASE_URL="mysql://u348217822_baij_fq87p:8rQm~O-;94Yf@localhost:3306/u348217822_baij_mc8qp"

# NextJS Configuration
NODE_ENV=production
NEXTJS_URL=https://yourdomain.com

# Security (generate secure random strings)
NEXTAUTH_SECRET=your-secure-random-string
NEXTAUTH_URL=https://yourdomain.com
```

### Step 3: Dependencies Installation
```bash
# On Hostinger server via SSH or File Manager
cd public_html/nextjs
npm install --production

# Generate Prisma client for production
npm run prisma:generate
```

### Step 4: Build and Start
```bash
# Build application
npm run build

# Start production server
npm start
# Or use PM2 for process management
pm2 start npm --name "nextjs-inventory" -- start
```

## 🔧 Hostinger-Specific Configuration

### Node.js App Setup (Hostinger Control Panel)
1. **Create Node.js App**:
   - App Root: `/public_html/nextjs`
   - Startup File: `server.js` or use Next.js built-in server
   - Node.js Version: 18.x or later

2. **Environment Variables** (via Control Panel):
   ```
   NODE_ENV=production
   DATABASE_URL=mysql://u348217822_baij_fq87p:8rQm~O-;94Yf@localhost:3306/u348217822_baij_mc8qp
   ```

3. **Domain Configuration**:
   - Point domain/subdomain to `/public_html/nextjs`
   - Enable HTTPS (SSL certificate)
   - Configure redirects if needed

### Database Connection (Production)
```env
# Local connection from Hostinger server
DATABASE_URL="mysql://u348217822_baij_fq87p:8rQm~O-;94Yf@localhost:3306/u348217822_baij_mc8qp"

# Alternative: Use 127.0.0.1 if localhost fails
DATABASE_URL="mysql://u348217822_baij_fq87p:8rQm~O-;94Yf@127.0.0.1:3306/u348217822_baij_mc8qp"
```

## 📋 Production Verification Steps

### Post-Deployment Testing
1. **Application Access**:
   - ✅ Website loads at production URL
   - ✅ No console errors in browser
   - ✅ All navigation links work

2. **Database Connectivity**:
   - ✅ Dashboard shows real statistics (4,111+ products)
   - ✅ Product list loads with pagination
   - ✅ Latest purchase rates display correctly
   - ✅ Category and company names resolve

3. **API Functionality**:
   - ✅ All API endpoints respond correctly
   - ✅ Product search and filtering work
   - ✅ Data matches legacy system exactly

4. **Performance Testing**:
   - ✅ Page load times under 3 seconds
   - ✅ API responses under 1 second
   - ✅ Mobile responsiveness works
   - ✅ Large dataset pagination performs well

## 🚨 Troubleshooting Common Deployment Issues

### Database Connection Issues
```bash
# Issue: Connection refused
# Solution: Use localhost instead of remote host
DATABASE_URL="mysql://user:pass@localhost:3306/database"

# Issue: SSL connection error  
# Solution: Disable SSL
DATABASE_URL="mysql://user:pass@localhost:3306/database?sslmode=DISABLED"

# Issue: Host resolution
# Solution: Use IP address
DATABASE_URL="mysql://user:pass@127.0.0.1:3306/database"
```

### Build and Runtime Issues
```bash
# Issue: Build fails due to TypeScript errors
# Solution: Fix TypeScript issues or temporarily disable strict mode

# Issue: Memory errors during build
# Solution: Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run build

# Issue: API routes not working
# Solution: Ensure pages/api directory is included in deployment
```

### Performance Issues
```bash
# Issue: Slow query performance
# Solution: Add database indexes for frequently queried fields

# Issue: High memory usage
# Solution: Optimize data fetching patterns and implement caching

# Issue: Connection pool exhaustion
# Solution: Optimize Prisma connection management
```

## 🔒 Security Configuration

### Production Security Measures
1. **Environment Variables Security**:
   - Never commit `.env` files to git
   - Use Hostinger environment variable settings
   - Rotate database credentials regularly

2. **API Security**:
   - Validate all input parameters
   - Implement rate limiting if needed
   - Log suspicious activity

3. **Database Security**:
   - Use database user with minimal required permissions
   - Enable query logging for audit trail
   - Regular security updates

### SSL and HTTPS Configuration
```javascript
// next.config.js - Force HTTPS in production
const nextConfig = {
  async redirects() {
    if (process.env.NODE_ENV === 'production') {
      return [
        {
          source: '/(.*)',
          has: [
            {
              type: 'header',
              key: 'x-forwarded-proto',
              value: 'http',
            },
          ],
          destination: 'https://yourdomain.com/$1',
          permanent: true,
        },
      ]
    }
    return []
  },
}
```

## 📊 Monitoring and Maintenance

### Production Monitoring
1. **Application Health**:
   - Monitor server response times
   - Track error rates and exceptions
   - Monitor memory and CPU usage

2. **Database Health**:
   - Monitor connection pool usage
   - Track slow query performance
   - Monitor database disk space

3. **Business Metrics**:
   - Track user activity patterns
   - Monitor API endpoint usage
   - Analyze performance bottlenecks

### Backup Strategy
```bash
# Regular database backups (automated)
mysqldump -u username -p database_name > backup_$(date +%Y%m%d_%H%M%S).sql

# Application file backups
tar -czf app_backup_$(date +%Y%m%d_%H%M%S).tar.gz /public_html/nextjs/

# Environment configuration backup
cp .env.production .env.production.backup.$(date +%Y%m%d)
```

### Update and Maintenance Procedures
1. **Code Updates**:
   - Test updates in staging environment first
   - Use rolling deployment for zero downtime
   - Keep rollback plan ready

2. **Database Schema Updates**:
   - Use Prisma migrations for schema changes
   - Test migrations on copy of production data
   - Plan maintenance windows for major changes

3. **Dependency Updates**:
   - Regular security updates for npm packages
   - Test compatibility before applying updates
   - Monitor for breaking changes

## 🎯 Performance Optimization

### Production Performance Tuning
1. **NextJS Optimizations**:
   ```javascript
   // next.config.js
   const nextConfig = {
     experimental: {
       appDir: false,
     },
     images: {
       domains: ['yourdomain.com'],
     },
     compress: true,
   }
   ```

2. **Database Optimizations**:
   - Add indexes for frequently queried columns
   - Implement connection pooling
   - Use database query optimization

3. **Caching Strategy**:
   ```typescript
   // Implement Redis or in-memory caching for:
   - Category and company lookups
   - Product search results
   - Dashboard statistics (with TTL)
   ```

### Scaling Considerations
- **Horizontal Scaling**: Consider load balancing for high traffic
- **Database Scaling**: Read replicas for heavy read workloads
- **CDN Integration**: Static asset delivery optimization
- **Caching Layer**: Redis for session management and caching

## 🎉 Go-Live Checklist

### Final Pre-Launch Verification
- [ ] **Application builds successfully**
- [ ] **All environment variables configured**
- [ ] **Database connection works from production server**
- [ ] **All API endpoints return correct data**
- [ ] **Dashboard displays real statistics**
- [ ] **Product rates show latest purchase rates**
- [ ] **SSL certificate installed and working**
- [ ] **Domain/subdomain configured correctly**
- [ ] **Error monitoring set up**
- [ ] **Backup procedures in place**
- [ ] **Rollback plan prepared**

### Business Continuity
- **Parallel Operation**: Legacy system remains functional during transition
- **User Training**: Staff familiar with new interface
- **Data Verification**: Cross-check critical data between systems
- **Support Plan**: Technical support available during go-live

### Success Metrics
- ✅ **Zero downtime** during deployment
- ✅ **Faster performance** than legacy system
- ✅ **All business functions** working correctly
- ✅ **User satisfaction** with new interface
- ✅ **Data integrity** maintained throughout migration

---

## 🆘 Emergency Procedures

### Rollback Plan
1. **Immediate Rollback**:
   - Switch DNS/subdomain back to legacy system
   - Verify legacy system functionality
   - Communicate status to users

2. **Issue Diagnosis**:
   - Check application logs
   - Verify database connectivity
   - Test API endpoints individually

3. **Recovery Process**:
   - Fix identified issues in staging
   - Retest thoroughly
   - Redeploy when stable

### Support Contacts
- **Technical Issues**: Development team contact
- **Database Issues**: Database administrator
- **Server Issues**: Hostinger support
- **Business Issues**: System administrator

**Remember**: The production database contains live business data - always prioritize data integrity and business continuity in all deployment decisions.
