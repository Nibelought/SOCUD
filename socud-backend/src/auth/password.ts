import * as bcrypt from 'bcrypt';

/** bcrypt cost factor for password hashes; shared by registration and the seed script. */
export const BCRYPT_ROUNDS = 10;

export const hashPassword = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_ROUNDS);
