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
  Request,
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
@UseGuards(JwtAuthGuard)
@Controller('document')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a document in a space (EDITOR on the space)',
  })
  @ApiCreatedResponse({ type: DocumentDto })
  @ApiErrors({ badRequest: true, forbidden: true })
  @UseGuards(JwtAuthGuard)
  create(@Request() req, @Body() createDocumentDto: CreateDocumentDto) {
    return this.documentService.create(createDocumentDto, req.user.id);
  }

  @Get('recent')
  @ApiOperation({
    summary: 'The 5 most recently updated documents the caller can read',
  })
  @ApiOkResponse({ type: [RecentDocumentDto] })
  @ApiErrors()
  @UseGuards(JwtAuthGuard)
  async getRecentActivity(@Request() req) {
    return this.documentService.findRecent(req.user.id);
  }

  @Get('graph')
  @ApiOperation({
    summary: 'Link graph of the documents the caller can read',
    description: 'Nodes and links shaped for react-force-graph.',
  })
  @ApiOkResponse({ type: KnowledgeGraphDto })
  @ApiErrors()
  @UseGuards(JwtAuthGuard)
  async getGraph(@Request() req) {
    return this.documentService.getKnowledgeGraph(req.user.id);
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
  @UseGuards(JwtAuthGuard)
  async search(@Request() req, @Query('q') query: string) {
    if (!query || query.trim().length === 0) return [];
    return this.documentService.hybridSearch(req.user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a document (VIEWER)' })
  @ApiOkResponse({ type: DocumentViewDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentService.findOne(id, req.user.id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Direct and space-inherited members (VIEWER)' })
  @ApiOkResponse({ type: [DocumentMemberViewDto] })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async getMembers(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Request() req,
  ) {
    return this.documentService.getMembersWithInheritance(
      documentId,
      req.user.id,
    );
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member or change their role (OWNER)' })
  @ApiCreatedResponse({ type: DocumentMemberDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async addMember(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: ManageDocumentMemberDto,
    @Request() req,
  ) {
    return this.documentService.upsertDocumentMember(
      documentId,
      req.user.id,
      dto,
    );
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member (OWNER); idempotent' })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async removeMember(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Request() req,
  ) {
    return this.documentService.removeDocumentMember(
      documentId,
      req.user.id,
      targetUserId,
    );
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Move a document to the trash (OWNER)' })
  @ApiCreatedResponse({ type: DocumentDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async archiveDoc(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentService.archive(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a document (EDITOR)' })
  @ApiOkResponse({ type: DocumentDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async updateDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @Request() req,
  ) {
    return this.documentService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Permanently delete a document, also from the trash (OWNER)',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentService.remove(id, req.user.id);
  }

  // --- УПРАВЛЕНИЕ ГРАНУЛЯРНЫМИ ПРАВАМИ ---

  @Put(':id/members')
  @ApiOperation({
    summary: 'Add a member or change their role (OWNER); same as POST',
  })
  @ApiOkResponse({ type: DocumentMemberDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  upsertMember(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() manageMemberDto: ManageDocumentMemberDto,
  ) {
    return this.documentService.upsertDocumentMember(
      id,
      req.user.id,
      manageMemberDto,
    );
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Published versions, newest first (VIEWER)' })
  @ApiOkResponse({ type: [DocumentVersionSummaryDto] })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async listVersions(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentService.listVersions(id, req.user.id);
  }

  @Get(':id/versions/:version')
  @ApiOperation({ summary: 'One published version with its HTML (VIEWER)' })
  @ApiOkResponse({ type: DocumentVersionDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Request() req,
  ) {
    return this.documentService.getVersion(id, version, req.user.id);
  }

  @Post(':id/publish')
  @ApiOperation({
    summary: 'Publish the current document state as a new version (EDITOR)',
    description:
      'Renders the HTML from the server-side collaborative state; the body `html` is only a fallback for documents without one.',
  })
  @ApiCreatedResponse({ type: PublishResponseDto })
  @ApiErrors({ badRequest: true, forbidden: true, notFound: true })
  @UseGuards(JwtAuthGuard)
  async publish(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: PublishDocumentDto,
    @Request() req,
  ) {
    return this.documentService.publishDocument(documentId, req.user.id, dto);
  }
}
