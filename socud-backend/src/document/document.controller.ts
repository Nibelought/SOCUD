import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  UseGuards,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { DocumentService } from './document.service';
import {
  CreateDocumentDto,
  ManageDocumentMemberDto,
  PublishDocumentDto,
  UpdateDocumentDto,
} from './dto/document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user';
import { RoleGuard } from '../permission/role.guard';
import { RequireRole } from '../permission/require-role.decorator';
import { Role } from '@prisma/client';
import { SearchService } from '../search/search.service';
import { SuccessResponseDto } from '../common/dto/common.dto';
import { ApiErrors } from '../openapi/api-errors';
import { BEARER_SCHEME } from '../openapi/swagger';
import {
  DocumentDto,
  DocumentMemberDto,
  DocumentMemberViewDto,
  DocumentVersionDto,
  DocumentVersionSummaryDto,
  DocumentViewDto,
  KnowledgeGraphDto,
  PublishResponseDto,
  RecentDocumentDto,
  SearchResultDto,
} from './dto/document-response.dto';

@ApiTags('document')
@ApiBearerAuth(BEARER_SCHEME)
// JWT first (sets req.user), then RoleGuard, which enforces the @RequireRole() of each route.
// Routes without a resource id (create aside, see below) are JWT-only. The service methods repeat
// their checks as defence in depth (see RoleGuard); within a request the repeat costs no query.
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('document')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly searchService: SearchService,
  ) {}

  @Post()
  @RequireRole(Role.EDITOR, {
    resource: 'space',
    from: 'body',
    param: 'spaceId',
  })
  @ApiOperation({
    summary: 'Create a document in a space (EDITOR on the space)',
  })
  @ApiCreatedResponse({ type: DocumentDto })
  @ApiErrors({ badRequest: true, forbidden: true })
  create(
    @CurrentUser('id') userId: string,
    @Body() createDocumentDto: CreateDocumentDto,
  ) {
    return this.documentService.create(createDocumentDto, userId);
  }

  @Get('recent')
  @ApiOperation({
    summary: 'The 5 most recently updated documents the caller can read',
  })
  @ApiOkResponse({ type: [RecentDocumentDto] })
  @ApiErrors()
  async getRecentActivity(@CurrentUser('id') userId: string) {
    return this.documentService.findRecent(userId);
  }

  @Get('graph')
  @ApiOperation({
    summary: 'Link graph of the documents the caller can read',
    description: 'Nodes and links shaped for react-force-graph.',
  })
  @ApiOkResponse({ type: KnowledgeGraphDto })
  @ApiErrors()
  async getGraph(@CurrentUser('id') userId: string) {
    return this.documentService.getKnowledgeGraph(userId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search documents the caller can read' })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Search text; blank returns []',
  })
  @ApiOkResponse({ type: [SearchResultDto] })
  @ApiErrors()
  async search(@CurrentUser('id') userId: string, @Query('q') query: string) {
    if (!query || query.trim().length === 0) return [];
    return this.searchService.search(userId, query);
  }

  @Get(':id')
  @RequireRole(Role.VIEWER, { resource: 'document' })
  @ApiOperation({ summary: 'Read a document (VIEWER)' })
  @ApiOkResponse({ type: DocumentViewDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.findOne(id, userId);
  }

  @Get(':id/members')
  @RequireRole(Role.VIEWER, { resource: 'document' })
  @ApiOperation({ summary: 'Direct and space-inherited members (VIEWER)' })
  @ApiOkResponse({ type: [DocumentMemberViewDto] })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async getMembers(
    @Param('id', ParseUUIDPipe) documentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.getMembersWithInheritance(documentId, userId);
  }

  @Post(':id/members')
  @RequireRole(Role.OWNER, { resource: 'document' })
  @ApiOperation({ summary: 'Add a member or change their role (OWNER)' })
  @ApiCreatedResponse({ type: DocumentMemberDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async addMember(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: ManageDocumentMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.upsertDocumentMember(documentId, userId, dto);
  }

  @Delete(':id/members/:userId')
  @RequireRole(Role.OWNER, { resource: 'document' })
  @ApiOperation({ summary: 'Remove a member (OWNER); idempotent' })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async removeMember(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.removeDocumentMember(
      documentId,
      userId,
      targetUserId,
    );
  }

  @Post(':id/archive')
  @RequireRole(Role.OWNER, { resource: 'document' })
  @ApiOperation({ summary: 'Move a document to the trash (OWNER)' })
  @ApiCreatedResponse({ type: DocumentDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async archiveDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.archive(id, userId);
  }

  @Patch(':id')
  @RequireRole(Role.EDITOR, { resource: 'document' })
  @ApiOperation({ summary: 'Rename a document (EDITOR)' })
  @ApiOkResponse({ type: DocumentDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async updateDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.update(id, userId, dto);
  }

  @Delete(':id')
  // includeArchived: the trash is reachable for hard delete (OWNERs only).
  @RequireRole(Role.OWNER, {
    resource: 'document',
    includeArchived: true,
    message: 'Only OWNERs can hard delete this document',
  })
  @ApiOperation({
    summary: 'Permanently delete a document, also from the trash (OWNER)',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.remove(id, userId);
  }

  // --- УПРАВЛЕНИЕ ГРАНУЛЯРНЫМИ ПРАВАМИ ---

  @Put(':id/members')
  @RequireRole(Role.OWNER, { resource: 'document' })
  @ApiOperation({
    summary: 'Add a member or change their role (OWNER); same as POST',
  })
  @ApiOkResponse({ type: DocumentMemberDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  upsertMember(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() manageMemberDto: ManageDocumentMemberDto,
  ) {
    return this.documentService.upsertDocumentMember(
      id,
      userId,
      manageMemberDto,
    );
  }

  @Get(':id/versions')
  @RequireRole(Role.VIEWER, { resource: 'document' })
  @ApiOperation({ summary: 'Published versions, newest first (VIEWER)' })
  @ApiOkResponse({ type: [DocumentVersionSummaryDto] })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async listVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.listVersions(id, userId);
  }

  @Get(':id/versions/:version')
  @RequireRole(Role.VIEWER, { resource: 'document' })
  @ApiOperation({ summary: 'One published version with its HTML (VIEWER)' })
  @ApiOkResponse({ type: DocumentVersionDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.getVersion(id, version, userId);
  }

  @Post(':id/publish')
  @RequireRole(Role.EDITOR, { resource: 'document' })
  @ApiOperation({
    summary: 'Publish the current document state as a new version (EDITOR)',
    description:
      'Renders the HTML from the server-side collaborative state; the body `html` is only a fallback for documents without one.',
  })
  @ApiCreatedResponse({ type: PublishResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  async publish(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: PublishDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.publishDocument(documentId, userId, dto);
  }
}
