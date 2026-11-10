// Run with `npm run db:seed` (prisma db seed). Needs DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hashPassword } from '../src/auth/password';
import { SeedConfigError, seedAdmin } from '../src/seed/seed-admin';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new SeedConfigError('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await seedAdmin(prisma, hashPassword, {
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    });
    const messages = {
      created: 'Created the system admin user.',
      promoted: 'User already existed: granted the system admin flag.',
      unchanged: 'The system admin user already exists: nothing to do.',
    };
    console.log(`[seed] ${messages[result]}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // Config errors are safe to print (they never contain the password); others only by message.
  console.error(
    `[seed] Failed: ${err instanceof Error ? err.message : 'unknown error'}`,
  );
  process.exit(1);
});
