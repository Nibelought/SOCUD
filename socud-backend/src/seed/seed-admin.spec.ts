import {
  ADMIN_PASSWORD_MIN_LENGTH,
  SeedConfigError,
  SeedPrisma,
  seedAdmin,
  validateAdminPassword,
} from './seed-admin';

const GOOD_PASSWORD = 'correct-Horse-battery-9';

function setup(existing: { id: string; isSystemAdmin: boolean } | null) {
  const findFirst = jest.fn().mockResolvedValue(existing);
  const create = jest.fn().mockResolvedValue({ id: 'new' });
  const update = jest.fn().mockResolvedValue({});
  const prisma = { user: { findFirst, create, update } } as SeedPrisma;
  const hash = jest.fn((p: string) => Promise.resolve(`hashed:${p.length}`));
  return { prisma, findFirst, create, update, hash };
}

describe('seedAdmin', () => {
  it('creates a system admin with a hashed password and a normalised email', async () => {
    const { prisma, create, hash } = setup(null);
    const result = await seedAdmin(prisma, hash, {
      email: '  Admin@Example.COM ',
      password: GOOD_PASSWORD,
    });
    expect(result).toBe('created');
    expect(hash).toHaveBeenCalledWith(GOOD_PASSWORD);
    expect(create).toHaveBeenCalledWith({
      data: {
        email: 'admin@example.com',
        passwordHash: `hashed:${GOOD_PASSWORD.length}`,
        isSystemAdmin: true,
      },
      select: { id: true },
    });
  });

  it('looks the user up case-insensitively', async () => {
    const { prisma, findFirst, hash } = setup(null);
    await seedAdmin(prisma, hash, {
      email: 'admin@example.com',
      password: GOOD_PASSWORD,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'admin@example.com', mode: 'insensitive' } },
      select: { id: true, isSystemAdmin: true },
    });
  });

  it('is idempotent: an existing admin is left alone, password not even checked', async () => {
    const { prisma, create, update, hash } = setup({
      id: 'u1',
      isSystemAdmin: true,
    });
    const result = await seedAdmin(prisma, hash, {
      email: 'admin@example.com',
      password: undefined,
    });
    expect(result).toBe('unchanged');
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it('promotes an existing non-admin without touching the password', async () => {
    const { prisma, create, update, hash } = setup({
      id: 'u1',
      isSystemAdmin: false,
    });
    const result = await seedAdmin(prisma, hash, {
      email: 'admin@example.com',
    });
    expect(result).toBe('promoted');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isSystemAdmin: true },
    });
    expect(create).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'not-an-email'])(
    'refuses a missing or invalid email (%p)',
    async (email) => {
      const { prisma, findFirst } = setup(null);
      await expect(
        seedAdmin(prisma, jest.fn(), { email, password: GOOD_PASSWORD }),
      ).rejects.toBeInstanceOf(SeedConfigError);
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', 'short', 'password1234', 'aaaaaaaaaaaaaaaa'])(
    'refuses a missing or weak password (%p) and never creates a user',
    async (password) => {
      const { prisma, create } = setup(null);
      await expect(
        seedAdmin(prisma, jest.fn(), { email: 'admin@example.com', password }),
      ).rejects.toBeInstanceOf(SeedConfigError);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('never puts the password into an error message', async () => {
    const { prisma } = setup(null);
    const weak = 'tooShort1';
    const err: unknown = await seedAdmin(prisma, jest.fn(), {
      email: 'admin@example.com',
      password: weak,
    }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(weak);
  });
});

describe('validateAdminPassword', () => {
  it('accepts a strong password', () => {
    expect(validateAdminPassword(GOOD_PASSWORD, 'a@b.co')).toBeNull();
  });

  it(`requires at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`, () => {
    expect(validateAdminPassword('x9!Yz-Qw', 'a@b.co')).toMatch(/at least/);
  });

  it('rejects more than 72 bytes (bcrypt truncation)', () => {
    expect(validateAdminPassword('é9!Yz-Qw'.repeat(10), 'a@b.co')).toMatch(
      /72 bytes/,
    );
  });

  it('rejects passwords containing the email local part', () => {
    expect(
      validateAdminPassword('Xx-nibelought-9', 'nibelought@example.com'),
    ).toMatch(/easy to guess/);
  });
});
