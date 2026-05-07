import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = { id: 'user-123', email: 'test@example.com', passwordHash: 'hashed_password' };
  const authDto = { email: 'test@mock.com', password: 'password123' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
          } as any,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock_token'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-123', email: authDto.email });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');

      const result = await service.register(authDto);

      expect(result).toEqual({ id: 'user-123', email: authDto.email });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: authDto.email, passwordHash: 'hashed_password' },
        select: { id: true, email: true },
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(service.register(authDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return access_token and user if credentials are valid', async () => {
      const userWithHash = { ...mockUser, passwordHash: 'hashedCRPYTED_password' };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(userWithHash);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(authDto);

      expect(result).toEqual({
        access_token: 'mock_token',
        user: { id: mockUser.id, email: mockUser.email },
      });
    });

    it('should throw UnauthorizedException if user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login(authDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is incorrect', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, passwordHash: 'correct_hash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(authDto)).rejects.toThrow(UnauthorizedException);
    });
  });
});
