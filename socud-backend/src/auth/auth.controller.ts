import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, IssuedRefreshToken } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

export const REFRESH_COOKIE_NAME = 'socud_refresh';
export const REFRESH_COOKIE_PATH = '/auth';

type AuthenticatedRequest = Request & { user: { id: string; email: string } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refresh, ...body } = await this.authService.login(dto);
    this.setRefreshCookie(res, refresh);
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { refresh, access_token } = await this.authService.refreshTokens(
        this.readRefreshCookie(req),
      );
      this.setRefreshCookie(res, refresh);
      return { access_token };
    } catch (err) {
      if (err instanceof UnauthorizedException) this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      await this.authService.logout(this.readRefreshCookie(req));
    } finally {
      this.clearRefreshCookie(res);
    }
  }

  @Get('users/search')
  @UseGuards(JwtAuthGuard)
  searchUsers(
    @Req() req: AuthenticatedRequest,
    @Query() query: SearchUsersDto,
  ) {
    return this.authService.searchUsers(req.user.id, query.email);
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, refresh: IssuedRefreshToken) {
    res.cookie(REFRESH_COOKIE_NAME, refresh.token, {
      ...this.cookieOptions(),
      // Follows the token's own expiry, which is capped by the session lifetime.
      maxAge: Math.max(0, refresh.expiresAt.getTime() - Date.now()),
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }
}
