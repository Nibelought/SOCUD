import { Controller, Get, Post, Body, Patch, Param, Delete, Put, UseGuards, Request, ParseUUIDPipe, Query } from '@nestjs/common';
import { DocumentService } from './document.service';
import { CreateDocumentDto, UpdateDocumentDto, ManageDocumentMemberDto, PublishDocumentDto } from './dto/document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('document')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Request() req, @Body() createDocumentDto: CreateDocumentDto) {
    return this.documentService.create(createDocumentDto, req.user.id);
  }

  @Get('recent')
  @UseGuards(JwtAuthGuard)
  async getRecentActivity(@Request() req) {
    return this.documentService.findRecent(req.user.id);
  }

  @Get('graph')
  @UseGuards(JwtAuthGuard)
  async getGraph(@Request() req) {
    return this.documentService.getKnowledgeGraph(req.user.id);
  }

  @Get('search')
  @UseGuards(JwtAuthGuard)
  async search(@Request() req, @Query('q') query: string) {
    if (!query || query.trim().length === 0) return [];
    return this.documentService.hybridSearch(req.user.id, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentService.findOne(id, req.user.id);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  async getMembers(@Param('id') documentId: string, @Request() req) {
    return this.documentService.getMembersWithInheritance(
      documentId,
      req.user.id,
    );
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard)
  async addMember(
    @Param('id') documentId: string,
    @Body() dto: any,
    @Request() req,
  ) {
    // Метод upsertDocumentMember уже есть в твоем document.service.ts
    return this.documentService.upsertDocumentMember(
      documentId,
      req.user.id,
      dto,
    );
  }

  @Delete(':id/members/:userId')
  @UseGuards(JwtAuthGuard)
  async removeMember(
    @Param('id') documentId: string,
    @Param('userId') targetUserId: string,
    @Request() req,
  ) {
    return this.documentService.removeDocumentMember(
      documentId,
      req.user.id,
      targetUserId,
    );
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archiveDoc(@Param('id') id: string, @Request() req) {
    return this.documentService.archive(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updateDocument(
    @Param('id') id: string,
    @Body() dto: { title?: string },
    @Request() req,
  ) {
    return this.documentService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentService.remove(id, req.user.id);
  }

  // --- УПРАВЛЕНИЕ ГРАНУЛЯРНЫМИ ПРАВАМИ ---

  @Put(':id/members')
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

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  async publish(
    @Param('id') documentId: string,
    @Body() dto: PublishDocumentDto,
    @Request() req,
  ) {
    return this.documentService.publishDocument(documentId, req.user.id, dto);
  }
}