import bcrypt from 'bcryptjs';

/**
 * Password hashing, in one place.
 *
 * This lives apart from lib/user-management.ts because that module constructs
 * its own PrismaClient at import time; anything that only needs to hash a
 * password should not pay for a second connection pool to get it.
 *
 * It matters that there is exactly one of these. pages/api/users/index.ts used
 * to hash with an unsalted SHA-256 - the comment "in a real app, you'd use
 * bcrypt" was still in the file - while NextAuth verified with bcrypt.compare().
 * bcrypt.compare() returns false for anything that is not a bcrypt hash, so
 * every account created through the Users settings page could never log in
 * (F-60). Two hashing schemes in one codebase is not a style problem.
 */

/** Cost factor. Matches the existing seeded users, which are all $2a$12$. */
export const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/** Shared minimum, applied by both the create and the change-password paths. */
export const MIN_PASSWORD_LENGTH = 6;

export function isAcceptablePassword(password?: string | null): boolean {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}
