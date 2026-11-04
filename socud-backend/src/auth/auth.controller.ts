import { Controller, Post, Body, Get, UseGuards, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: AuthDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: AuthDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  async refresh(@Body('refresh_token') refreshToken: string) {
    return this.authService.refreshTokens(refreshToken);
  }
  
  @Get('users/search')
  @UseGuards(JwtAuthGuard)
  async searchUsers(@Query('email') email: string) {
    if (!email || email.length < 3) return [];
    // В AuthModule нужно импортировать PrismaService, если его там нет
    return this.authService['prisma'].user.findMany({
      where: { email: { contains: email, mode: 'insensitive' } },
      select: { id: true, email: true },
      take: 10,
    });
  }
}