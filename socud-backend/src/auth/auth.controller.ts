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
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService, IssuedRefreshToken } from './auth.service';
import { UserSummaryDto } from '../common/dto/common.dto';
import { ApiErrors } from '../openapi/api-errors';
import { BEARER_SCHEME, REFRESH_COOKIE_SCHEME } from '../openapi/swagger';
import {
  AccessTokenResponseDto,
  LoginResponseDto,
} from './dto/auth-response.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedRequest } from './current-user';

export const REFRESH_COOKIE_NAME = 'socud_refresh';
export const REFRESH_COOKIE_PATH = '/auth';
/**
 * Non-sensitive "has a session" hint (value `1`) for the web app's proxy, which cannot see the
 * refresh cookie (path /auth, httpOnly). Set and cleared together with the refresh cookie. It is
 * not a credential: the API authenticates with the access token / refresh cookie only.
 */
export const SESSION_COOKIE_NAME = 'socud_session';

const SET_COOKIE_HEADERS = {
  'Set-Cookie': {
    description:
      'Rotated httpOnly `socud_refresh` cookie (path /auth) and the readable `socud_session=1` hint cookie.',
    schema: { type: 'string' },
  },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Create an account' })
  @ApiCreatedResponse({ type: UserSummaryDto })
  @ApiErrors({ badRequest: true, unauthorized: false, conflict: true })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Returns the access token; the refresh token is set as an httpOnly cookie.',
  })
  @ApiOkResponse({ type: LoginResponseDto, headers: SET_COOKIE_HEADERS })
  @ApiErrors({ badRequest: true })
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
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a new access token',
    description:
      'Rotates the refresh cookie. A missing, expired or reused token yields 401 and clears the cookies.',
  })
  @ApiCookieAuth(REFRESH_COOKIE_SCHEME)
  @ApiOkResponse({ type: AccessTokenResponseDto, headers: SET_COOKIE_HEADERS })
  @ApiErrors()
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
  @ApiOperation({
    summary: 'Sign out',
    description:
      'Revokes the session of the presented refresh cookie and clears the cookies. Always succeeds.',
  })
  @ApiCookieAuth(REFRESH_COOKIE_SCHEME)
  @ApiNoContentResponse({ description: 'Signed out' })
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
  @ApiOperation({
    summary: 'Find users to invite',
    description:
      'Users sharing a space with the caller plus an exact email match; system admins see everyone. At most 10 results.',
  })
  @ApiBearerAuth(BEARER_SCHEME)
  @ApiOkResponse({ type: [UserSummaryDto] })
  @ApiErrors({ badRequest: true })
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

  /** Readable by the web app's proxy: lax so links from other sites still arrive signed in. */
  private sessionCookieOptions(): CookieOptions {
    const domain = this.config.get<string>('SESSION_COOKIE_DOMAIN');
    return {
      httpOnly: false,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  private setRefreshCookie(res: Response, refresh: IssuedRefreshToken) {
    // Follows the token's own expiry, which is capped by the session lifetime.
    const maxAge = Math.max(0, refresh.expiresAt.getTime() - Date.now());
    res.cookie(REFRESH_COOKIE_NAME, refresh.token, {
      ...this.cookieOptions(),
      maxAge,
    });
    res.cookie(SESSION_COOKIE_NAME, '1', {
      ...this.sessionCookieOptions(),
      maxAge,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
    res.clearCookie(SESSION_COOKIE_NAME, this.sessionCookieOptions());
  }
}
