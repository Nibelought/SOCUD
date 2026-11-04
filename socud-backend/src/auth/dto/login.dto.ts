import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from './email.transform';

/**
 * Login deliberately does not enforce the registration password policy:
 * accounts created before the policy tightened must still be able to log in.
 */
export class LoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Uncorrect format email' })
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
