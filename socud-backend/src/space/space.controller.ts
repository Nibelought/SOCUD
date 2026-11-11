import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Param,
  Delete,
  Patch,
  HttpCode,
  HttpStatus,
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
import { CurrentUser } from '../auth/current-user';
import { RoleGuard } from '../permission/role.guard';
import { RequireRole } from '../permission/require-role.decorator';
import { Role } from '@prisma/client';
import {
  RestoreResponseDto,
  SuccessResponseDto,
} from '../common/dto/common.dto';
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
// JWT first (sets req.user), then RoleGuard, which enforces the @RequireRole() of each route.
// Routes without a space id (create, list, my) are JWT-only. The service methods repeat their
// checks as defence in depth (see RoleGuard); within a request the repeat costs no query.
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('space')
export class SpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a space; the caller becomes its OWNER' })
  @ApiCreatedResponse({ type: SpaceDto })
  @ApiErrors({ badRequest: true })
  async create(@Body() dto: CreateSpaceDto, @CurrentUser('id') userId: string) {
    return this.spaceService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Spaces the caller is a member of, with counts' })
  @ApiOkResponse({ type: [SpaceWithCountDto] })
  @ApiErrors()
  findAll(@CurrentUser('id') userId: string) {
    return this.spaceService.findAllForUser(userId);
  }

  @Get('my')
  @ApiOperation({
    summary: 'Non-archived spaces visible to the caller',
    description: 'System admins see every space.',
  })
  @ApiOkResponse({ type: [SpaceWithCountDto] })
  @ApiErrors()
  async getMySpaces(@CurrentUser('id') userId: string) {
    return this.spaceService.findMySpaces(userId);
  }

  @Get(':id')
  @RequireRole(Role.VIEWER, {
    resource: 'space',
    message: 'You do not have access to this space',
  })
  @ApiOperation({ summary: 'A space with its non-archived documents (VIEWER)' })
  @ApiOkResponse({ type: SpaceDetailDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.spaceService.findOne(id, userId);
  }

  @Patch(':id')
  @RequireRole(Role.EDITOR, {
    resource: 'space',
    message: 'Only OWNERs and EDITORs can update space details',
  })
  @ApiOperation({ summary: 'Rename / describe a space (EDITOR)' })
  @ApiOkResponse({ type: SpaceDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async updateSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpaceDto,
    @CurrentUser('id') userId: string,
  ) {
    // The service repeats the OWNER/EDITOR check, then runs prisma.space.update
    return this.spaceService.updateSpace(id, userId, dto);
  }

  @Delete(':id')
  @RequireRole(Role.OWNER, {
    resource: 'space',
    message: 'Only space OWNERs can hard delete this space',
  })
  @ApiOperation({
    summary: 'Permanently delete a space and its documents (OWNER)',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async deleteSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.spaceService.removeSpace(id, userId);
  }

  @Get(':id/members')
  @RequireRole(Role.VIEWER, {
    resource: 'space',
    message: 'You do not have access to this space',
  })
  @ApiOperation({ summary: 'Members of a space (VIEWER)' })
  @ApiOkResponse({ type: [SpaceMemberWithUserDto] })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async getSpaceMembers(
    @Param('id', ParseUUIDPipe) spaceId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.spaceService.getMembers(spaceId, userId);
  }

  @Post(':id/members')
  @RequireRole(Role.OWNER, {
    resource: 'space',
    message: 'Only space OWNERs can manage members',
  })
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
    @CurrentUser('id') userId: string,
  ) {
    return this.spaceService.upsertMember(spaceId, userId, dto);
  }

  @Delete(':id/members/:userId')
  @RequireRole(Role.OWNER, {
    resource: 'space',
    message: 'Only space OWNERs can manage members',
  })
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
    @CurrentUser('id') userId: string,
  ) {
    return this.spaceService.removeMember(spaceId, userId, targetUserId);
  }

  @Post(':id/archive')
  @RequireRole(Role.OWNER, {
    resource: 'space',
    message: 'Only space OWNERs can delete or archive this space',
  })
  @ApiOperation({ summary: 'Archive a space and its documents (OWNER)' })
  @ApiCreatedResponse({ type: SpaceDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async archiveSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.spaceService.archiveSpace(id, userId);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequireRole(Role.OWNER, {
    resource: 'space',
    message: 'Only space OWNERs can restore this space',
  })
  @ApiOperation({
    summary: 'Restore a space from the trash (OWNER)',
    description:
      'Restores the documents archived together with the space. 409 when the space is not archived.',
  })
  @ApiOkResponse({ type: RestoreResponseDto })
  @ApiErrors({
    badRequest: true,
    forbidden: true,
    notFound: true,
    conflict: true,
  })
  async restoreSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.spaceService.restoreSpace(id, userId);
  }
}
