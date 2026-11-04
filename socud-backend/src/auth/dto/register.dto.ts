import { IsByteLength, IsEmail, IsString, MinLength } from 'class-validator';
import { NormalizeEmail } from './email.transform';

/** bcrypt silently ignores everything beyond 72 bytes, so reject longer input. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 10;

export class RegisterDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Uncorrect format email' })
  email: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Password must be minimum ${PASSWORD_MIN_LENGTH} length`,
  })
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `Password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  })
  password: string;
}
