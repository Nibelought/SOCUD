import { IsString, IsOptional, IsUUID, IsEnum, IsBoolean, IsNotEmpty  } from 'class-validator';
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

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  contentHtml?: string;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @IsOptional()
  @IsUUID('4')
  parentId?: string;
}

export class ManageDocumentMemberDto {
  @IsUUID('4')
  userId: string;

  @IsEnum(Role, { message: 'Role must be OWNER, EDITOR, or VIEWER' })
  role: Role;
}

export class PublishDocumentDto {
  @IsString()
  @IsNotEmpty()
  html: string;
}
