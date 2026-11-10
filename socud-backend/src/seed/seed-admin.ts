import { PASSWORD_MAX_BYTES } from '../auth/dto/register.dto';
import { normalizeEmail } from '../auth/dto/email.transform';

/** Stricter than the 10-character minimum for self-registration: this account can see everything. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMON_PASSWORDS = new Set([
  'password1234',
  'passwordpassword',
  '123456789012',
  'changeme1234',
  'change-me-now',
  'qwertyuiop12',
  'adminadminadmin',
  'administrator',
]);

/** Minimal subset of the Prisma client the seed needs (keeps the logic testable without a database). */
export interface SeedPrisma {
  user: {
    findFirst(args: {
      where: { email: { equals: string; mode: 'insensitive' } };
      select: { id: true; isSystemAdmin: true };
    }): Promise<{ id: string; isSystemAdmin: boolean } | null>;
    create(args: {
      data: { email: string; passwordHash: string; isSystemAdmin: true };
      select: { id: true };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: { isSystemAdmin: true };
    }): Promise<unknown>;
  };
}

export type SeedResult = 'created' | 'promoted' | 'unchanged';

export class SeedConfigError extends Error {}

/** Returns the reason a password is unacceptable for the admin account, or null if it is fine. */
export function validateAdminPassword(
  password: string | undefined,
  email: string,
): string | null {
  if (!password) return 'SEED_ADMIN_PASSWORD is not set';
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return `SEED_ADMIN_PASSWORD must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters long`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `SEED_ADMIN_PASSWORD must be at most ${PASSWORD_MAX_BYTES} bytes (bcrypt ignores the rest)`;
  }
  if (new Set(password).size < 5) {
    return 'SEED_ADMIN_PASSWORD has too few distinct characters';
  }
  const lowered = password.toLowerCase();
  const localPart = email.split('@')[0];
  if (
    COMMON_PASSWORDS.has(lowered) ||
    lowered === email ||
    (localPart.length >= 4 && lowered.includes(localPart))
  ) {
    return 'SEED_ADMIN_PASSWORD is too easy to guess';
  }
  return null;
}

/**
 * Creates the first system admin. Idempotent:
 * - no such user: created with isSystemAdmin = true;
 * - user exists and is not an admin: promoted, password left untouched;
 * - user is already an admin: nothing happens (the password is never overwritten).
 * The password is validated and hashed only when a user has to be created, and is never logged.
 */
export async function seedAdmin(
  prisma: SeedPrisma,
  hash: (password: string) => Promise<string>,
  input: { email?: string; password?: string },
): Promise<SeedResult> {
  const email = normalizeEmail(input.email ?? '');
  if (!email) throw new SeedConfigError('SEED_ADMIN_EMAIL is not set');
  if (!SIMPLE_EMAIL.test(email)) {
    throw new SeedConfigError('SEED_ADMIN_EMAIL is not a valid email address');
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, isSystemAdmin: true },
  });

  if (existing) {
    if (existing.isSystemAdmin) return 'unchanged';
    await prisma.user.update({
      where: { id: existing.id },
      data: { isSystemAdmin: true },
    });
    return 'promoted';
  }

  const problem = validateAdminPassword(input.password, email);
  if (problem) throw new SeedConfigError(problem);

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(input.password as string),
      isSystemAdmin: true,
    },
    select: { id: true },
  });
  return 'created';
}
