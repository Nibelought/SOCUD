import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Request,
  Param,
  Delete,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SpaceService } from './space.service';
import {
  CreateSpaceDto,
  ManageSpaceMemberDto,
  UpdateSpaceDto,
} from './dto/space.dto';
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
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.spaceService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updateSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpaceDto,
    @Request() req,
  ) {
    // В сервисе: проверка прав OWNER/EDITOR, затем prisma.space.update
    return this.spaceService.updateSpace(id, req.user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteSpace(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.spaceService.removeSpace(id, req.user.id);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  async getSpaceMembers(
    @Param('id', ParseUUIDPipe) spaceId: string,
    @Request() req,
  ) {
    return this.spaceService.getMembers(spaceId, req.user.id);
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard)
  async addSpaceMember(
    @Param('id', ParseUUIDPipe) spaceId: string,
    @Body() dto: ManageSpaceMemberDto,
    @Request() req,
  ) {
    return this.spaceService.upsertMember(spaceId, req.user.id, dto);
  }

  @Delete(':id/members/:userId')
  @UseGuards(JwtAuthGuard)
  async removeSpaceMember(
    @Param('id', ParseUUIDPipe) spaceId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Request() req,
  ) {
    return this.spaceService.removeMember(spaceId, req.user.id, targetUserId);
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archiveSpace(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.spaceService.archiveSpace(id, req.user.id);
  }
}
