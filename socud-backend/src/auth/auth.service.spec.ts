import { Test, TestingModule } from '@nestjs/testing';
import {
  AuthService,
  hashRefreshToken,
  ROTATION_GRACE_MS,
  SESSION_MAX_AGE_MS,
} from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

jest.mock('bcrypt');

const anyDate = expect.any(Date) as Date;
const callArgs = (fn: jest.Mock): unknown[][] => fn.mock.calls as unknown[][];

function createPrismaMock() {
  const mock = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // Interactive transactions run against the same mock client.
  mock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(mock),
  );
  return mock;
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: { sign: jest.Mock };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: 'hashed_password',
  };
  const registerDto = { email: 'test@mock.com', password: 'password1234' };
  const loginDto = { email: 'test@example.com', password: 'password123' };

  beforeEach(async () => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('mock_access') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('register', () => {
    it('creates the user with a normalised email', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-123',
        email: 'test@mock.com',
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');

      const result = await service.register({
        ...registerDto,
        email: '  Test@Mock.COM ',
      });

      expect(result).toEqual({ id: 'user-123', email: 'test@mock.com' });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'test@mock.com', mode: 'insensitive' } },
        select: { id: true },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'test@mock.com', passwordHash: 'hashed_password' },
        select: { id: true, email: true },
      });
    });

    it('throws ConflictException if email already exists', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'x' });

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns access token + user, creates a new family and a hashed refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        ...loginDto,
        email: ' Test@Example.com ',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result.access_token).toBe('mock_access');
      expect(result.user).toEqual({ id: mockUser.id, email: mockUser.email });

      // raw token: >= 32 bytes of base64url, never persisted as-is
      expect(result.refresh.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      expect(result.refresh.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6.9 * 24 * 3600 * 1000,
      );

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      const { data } = callArgs(prisma.refreshToken.create)[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.userId).toBe(mockUser.id);
      expect(data.tokenHash).toBe(hashRefreshToken(result.refresh.token));
      expect(data.tokenHash).not.toBe(result.refresh.token);
      expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect((data.sessionExpiresAt as Date).getTime()).toBeGreaterThan(
        Date.now() + SESSION_MAX_AGE_MS - 5000,
      );
      expect((data.expiresAt as Date).getTime()).toBeLessThan(
        (data.sessionExpiresAt as Date).getTime(),
      );
      expect(typeof data.familyId).toBe('string');
      expect(data.familyId).toBeTruthy();
    });

    it('uses a different family for every login', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login(loginDto);
      await service.login(loginDto);

      const families = callArgs(prisma.refreshToken.create).map(
        (c) => (c[0] as { data: { familyId: string } }).data.familyId,
      );
      expect(new Set(families).size).toBe(2);
    });

    it('falls back to a case-insensitive lookup for legacy mixed-case accounts', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        email: 'Test@Example.com',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result.user.email).toBe('Test@Example.com');
    });

    it('throws a generic UnauthorizedException if the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid user data'),
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('throws the same generic error if the password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid user data'),
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    const raw = 'raw-refresh-token';
    const DAY = 24 * 3600 * 1000;
    const now = 1_800_000_000_000;
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 'rt-1',
      userId: mockUser.id,
      tokenHash: hashRefreshToken(raw),
      familyId: 'family-1',
      expiresAt: new Date(now + DAY),
      sessionExpiresAt: new Date(now + 20 * DAY),
      rotatedAt: null,
      revokedAt: null,
      ...over,
    });
    const familyRevocation = {
      where: { familyId: 'family-1', revokedAt: null },
      data: { revokedAt: anyDate },
    };

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(now);
      prisma.user.findUnique.mockResolvedValue(mockUser);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rotates: marks the presented token rotated and issues a successor in the same family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored());
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refreshTokens(raw);

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashRefreshToken(raw) },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', rotatedAt: null, revokedAt: null },
        data: { rotatedAt: new Date(now) },
      });
      const { data } = callArgs(prisma.refreshToken.create)[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.familyId).toBe('family-1');
      expect(data.userId).toBe(mockUser.id);
      expect(data.tokenHash).toBe(hashRefreshToken(result.refresh.token));
      expect(data.sessionExpiresAt).toEqual(new Date(now + 20 * DAY));
      expect(data.expiresAt).toEqual(new Date(now + 7 * DAY));
      expect(result.refresh.token).not.toBe(raw);
      expect(result.access_token).toBe('mock_access');
      // rotation alone never revokes anything
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    });

    it('caps the successor expiry at the session expiry', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ sessionExpiresAt: new Date(now + 2 * DAY) }),
      );
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refreshTokens(raw);

      expect(result.refresh.expiresAt).toEqual(new Date(now + 2 * DAY));
      const { data } = callArgs(prisma.refreshToken.create)[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.expiresAt).toEqual(new Date(now + 2 * DAY));
      expect(data.sessionExpiresAt).toEqual(new Date(now + 2 * DAY));
    });

    it('rejects once the session cap is reached, without issuing or revoking', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ sessionExpiresAt: new Date(now - 1) }),
      );

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects an expired token without issuing a new one', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ expiresAt: new Date(now - 1000) }),
      );

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('accepts a concurrent refresh with an already rotated token inside the grace window', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ rotatedAt: new Date(now - ROTATION_GRACE_MS + 1) }),
      );

      const result = await service.refreshTokens(raw);

      expect(result.access_token).toBe('mock_access');
      // fresh token, same family; nothing claimed, nothing revoked
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      const { data } = callArgs(prisma.refreshToken.create)[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.familyId).toBe('family-1');
      expect(data.tokenHash).toBe(hashRefreshToken(result.refresh.token));
    });

    it('accepts the boundary: rotated exactly ROTATION_GRACE_MS ago', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ rotatedAt: new Date(now - ROTATION_GRACE_MS) }),
      );

      await expect(service.refreshTokens(raw)).resolves.toBeDefined();
    });

    it('two simultaneous refreshes with the same token both succeed and nothing is revoked', async () => {
      // In-memory row emulating the DB-level atomic claim.
      const row = stored();
      prisma.refreshToken.findUnique.mockImplementation(() =>
        Promise.resolve({ ...row }),
      );
      prisma.refreshToken.updateMany.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.rotatedAt === null && row.rotatedAt === null) {
            row.rotatedAt = new Date(now) as never;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        },
      );

      const [a, b] = await Promise.all([
        service.refreshTokens(raw),
        service.refreshTokens(raw),
      ]);

      expect(a.refresh.token).not.toBe(b.refresh.token);
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(2);
      const families = callArgs(prisma.refreshToken.create).map(
        (c) => (c[0] as { data: { familyId: string } }).data.familyId,
      );
      expect(families).toEqual(['family-1', 'family-1']);
      // only the two claim attempts; no family revocation
      expect(
        callArgs(prisma.refreshToken.updateMany).filter(
          (c) => (c[0] as { where: { familyId?: string } }).where.familyId,
        ),
      ).toHaveLength(0);
    });

    it('treats a lost claim on a revoked token as reuse', async () => {
      prisma.refreshToken.findUnique
        .mockResolvedValueOnce(stored())
        .mockResolvedValueOnce(stored({ revokedAt: new Date(now) }));
      prisma.refreshToken.updateMany
        .mockResolvedValueOnce({ count: 0 }) // claim failed
        .mockResolvedValueOnce({ count: 2 }); // family revocation

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith(
        familyRevocation,
      );
    });

    it('detects replay after the grace window and revokes the whole family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ rotatedAt: new Date(now - ROTATION_GRACE_MS - 1) }),
      );

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        familyRevocation,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('replay of a logged-out (revoked) token revokes the family and fails', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ revokedAt: new Date(now - 1000) }),
      );

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        familyRevocation,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('revoked takes precedence over the grace window', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ rotatedAt: new Date(now - 1000), revokedAt: new Date(now) }),
      );

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a missing token', async () => {
      await expect(service.refreshTokens(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects when the user no longer exists', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored());
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens(raw)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the family of the presented token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ familyId: 'fam-9' });

      await service.logout('raw');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam-9', revokedAt: null },
        data: { revokedAt: anyDate },
      });
    });

    it('is a no-op for unknown or missing tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.logout('raw')).resolves.toBeUndefined();
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('searchUsers', () => {
    const whereOf = () =>
      (callArgs(prisma.user.findMany)[0][0] as { where: unknown }).where;

    it('returns [] for fragments shorter than 3 characters without querying', async () => {
      await expect(service.searchUsers('me', ' ab ')).resolves.toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('scopes non-admins to shared-space matches plus an exact email match, excluding self', async () => {
      prisma.user.findUnique.mockResolvedValue({ isSystemAdmin: false });
      prisma.user.findMany.mockResolvedValue([{ id: 'u2', email: 'a@b.co' }]);

      const result = await service.searchUsers('me', ' Bob ');

      expect(result).toEqual([{ id: 'u2', email: 'a@b.co' }]);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              OR: [
                {
                  AND: [
                    { email: { contains: 'Bob', mode: 'insensitive' } },
                    {
                      spaceMembers: {
                        some: {
                          space: { members: { some: { userId: 'me' } } },
                        },
                      },
                    },
                  ],
                },
                { email: { equals: 'Bob', mode: 'insensitive' } },
              ],
            },
            { id: { not: 'me' } },
          ],
        },
        select: { id: true, email: true },
        orderBy: { email: 'asc' },
        take: 10,
      });
    });

    it('escapes LIKE wildcards in both the fragment and the exact match', async () => {
      prisma.user.findUnique.mockResolvedValue({ isSystemAdmin: false });
      prisma.user.findMany.mockResolvedValue([]);

      await service.searchUsers('me', '%_\\x');

      const serialised = JSON.stringify(whereOf());
      expect(serialised).toContain(
        JSON.stringify({ contains: '\\%\\_\\\\x', mode: 'insensitive' }),
      );
      expect(serialised).toContain(
        JSON.stringify({ equals: '\\%\\_\\\\x', mode: 'insensitive' }),
      );
    });

    it('lets system admins search everyone (still excluding self)', async () => {
      prisma.user.findUnique.mockResolvedValue({ isSystemAdmin: true });
      prisma.user.findMany.mockResolvedValue([]);

      await service.searchUsers('admin', 'bob');

      expect(whereOf()).toEqual({
        AND: [
          { email: { contains: 'bob', mode: 'insensitive' } },
          { id: { not: 'admin' } },
        ],
      });
      expect(JSON.stringify(whereOf())).not.toContain('spaceMembers');
    });

    it('returns [] if the requester no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.searchUsers('ghost', 'bob')).resolves.toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });
});
