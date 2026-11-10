import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
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
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
