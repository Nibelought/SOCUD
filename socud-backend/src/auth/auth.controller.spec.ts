import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AuthController,
  REFRESH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from './auth.controller';
import { AuthService } from './auth.service';
import { createConfigServiceMock } from '../test-utils/mocks';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    refreshTokens: jest.Mock;
    logout: jest.Mock;
    register: jest.Mock;
    searchUsers: jest.Mock;
  };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  const NOW = 1_800_000_000_000;
  const expiresAt = new Date(NOW + 7 * 24 * 60 * 60 * 1000);
  const reqWith = (cookies?: Record<string, string>) =>
    ({ cookies }) as unknown as Request;

  const build = async (env: Record<string, unknown> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: createConfigServiceMock(env) },
      ],
    }).compile();
    controller = module.get(AuthController);
  };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refreshTokens: jest.fn(),
      logout: jest.fn(),
      register: jest.fn(),
      searchUsers: jest.fn(),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    await build();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('login sets the httpOnly refresh cookie and keeps the token out of the body', async () => {
    authService.login.mockResolvedValue({
      access_token: 'acc',
      user: { id: 'u1', email: 'a@b.co' },
      refresh: { token: 'raw-rt', expiresAt },
    });

    const body = await controller.login(
      { email: 'a@b.co', password: 'x' },
      res as unknown as Response,
    );

    expect(body).toEqual({
      access_token: 'acc',
      user: { id: 'u1', email: 'a@b.co' },
    });
    expect(JSON.stringify(body)).not.toContain('raw-rt');
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'raw-rt', {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('caps the cookie lifetime at the token expiry (session cap)', async () => {
    authService.login.mockResolvedValue({
      access_token: 'acc',
      user: { id: 'u1', email: 'a@b.co' },
      refresh: { token: 'raw-rt', expiresAt: new Date(NOW + 3_600_000) },
    });

    await controller.login(
      { email: 'a@b.co', password: 'x' },
      res as unknown as Response,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'raw-rt',
      expect.objectContaining({ maxAge: 3_600_000 }),
    );
  });

  it('marks the cookie secure in production', async () => {
    await build({ NODE_ENV: 'production' });
    authService.login.mockResolvedValue({
      access_token: 'acc',
      user: { id: 'u1', email: 'a@b.co' },
      refresh: { token: 'raw-rt', expiresAt },
    });

    await controller.login(
      { email: 'a@b.co', password: 'x' },
      res as unknown as Response,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'raw-rt',
      expect.objectContaining({ secure: true }),
    );
  });

  it('refresh reads the cookie, rotates it and returns only the access token', async () => {
    authService.refreshTokens.mockResolvedValue({
      access_token: 'acc2',
      refresh: { token: 'rt2', expiresAt },
    });

    const body = await controller.refresh(
      reqWith({ [REFRESH_COOKIE_NAME]: 'rt1' }),
      res as unknown as Response,
    );

    expect(authService.refreshTokens).toHaveBeenCalledWith('rt1');
    expect(body).toEqual({ access_token: 'acc2' });
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'rt2',
      expect.objectContaining({ httpOnly: true, path: '/auth' }),
    );
  });

  it('refresh clears the cookie and rethrows 401 when the token is rejected', async () => {
    authService.refreshTokens.mockRejectedValue(new UnauthorizedException());

    await expect(
      controller.refresh(reqWith(), res as unknown as Response),
    ).rejects.toThrow(UnauthorizedException);

    expect(authService.refreshTokens).toHaveBeenCalledWith(undefined);
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.objectContaining({ path: '/auth', httpOnly: true }),
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('logout revokes the presented token and clears the cookie', async () => {
    authService.logout.mockResolvedValue(undefined);

    await controller.logout(
      reqWith({ [REFRESH_COOKIE_NAME]: 'rt1' }),
      res as unknown as Response,
    );

    expect(authService.logout).toHaveBeenCalledWith('rt1');
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.objectContaining({ path: '/auth' }),
    );
  });

  it('logout works without any cookie', async () => {
    authService.logout.mockResolvedValue(undefined);

    await controller.logout(reqWith(), res as unknown as Response);

    expect(authService.logout).toHaveBeenCalledWith(undefined);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  describe('socud_session hint cookie (read by the web app proxy)', () => {
    const loginResult = {
      access_token: 'acc',
      user: { id: 'u1', email: 'a@b.co' },
      refresh: { token: 'raw-rt', expiresAt },
    };
    const dto = { email: 'a@b.co', password: 'x' };

    it('is set on login: readable, lax, site-wide, same lifetime, carries no token', async () => {
      authService.login.mockResolvedValue(loginResult);

      await controller.login(dto, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, '1', {
        httpOnly: false,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    });

    it('is refreshed on refresh', async () => {
      authService.refreshTokens.mockResolvedValue({
        access_token: 'acc2',
        refresh: { token: 'rt2', expiresAt },
      });

      await controller.refresh(
        reqWith({ [REFRESH_COOKIE_NAME]: 'rt1' }),
        res as unknown as Response,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        '1',
        expect.objectContaining({ httpOnly: false, path: '/' }),
      );
    });

    it('is secure in production and honours SESSION_COOKIE_DOMAIN', async () => {
      await build({
        NODE_ENV: 'production',
        SESSION_COOKIE_DOMAIN: '.example.com',
      });
      authService.login.mockResolvedValue(loginResult);

      await controller.login(dto, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        '1',
        expect.objectContaining({ secure: true, domain: '.example.com' }),
      );
    });

    it('is cleared on logout', async () => {
      authService.logout.mockResolvedValue(undefined);

      await controller.logout(reqWith(), res as unknown as Response);

      expect(res.clearCookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.objectContaining({ path: '/', httpOnly: false }),
      );
    });

    it('is cleared when refresh is rejected (so a stale hint cannot loop the UI)', async () => {
      authService.refreshTokens.mockRejectedValue(new UnauthorizedException());

      await expect(
        controller.refresh(reqWith(), res as unknown as Response),
      ).rejects.toThrow(UnauthorizedException);

      expect(res.clearCookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.objectContaining({ path: '/' }),
      );
    });
  });

  it('searchUsers passes the requester id and fragment to the service', async () => {
    authService.searchUsers.mockResolvedValue([{ id: 'u2', email: 'x@y.z' }]);

    const result = await controller.searchUsers(
      { user: { id: 'me', email: 'me@y.z' } } as never,
      { email: 'x@y' },
    );

    expect(authService.searchUsers).toHaveBeenCalledWith('me', 'x@y');
    expect(result).toEqual([{ id: 'u2', email: 'x@y.z' }]);
  });
});
