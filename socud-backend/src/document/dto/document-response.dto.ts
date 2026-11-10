import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { UserSummaryDto } from '../../common/dto/common.dto';

/** `{ name }` of the space a document lives in. */
export class DocumentSpaceNameDto {
  @ApiProperty()
  name: string;
}

/**
 * A document as stored (raw row; POST /document, PATCH /document/:id, POST /document/:id/archive).
 * `yjsState` is the collaborative state: it is null for new documents but is serialised as
 * `{ type: 'Buffer', data: number[] }` once the editor has saved, which makes update/archive
 * responses large. Clients should not rely on it.
 */
export class DocumentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  spaceId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  contentHtml: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: Object,
    additionalProperties: true,
    description:
      'Raw Yjs state (JSON-serialised Buffer). Internal; do not rely on it.',
  })
  yjsState?: Record<string, unknown> | null;

  @ApiProperty({ format: 'uuid' })
  createdBy: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  updatedBy: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty()
  isArchived: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt: Date | null;
}

/** GET /document/:id: the fields the read-only view needs. */
export class DocumentViewDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  contentHtml: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: () => DocumentSpaceNameDto })
  space: DocumentSpaceNameDto;
}

/** GET /document/recent item. */
export class RecentDocumentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ format: 'uuid' })
  createdBy: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  updatedBy: string | null;

  @ApiProperty({ type: () => DocumentSpaceNameDto })
  space: DocumentSpaceNameDto;
}

export class GraphNodeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** Document title. */
  @ApiProperty()
  name: string;

  /** Space id, used to colour nodes by space. */
  @ApiProperty({ format: 'uuid' })
  group: string;

  @ApiProperty()
  spaceName: string;
}

export class GraphLinkDto {
  @ApiProperty({ format: 'uuid' })
  source: string;

  @ApiProperty({ format: 'uuid' })
  target: string;
}

/** GET /document/graph, shaped for react-force-graph. */
export class KnowledgeGraphDto {
  @ApiProperty({ type: () => [GraphNodeDto] })
  nodes: GraphNodeDto[];

  @ApiProperty({ type: () => [GraphLinkDto] })
  links: GraphLinkDto[];
}

/** GET /document/search item. */
export class SearchResultDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  /** Space name; may be absent for keyword hits. */
  @ApiProperty({ required: false })
  space?: string;

  @ApiProperty()
  snippet: string;

  @ApiProperty({ enum: ['semantic', 'keyword'] })
  type: 'semantic' | 'keyword';

  /** Similarity in 0..1 for semantic hits, null for keyword hits. */
  @ApiProperty({ type: Number, nullable: true })
  score: number | null;
}

export class DocumentMemberDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  documentId: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;
}

/** GET /document/:id/members: direct members plus those inherited from the space. */
export class DocumentMemberViewDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;

  @ApiProperty({ type: () => UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ enum: ['direct', 'inherited'] })
  source: 'direct' | 'inherited';
}

/** POST /document/:id/publish. */
export class PublishResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty()
  message: string;

  /** Number of the version that was just published. */
  @ApiProperty()
  version: number;

  @ApiProperty()
  extractedLinksCount: number;

  /** False when Redis was unavailable; the embedding is picked up later by the reconcile job. */
  @ApiProperty()
  embeddingQueued: boolean;
}

/** GET /document/:id/versions item (newest first). */
export class DocumentVersionSummaryDto {
  @ApiProperty()
  version: number;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: () => UserSummaryDto })
  author: UserSummaryDto;
}

/** GET /document/:id/versions/:version. */
export class DocumentVersionDto extends DocumentVersionSummaryDto {
  @ApiProperty()
  contentHtml: string;
}
