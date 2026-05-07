import { IsEmail, IsString, MinLength } from 'class-validator';

export class AuthDto {
  @IsEmail({}, { message: 'Uncorrect format email' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'Password must be minimum 6 length' })
  password: string;
}