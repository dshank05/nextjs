import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12)
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash)
}

/**
 * Create a new user in the database
 */
export async function createUser(userData: {
  username: string
  email: string
  password: string
}) {
  const hashedPassword = await hashPassword(userData.password)
  const timestamp = Math.floor(Date.now() / 1000)
  
  try {
    const user = await prisma.user.create({
      data: {
        username: userData.username,
        email: userData.email,
        password_hash: hashedPassword,
        auth_key: generateAuthKey(),
        status: 10, // Active status
        created_at: timestamp,
        updated_at: timestamp,
      },
    })
    
    console.log(`User created successfully:`)
    console.log(`Username: ${user.username}`)
    console.log(`Email: ${user.email}`)
    console.log(`ID: ${user.id}`)
    
    return user
  } catch (error) {
    console.error('Error creating user:', error)
    throw error
  }
}

/**
 * Update user password
 */
export async function updateUserPassword(username: string, newPassword: string) {
  const hashedPassword = await hashPassword(newPassword)
  const timestamp = Math.floor(Date.now() / 1000)
  
  try {
    const user = await prisma.user.update({
      where: { username },
      data: {
        password_hash: hashedPassword,
        updated_at: timestamp,
      },
    })
    
    console.log(`Password updated for user: ${user.username}`)
    return user
  } catch (error) {
    console.error('Error updating user password:', error)
    throw error
  }
}

/**
 * List all users
 */
export async function listUsers() {
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
    
    console.log('Users in system:')
    users.forEach(user => {
      console.log(`ID: ${user.id}, Username: ${user.username}, Email: ${user.email}, Status: ${user.status === 10 ? 'Active' : 'Inactive'}`)
    })
    
    return users
  } catch (error) {
    console.error('Error listing users:', error)
    throw error
  }
}

/**
 * Deactivate a user (set status to 0)
 */
export async function deactivateUser(username: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  
  try {
    const user = await prisma.user.update({
      where: { username },
      data: {
        status: 0, // Inactive status
        updated_at: timestamp,
      },
    })
    
    console.log(`User deactivated: ${user.username}`)
    return user
  } catch (error) {
    console.error('Error deactivating user:', error)
    throw error
  }
}

/**
 * Activate a user (set status to 10)
 */
export async function activateUser(username: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  
  try {
    const user = await prisma.user.update({
      where: { username },
      data: {
        status: 10, // Active status
        updated_at: timestamp,
      },
    })
    
    console.log(`User activated: ${user.username}`)
    return user
  } catch (error) {
    console.error('Error activating user:', error)
    throw error
  }
}

/**
 * Generate a random auth key (32 characters)
 */
function generateAuthKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Example usage functions (for testing or manual user creation)
export async function createExampleUsers() {
  const users = [
    { username: 'admin', email: 'admin@baijnathsons.com', password: 'admin123' },
    { username: 'manager', email: 'manager@baijnathsons.com', password: 'manager123' },
    { username: 'user1', email: 'user1@baijnathsons.com', password: 'user123' },
  ]
  
  for (const userData of users) {
    try {
      await createUser(userData)
    } catch (error) {
      console.log(`User ${userData.username} might already exist or there was an error.`)
    }
  }
}
