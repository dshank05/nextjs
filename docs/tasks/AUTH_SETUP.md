# 🔐 Authentication Setup Guide
## Baijnath Sons Inventory System - NextAuth.js Integration

This guide will help you set up and configure the authentication system for your inventory management application.

## 🎯 What's Implemented

✅ **NextAuth.js Integration** - Enterprise-grade authentication  
✅ **Custom Login Page** - Beautiful glass-morphism design with your logo  
✅ **Database Integration** - Uses your existing `user` table  
✅ **Route Protection** - Automatic redirect for unauthorized users  
✅ **Persistent Sessions** - Users stay logged in for 1 year  
✅ **User Management** - Easy user creation and management tools  
✅ **TypeScript Support** - Full type safety  

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd nextjs
npm install
```

The following packages have been added to your `package.json`:
- `next-auth` - Authentication framework
- `@next-auth/prisma-adapter` - Database adapter
- `bcryptjs` - Password hashing
- `@types/bcryptjs` - TypeScript definitions

### 2. Environment Setup
Copy your `.env.example` to `.env.local` and update the `NEXTAUTH_SECRET`:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add a strong secret:
```env
NEXTAUTH_SECRET="your-super-secret-nextauth-key-here-make-it-long-and-random-at-least-32-chars"
```

**Important for Production:** Generate a secure secret using:
```bash
openssl rand -base64 32
```

### 3. Create Your First Users
Run the user creation script to create 5 example users:

```bash
node scripts/create-user.js --create
```

This creates users:
- `admin` / `admin123`
- `manager` / `manager123`  
- `inventory` / `inventory123`
- `sales` / `sales123`
- `accounts` / `accounts123`

### 4. Start the Application
```bash
npm run dev
```

### 5. Test Authentication
1. Visit `http://localhost:3000`
2. You'll be redirected to the login page
3. Login with any of the created credentials
4. Enjoy your secure inventory system!

## 🎨 Login Page Features

- **Glass-morphism Design** - Modern frosted glass effect
- **Animated Background** - Subtle moving gradients
- **Your Logo Integration** - Displays your Baijnath Sons logo
- **Responsive Design** - Works on all devices
- **Loading States** - Professional loading animations
- **Error Handling** - Clear error messages

## 👥 User Management

### List All Users
```bash
node scripts/create-user.js --list
```

### Create Individual Users
You can modify the script or use the functions in `lib/user-management.ts`:

```javascript
import { createUser } from '../lib/user-management'

await createUser({
  username: 'newuser',
  email: 'newuser@baijnathsons.com', 
  password: 'securepassword'
})
```

### User Status Management
Users have a `status` field:
- `10` = Active (can login)
- `0` = Inactive (cannot login)

## 🛡️ Security Features

### Password Security
- Passwords are hashed using bcrypt with 12 rounds
- Never stored in plain text
- Automatic salt generation

### Session Security  
- JWT tokens with secure signing
- HTTP-only cookies
- CSRF protection
- 1-year session duration (as requested)

### Route Protection
- All routes automatically protected except login
- Middleware-based authentication checking
- Automatic redirect to login for unauthorized users

## 🏗️ File Structure

```
nextjs/
├── pages/api/auth/
│   └── [...nextauth].ts          # NextAuth configuration
├── pages/auth/
│   └── signin.tsx                # Custom login page  
├── middleware.ts                 # Route protection
├── types/
│   └── next-auth.d.ts           # TypeScript declarations
├── lib/
│   └── user-management.ts       # User utilities
├── scripts/
│   └── create-user.js           # User creation script
└── components/
    └── Layout.tsx               # Updated with user menu
```

## 🌐 Production Deployment (Vercel)

### 1. Environment Variables
In your Vercel dashboard, add these environment variables:

```
DATABASE_URL=your_hostinger_mysql_url
NEXTAUTH_URL=https://yourdomain.vercel.app
NEXTAUTH_SECRET=your_super_secret_key
```

### 2. Deploy
```bash
vercel --prod
```

### 3. Create Production Users
After deployment, create users on production:

1. Clone your repository on your local machine
2. Update `.env.local` with production DATABASE_URL
3. Run: `node scripts/create-user.js --create`
4. Remove production credentials from local env file

## 🔧 Customization

### Change Session Duration
Edit `pages/api/auth/[...nextauth].ts`:
```javascript
session: {
  strategy: 'jwt',
  maxAge: 30 * 24 * 60 * 60, // 30 days instead of 1 year
}
```

### Customize Login Page
Edit `pages/auth/signin.tsx` to modify:
- Colors and styling
- Logo placement  
- Form fields
- Animations

### Add User Roles
You can extend the user table and add role-based access:

1. Add a `role` field to your user table
2. Update the NextAuth callbacks to include role
3. Use role-based route protection in middleware

## 🧪 Testing Authentication Flow

1. **Login Test**: Try logging in with valid credentials
2. **Invalid Credentials**: Test with wrong password  
3. **Route Protection**: Visit a protected page without login
4. **Session Persistence**: Close browser and reopen
5. **Logout**: Test the logout functionality

## 📞 Troubleshooting

### Common Issues

**"Module not found" errors**
- Run `npm install` to ensure all dependencies are installed

**Database connection errors**  
- Verify your `DATABASE_URL` is correct
- Ensure your database is accessible

**Login not working**
- Check if users exist: `node scripts/create-user.js --list`  
- Verify passwords are correctly hashed
- Check browser console for JavaScript errors

**Redirect loops**
- Ensure `NEXTAUTH_URL` matches your domain
- Check middleware configuration

### Need Help?

The authentication system is production-ready and should work seamlessly. If you encounter issues:

1. Check the browser console for errors
2. Review the server logs
3. Verify environment variables are correct
4. Ensure the database connection is working

## 🎉 You're Ready!

Your Baijnath Sons Inventory System now has enterprise-grade authentication with:
- ✅ Secure user login
- ✅ Beautiful custom design  
- ✅ Easy user management
- ✅ Production-ready security
- ✅ Persistent sessions

Login and enjoy your secure inventory management system! 🚀
