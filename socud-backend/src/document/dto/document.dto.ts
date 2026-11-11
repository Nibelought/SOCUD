import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Role } from '@prisma/client';

export class CreateDocumentDto {
  @IsUUID('4')
  spaceId: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @IsString()
  title: string;
}

/** PATCH /document/:id accepts only the title; content goes through publish/Hocuspocus. */
export class UpdateDocumentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;
}

export class ManageDocumentMemberDto {
  @IsUUID('4')
  userId: string;

  @IsEnum(Role, { message: 'Role must be OWNER, EDITOR, or VIEWER' })
  role: Role;
}

export class PublishDocumentDto {
  /**
   * Optional and only a fallback: Publish renders the HTML from the document's Yjs state on the
   * server. Used (after sanitizing) only for documents that have no Yjs state yet.
   */
  @IsOptional()
  @IsString()
  html?: string;
}

export const GRAPH_DEFAULT_LIMIT = 2000;
export const GRAPH_MAX_LIMIT = 5000;

/** GET /document/graph query. */
export class GraphQueryDto {
  /** Maximum number of nodes; the most recently updated documents are kept. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(GRAPH_MAX_LIMIT)
  limit?: number;
}
