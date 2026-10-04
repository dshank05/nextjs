import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { randomBytes } from 'crypto'
import { hashPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } from '../../../lib/password'
import { withObservability } from '../../../lib/withObservability'
import { USER_STATUS_ACTIVE, USER_STATUS_INACTIVE } from '../../../types/settings'
import { fail } from '../../../lib/api/respond'
import { deactivationRefusal } from '../../../lib/user-guard'

/**
 * Parse the account status.
 *
 * `user.status` is 10 for Active and 0 for Inactive - not the 'Active' /
 * 'Inactive' strings every other settings resource uses. That is what made this
 * a bug rather than a typo: the previous `parseInt(status.toString()) || 10`
 * treated the falsy 0 as "nothing supplied" and wrote 10, so **deactivating a
 * user silently reactivated them** (S-25). Same shape as F-31, where `!rate`
 * rejected a 0% GST slab.
 *
 * Absent means "leave it at the default"; present but not 10 or 0 is refused
 * rather than guessed at.
 */
function parseUserStatus(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = parseInt(String(raw), 10)
  if (value === USER_STATUS_ACTIVE || value === USER_STATUS_INACTIVE) return value
  return null
}

async function handleUpdate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, username, email, phone, status, password } = req.body

    if (!id || !parseInt(id.toString())) {
      return res.status(400).json({
        message: 'Valid user ID is required'
      })
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({
        message: 'Username is required and must be a non-empty string'
      })
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        message: 'Email is required and must be a non-empty string'
      })
    }

    if (phone && (typeof phone !== 'string' || !/^\d{10}$/.test(phone.trim()))) {
      return res.status(400).json({
        message: 'Phone number must be exactly 10 digits'
      })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        message: 'Please provide a valid email address'
      })
    }

    const userId = parseInt(id.toString())
    const trimmedUsername = username.trim()
    const trimmedEmail = email.trim()

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!existingUser) {
      return res.status(404).json({
        message: 'User not found'
      })
    }

    // Check if username or email already exists (excluding current user)
    const conflictingUser = await prisma.user.findFirst({
      where: {
        AND: [
          { id: { not: userId } },
          {
            OR: [
              { username: trimmedUsername },
              { email: trimmedEmail }
            ]
          }
        ]
      }
    })

    if (conflictingUser) {
      const conflictField = conflictingUser.username === trimmedUsername ? 'username' : 'email'
      return res.status(409).json({
        message: `${conflictField.charAt(0).toUpperCase() + conflictField.slice(1)} already exists`
      })
    }

    // A new password is optional on update: blank or absent means "leave it
    // alone". Before this, `password` was not even read here, so there was no
    // way to change a password anywhere in the app - the settings form hides
    // the field when editing, and the API ignored it if sent (F-61).
    const parsedStatus = parseUserStatus(status, existingUser.status)
    if (parsedStatus === null) {
      return res.status(400).json({
        message: `Status must be ${USER_STATUS_ACTIVE} (Active) or ${USER_STATUS_INACTIVE} (Inactive)`
      })
    }

    if (parsedStatus === USER_STATUS_INACTIVE && existingUser.status !== USER_STATUS_INACTIVE) {
      const refusal = await deactivationRefusal(req, res, userId)
      if (refusal) return res.status(409).json({ message: refusal })
    }

    const wantsPasswordChange = typeof password === 'string' && password !== ''

    if (wantsPasswordChange && !isAcceptablePassword(password)) {
      return res.status(400).json({
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
      })
    }

    // Update user
    await prisma.user.update({
      where: { id: userId },
      data: {
        username: trimmedUsername,
        email: trimmedEmail,
        phone: phone ? phone.trim() : null,
        status: parsedStatus,
        ...(wantsPasswordChange ? { password_hash: await hashPassword(password) } : {}),
        updated_at: Math.floor(Date.now() / 1000)
      }
    })

    res.status(200).json({
      status: "success",
      message: "User updated successfully"
    })
  } catch (error) {
    return fail(res, error, 'update user')
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    // S-26: an update was only reachable by POSTing an id to the collection,
    // which is what every other settings page does with PUT. POST still works
    // so the existing page keeps running.
    case 'PUT':
      return handleUpdate(req, res)
    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT'])
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { page = 1, limit = 50, search = '', sortBy = 'created_at', sortOrder = 'desc', dropdown = 'false' } = req.query
    // S-55: F-58's fix - a picker that silently shows only its first page -
    // reached customers, vendors, staff, mechanics, warehouses and gst-rates,
    // but never users or states.
    const isDropdown = dropdown === 'true'

    const pageNum = parseInt(page as string, 10)
    const limitNum = parseInt(limit as string, 10)
    const searchTerm = search as string

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['id', 'username', 'email', 'status', 'created_at', 'updated_at']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'created_at'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // Build where clause for search
    const where = searchTerm ? {
      OR: [
        { username: { contains: searchTerm } },
        { email: { contains: searchTerm } }
      ]
    } : {}

    // Get total count for pagination
    const total = await prisma.user.count({ where })

    // Get users with pagination
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        status: true,
        created_at: true,
        updated_at: true
      },
      orderBy: { [sortField]: sortDirection },
      ...(isDropdown ? {} : { skip: (pageNum - 1) * limitNum, take: limitNum })
    })

    // Never 0: an empty list is page 1 of 1.
    const totalPages = Math.max(1, Math.ceil(total / limitNum))
    const hasMore = pageNum < totalPages

    res.status(200).json({
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore
      }
    })
  } catch (error) {
    return fail(res, error, 'fetch users data')
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, username, email, phone, password, status = 10 } = req.body

    // If ID is provided, this is an update operation
    if (id) {
      return handleUpdate(req, res)
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({
        message: 'Username is required and must be a non-empty string'
      })
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        message: 'Email is required and must be a non-empty string'
      })
    }

    if (phone && (typeof phone !== 'string' || !/^\d{10}$/.test(phone.trim()))) {
      return res.status(400).json({
        message: 'Phone number must be exactly 10 digits'
      })
    }

    if (!isAcceptablePassword(password)) {
      return res.status(400).json({
        message: `Password is required and must be at least ${MIN_PASSWORD_LENGTH} characters long`
      })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        message: 'Please provide a valid email address'
      })
    }

    const parsedStatus = parseUserStatus(status, USER_STATUS_ACTIVE)
    if (parsedStatus === null) {
      return res.status(400).json({
        message: `Status must be ${USER_STATUS_ACTIVE} (Active) or ${USER_STATUS_INACTIVE} (Inactive)`
      })
    }

    const trimmedUsername = username.trim()
    const trimmedEmail = email.trim()

    // Check if username or email already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: trimmedUsername },
          { email: trimmedEmail }
        ]
      }
    })

    if (existingUser) {
      const conflictField = existingUser.username === trimmedUsername ? 'username' : 'email'
      return res.status(409).json({
        message: `${conflictField.charAt(0).toUpperCase() + conflictField.slice(1)} already exists`
      })
    }

    // bcrypt, because that is what NextAuth's authorize() verifies with.
    // This used to be an unsalted SHA-256 digest, which bcrypt.compare() always
    // rejects - so every account created here was unusable from birth (F-60).
    const passwordHash = await hashPassword(password)
    // S-29: this was Math.random().toString(36) - not a cryptographic
    // source, and about 60 bits of a weak generator. NextAuth does not use
    // auth_key today, which is the only reason it did not matter.
    // E-03: 16 bytes = 32 hex characters - the column is VARCHAR(32), and
    // MySQL in strict mode refuses anything longer (24 bytes made 48).
    const authKey = randomBytes(16).toString("hex")

    // Create new user
    const user = await prisma.user.create({
      data: {
        username: trimmedUsername,
        email: trimmedEmail,
        phone: phone ? phone.trim() : null,
        auth_key: authKey,
        password_hash: passwordHash,
        password_reset_token: null,
        status: parsedStatus,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        status: true,
        created_at: true,
        updated_at: true
      }
    })

    res.status(201).json({
      status: "success",
      message: "User created successfully"
    })
  } catch (error) {
    return fail(res, error, 'create user')
  }
}


export default withObservability(handler)