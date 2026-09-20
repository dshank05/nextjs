import NextAuth, { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

export const authOptions: NextAuthOptions = {
  // No adapter on purpose.
  //
  // PrismaAdapter requires Account, Session, User and VerificationToken models
  // in the NextAuth shape. This schema has none of them - prisma.account,
  // prisma.session and prisma.verificationToken are all undefined - so NextAuth
  // failed its adapter validation at init and every auth call returned
  // `/api/auth/error?error=Configuration`.
  //
  // An adapter is not needed here anyway: sessions are JWTs, and the
  // credentials provider looks the user up directly in `authorize()` below.
  // NextAuth does not support database sessions with CredentialsProvider.
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null
        }

        try {
          // Find user in your existing user table
          const user = await prisma.user.findUnique({
            where: {
              username: credentials.username
            }
          })

          if (!user) {
            return null
          }

          // Check if user is active (status = 10 means active in your schema)
          if (user.status !== 10) {
            return null
          }

          // Verify password against password_hash
          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password_hash
          )

          if (!isPasswordValid) {
            return null
          }

          // Return user object that will be stored in session
          return {
            id: user.id.toString(),
            email: user.email,
            name: user.username,
            username: user.username,
          }
        } catch (error) {
          console.error('Authentication error:', error)
          return null
        }
      }
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 365 * 24 * 60 * 60, // 1 year (forever as requested)
  },
  pages: {
    signIn: '/auth/signin', // Custom login page
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.username = user.username
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub || ''
        session.user.username = token.username as string
      }
      return session
    }
  },
  secret: process.env.NEXTAUTH_SECRET,
}

export default NextAuth(authOptions)
