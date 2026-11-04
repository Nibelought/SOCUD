import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: AuthDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) throw new ConflictException('Email already taken');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash },
      select: { id: true, email: true }, // Не возвращаем хэш пароля клиенту
    });

    return user;
  }

  async login(dto: AuthDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Invalid user data');

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Invalid user data');

    const payload = { sub: user.id, email: user.email };

    return {
      access_token: this.jwtService.sign(payload, { expiresIn: '15m' }),
      refresh_token: this.jwtService.sign(
        { sub: user.id },
        {
          expiresIn: '7d',
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        },
      ),
      user: { id: user.id, email: user.email },
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const secret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
      const payload = this.jwtService.verify(refreshToken, { secret });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException('User not found');

      const newPayload = { sub: user.id, email: user.email };
      return {
        access_token: this.jwtService.sign(newPayload, { expiresIn: '15m' }),
        refresh_token: this.jwtService.sign(
          { sub: user.id },
          { expiresIn: '7d', secret },
        ),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
