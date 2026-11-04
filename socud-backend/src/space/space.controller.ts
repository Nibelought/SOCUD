import { Controller, Post, Get, Body, UseGuards, Req, Request, Param, Delete, Patch } from '@nestjs/common';
import { SpaceService } from './space.service';
import { CreateSpaceDto } from './dto/space.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard) // Все методы требуют валидный JWT
@Controller('space')
export class SpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateSpaceDto, @Request() req) {
    // req.user.id гарантированно подставляется стратегией JWT из токена!
    return this.spaceService.create(dto, req.user.id);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.spaceService.findAllForUser(req.user.id);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMySpaces(@Request() req) {
    return this.spaceService.findMySpaces(req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string, @Request() req) {
    return this.spaceService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updateSpace(
    @Param('id') id: string,
    @Body() dto: { title?: string; description?: string },
    @Request() req,
  ) {
    // В сервисе: проверка прав OWNER/EDITOR, затем prisma.space.update
    return this.spaceService.updateSpace(id, req.user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteSpace(@Param('id') id: string, @Request() req) {
    return this.spaceService.removeSpace(id, req.user.id);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  async getSpaceMembers(@Param('id') spaceId: string, @Request() req) {
    return this.spaceService['prisma'].spaceMember.findMany({
      where: { spaceId },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard)
  async addSpaceMember(
    @Param('id') spaceId: string,
    @Body() dto: { userId: string; role: any },
    @Request() req,
  ) {
    // Требуется права OWNER пространства (реализуй проверку в сервисе)
    return this.spaceService['prisma'].spaceMember.upsert({
      where: { userId_spaceId: { userId: dto.userId, spaceId } },
      update: { role: dto.role },
      create: { userId: dto.userId, spaceId, role: dto.role },
    });
  }

  @Delete(':id/members/:userId')
  @UseGuards(JwtAuthGuard)
  async removeSpaceMember(
    @Param('id') spaceId: string,
    @Param('userId') targetUserId: string,
    @Request() req,
  ) {
    return this.spaceService['prisma'].spaceMember.delete({
      where: { userId_spaceId: { userId: targetUserId, spaceId } },
    });
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archiveSpace(@Param('id') id: string, @Request() req) {
    return this.spaceService.archiveSpace(id, req.user.id);
  }
}