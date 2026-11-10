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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceService } from './space.service';
import {
  CreateSpaceDto,
  ManageSpaceMemberDto,
  UpdateSpaceDto,
} from './dto/space.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuccessResponseDto } from '../common/dto/common.dto';
import { ApiErrors } from '../openapi/api-errors';
import { BEARER_SCHEME } from '../openapi/swagger';
import {
  SpaceDetailDto,
  SpaceDto,
  SpaceMemberDto,
  SpaceMemberWithUserDto,
  SpaceWithCountDto,
} from './dto/space-response.dto';

@ApiTags('space')
@ApiBearerAuth(BEARER_SCHEME)
@UseGuards(JwtAuthGuard) // Все методы требуют валидный JWT
@Controller('space')
export class SpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a space; the caller becomes its OWNER' })
  @ApiCreatedResponse({ type: SpaceDto })
  @ApiErrors({ badRequest: true })
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateSpaceDto, @Request() req) {
    // req.user.id гарантированно подставляется стратегией JWT из токена!
    return this.spaceService.create(dto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Spaces the caller is a member of, with counts' })
  @ApiOkResponse({ type: [SpaceWithCountDto] })
  @ApiErrors()
  findAll(@Req() req: any) {
    return this.spaceService.findAllForUser(req.user.id);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Non-archived spaces visible to the caller',
    description: 'System admins see every space.',
  })
  @ApiOkResponse({ type: [SpaceWithCountDto] })
  @ApiErrors()
  async getMySpaces(@Request() req) {
    return this.spaceService.findMySpaces(req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'A space with its non-archived documents (VIEWER)' })
  @ApiOkResponse({ type: SpaceDetailDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.spaceService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Rename / describe a space (EDITOR)' })
  @ApiOkResponse({ type: SpaceDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
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
  @ApiOperation({
    summary: 'Permanently delete a space and its documents (OWNER)',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async deleteSpace(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.spaceService.removeSpace(id, req.user.id);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Members of a space (VIEWER)' })
  @ApiOkResponse({ type: [SpaceMemberWithUserDto] })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async getSpaceMembers(
    @Param('id', ParseUUIDPipe) spaceId: string,
    @Request() req,
  ) {
    return this.spaceService.getMembers(spaceId, req.user.id);
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Add a member or change their role (OWNER)',
    description: 'The last OWNER cannot be demoted.',
  })
  @ApiCreatedResponse({ type: SpaceMemberDto })
  @ApiErrors({
    badRequest: true,
    forbidden: true,
    notFound: true,
    conflict: true,
  })
  async addSpaceMember(
    @Param('id', ParseUUIDPipe) spaceId: string,
    @Body() dto: ManageSpaceMemberDto,
    @Request() req,
  ) {
    return this.spaceService.upsertMember(spaceId, req.user.id, dto);
  }

  @Delete(':id/members/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Remove a member (OWNER)',
    description: 'The last OWNER cannot be removed.',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiErrors({
    badRequest: true,
    forbidden: true,
    notFound: true,
    conflict: true,
  })
  async removeSpaceMember(
    @Param('id', ParseUUIDPipe) spaceId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Request() req,
  ) {
    return this.spaceService.removeMember(spaceId, req.user.id, targetUserId);
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Archive a space and its documents (OWNER)' })
  @ApiCreatedResponse({ type: SpaceDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async archiveSpace(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.spaceService.archiveSpace(id, req.user.id);
  }
}
