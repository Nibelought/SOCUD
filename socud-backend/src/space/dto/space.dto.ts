import { IsString, IsOptional, MinLength } from 'class-validator';

export class CreateSpaceDto {
  @IsString()
  @MinLength(3)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}