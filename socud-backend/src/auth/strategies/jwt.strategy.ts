import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { rememberSystemAdmin } from '../../permission/request-memo';
import type { AuthUser } from '../current-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string }): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user)
      throw new UnauthorizedException('User not found or token invalid');

    // The flag is read from the database on every request (never taken from the token) and shared
    // with PermissionService for the rest of this request only, so revoking admin is immediate.
    rememberSystemAdmin(user.id, user.isSystemAdmin);

    // exposed to controllers as req.user
    return {
      id: user.id,
      email: user.email,
      isSystemAdmin: user.isSystemAdmin,
    };
  }
}
