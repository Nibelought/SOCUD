import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { normalizeEmail } from './dto/email.transform';

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Absolute lifetime of a login session (token family), regardless of rotation. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A just-rotated token may be presented again (e.g. by another tab) for this long. */
export const ROTATION_GRACE_MS = 30_000;
export const ACCESS_TOKEN_TTL = '15m';
export const SEARCH_RESULT_LIMIT = 10;

/** Valid bcrypt hash of a random string; compared against when the user is unknown to equalise timing. */
const DUMMY_PASSWORD_HASH =
  '$2b$10$ypz5eZnU0UUvZ.ScmTh.Uep34LI4TR/Y3upr9NMLh8VyeVC/5sY76';

export const hashRefreshToken = (raw: string): string =>
  createHash('sha256').update(raw).digest('hex');

/**
 * Prisma's case-insensitive filters compile to ILIKE without escaping, so `%` and `_`
 * in user input act as wildcards (e.g. `%%%` would match every email).
 */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);

    // Case-insensitive so legacy mixed-case accounts also block duplicates.
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingUser) throw new ConflictException('Email already taken');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    try {
      return await this.prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true }, // Не возвращаем хэш пароля клиенту
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Email already taken');
      }
      throw err;
    }
  }

  async login(dto: LoginDto) {
    const email = normalizeEmail(dto.email);

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Accounts registered before emails were lowercased may be mixed-case.
      user = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
    }

    const isValid = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !isValid) throw new UnauthorizedException('Invalid user data');

    // Opportunistic cleanup of this user's long-expired tokens.
    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    const refresh = await this.issueRefreshToken(user.id, randomUUID(), {
      sessionExpiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
    });

    return {
      access_token: this.signAccessToken(user),
      user: { id: user.id, email: user.email },
      refresh,
    };
  }

  /**
   * Rotates a refresh token: the presented token is marked rotated and a successor in
   * the same family is issued. Two tabs sharing one cookie routinely refresh at the same
   * time, so a rotated token is still accepted for {@link ROTATION_GRACE_MS} (each such
   * request gets its own fresh token). Presenting a revoked token, or a rotated token
   * after the grace window, is treated as theft and revokes the whole family.
   */
  async refreshTokens(rawToken: string | undefined) {
    if (!rawToken) throw new UnauthorizedException('Invalid refresh token');

    const tokenHash = hashRefreshToken(rawToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record) throw new UnauthorizedException('Invalid refresh token');

    if (record.revokedAt) return this.rejectReuse(record.familyId);

    const nowMs = Date.now();
    if (
      record.expiresAt.getTime() <= nowMs ||
      record.sessionExpiresAt.getTime() <= nowMs
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
    });
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    let rotatedAt = record.rotatedAt;
    let refresh: IssuedRefreshToken | null = null;

    if (!rotatedAt) {
      // Atomic claim: only one concurrent request can flip rotatedAt from null.
      refresh = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.refreshToken.updateMany({
          where: { id: record.id, rotatedAt: null, revokedAt: null },
          data: { rotatedAt: new Date(nowMs) },
        });
        if (claimed.count !== 1) return null;
        return this.issueRefreshToken(user.id, record.familyId, {
          sessionExpiresAt: record.sessionExpiresAt,
          db: tx,
        });
      });

      if (!refresh) {
        // Lost the claim: someone else rotated (or revoked) it a moment ago.
        const current = await this.prisma.refreshToken.findUnique({
          where: { tokenHash },
        });
        if (!current || current.revokedAt) {
          return this.rejectReuse(record.familyId);
        }
        rotatedAt = current.rotatedAt;
      }
    }

    if (!refresh) {
      if (!rotatedAt || nowMs - rotatedAt.getTime() > ROTATION_GRACE_MS) {
        return this.rejectReuse(record.familyId);
      }
      // Concurrent refresh with the same token: hand out another token, revoke nothing.
      refresh = await this.issueRefreshToken(user.id, record.familyId, {
        sessionExpiresAt: record.sessionExpiresAt,
      });
    }

    return { access_token: this.signAccessToken(user), refresh };
  }

  /** Revokes the family of the presented token. Unknown tokens are ignored. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
      select: { familyId: true },
    });
    if (record) await this.revokeFamily(record.familyId);
  }

  /**
   * Users the requester may discover: people sharing at least one space with them,
   * plus an exact (case-insensitive) email match so new people can still be invited
   * by full address. System admins search everyone.
   */
  async searchUsers(requesterId: string, fragment: string) {
    const trimmed = fragment.trim();
    if (trimmed.length < 3) return [];
    const query = escapeLike(trimmed);

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { isSystemAdmin: true },
    });
    if (!requester) return [];

    const emailContains: Prisma.UserWhereInput = {
      email: { contains: query, mode: 'insensitive' },
    };

    const visibility: Prisma.UserWhereInput = requester.isSystemAdmin
      ? emailContains
      : {
          OR: [
            {
              AND: [
                emailContains,
                {
                  spaceMembers: {
                    some: {
                      space: { members: { some: { userId: requesterId } } },
                    },
                  },
                },
              ],
            },
            { email: { equals: query, mode: 'insensitive' } },
          ],
        };

    return this.prisma.user.findMany({
      where: { AND: [visibility, { id: { not: requesterId } }] },
      select: { id: true, email: true },
      orderBy: { email: 'asc' },
      take: SEARCH_RESULT_LIMIT,
    });
  }

  private signAccessToken(user: { id: string; email: string }) {
    return this.jwtService.sign(
      { sub: user.id, email: user.email },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  private async issueRefreshToken(
    userId: string,
    familyId: string,
    opts: {
      sessionExpiresAt: Date;
      db?: Pick<PrismaService, 'refreshToken'>;
    },
  ): Promise<IssuedRefreshToken> {
    const db = opts.db ?? this.prisma;
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Math.min(
        Date.now() + REFRESH_TOKEN_TTL_MS,
        opts.sessionExpiresAt.getTime(),
      ),
    );
    await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashRefreshToken(token),
        expiresAt,
        sessionExpiresAt: opts.sessionExpiresAt,
      },
    });
    return { token, expiresAt };
  }

  private async rejectReuse(familyId: string): Promise<never> {
    await this.revokeFamily(familyId);
    throw new UnauthorizedException('Invalid refresh token');
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
