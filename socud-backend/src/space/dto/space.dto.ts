import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsUUID,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';

export class CreateSpaceDto {
  @IsString()
  @MinLength(3)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateSpaceDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class ManageSpaceMemberDto {
  @IsUUID('4')
  userId: string;

  @IsEnum(Role, { message: 'Role must be OWNER, EDITOR, or VIEWER' })
  role: Role;
}
