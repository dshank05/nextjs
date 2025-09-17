// Simple Node.js script to create users in the database
// Run with: node scripts/create-user.js

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function hashPassword(password) {
  return await bcrypt.hash(password, 12)
}

function generateAuthKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

async function createUser(username, email, password) {
  const hashedPassword = await hashPassword(password)
  const timestamp = Math.floor(Date.now() / 1000)
  
  try {
    const user = await prisma.user.create({
      data: {
        username: username,
        email: email,
        password_hash: hashedPassword,
        auth_key: generateAuthKey(),
        status: 10, // Active status
        created_at: timestamp,
        updated_at: timestamp,
      },
    })
    
    console.log(`✅ User created successfully:`)
    console.log(`   Username: ${user.username}`)
    console.log(`   Email: ${user.email}`)
    console.log(`   ID: ${user.id}`)
    console.log('')
    
    return user
  } catch (error) {
    if (error.code === 'P2002') {
      console.log(`❌ User '${username}' already exists (duplicate username or email)`)
    } else {
      console.error('❌ Error creating user:', error.message)
    }
    console.log('')
  }
}

async function createExampleUsers() {
  console.log('🔐 Creating example users for Baijnath Sons Inventory System...\n')
  
  const users = [
    { username: 'admin', email: 'admin@baijnathsons.com', password: 'admin123' },
    { username: 'manager', email: 'manager@baijnathsons.com', password: 'manager123' },
    { username: 'inventory', email: 'inventory@baijnathsons.com', password: 'inventory123' },
    { username: 'sales', email: 'sales@baijnathsons.com', password: 'sales123' },
    { username: 'accounts', email: 'accounts@baijnathsons.com', password: 'accounts123' },
  ]
  
  for (const userData of users) {
    await createUser(userData.username, userData.email, userData.password)
  }
  
  console.log('🎉 User creation process completed!')
  console.log('\n📝 You can now login with any of these credentials:')
  users.forEach(user => {
    console.log(`   Username: ${user.username} | Password: ${user.password}`)
  })
  console.log('\n🔒 Remember to change these default passwords after first login!')
}

async function listUsers() {
  console.log('👥 Current users in the system:\n')
  
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        created_at: true,
      },
    })
    
    if (users.length === 0) {
      console.log('   No users found. Run with --create to create example users.')
    } else {
      users.forEach(user => {
        const statusText = user.status === 10 ? '✅ Active' : '❌ Inactive'
        const createdDate = new Date(user.created_at * 1000).toLocaleDateString()
        console.log(`   ID: ${user.id} | ${user.username} | ${user.email} | ${statusText} | Created: ${createdDate}`)
      })
    }
  } catch (error) {
    console.error('❌ Error listing users:', error.message)
  }
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('🔐 Baijnath Sons - User Management Script\n')
    console.log('Usage:')
    console.log('  node scripts/create-user.js --create    Create 5 example users')
    console.log('  node scripts/create-user.js --list      List all users')
    console.log('  node scripts/create-user.js --help      Show this help')
    console.log('')
    return
  }
  
  if (args.includes('--create')) {
    await createExampleUsers()
  } else if (args.includes('--list')) {
    await listUsers()
  } else {
    console.log('🔐 Baijnath Sons - User Management\n')
    console.log('Run with --help to see available options')
    console.log('Quick start: node scripts/create-user.js --create')
  }
  
  await prisma.$disconnect()
}

main().catch(console.error)
