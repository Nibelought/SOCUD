import { Transform } from 'class-transformer';

/** Canonical form used for storing and comparing emails: trimmed + lowercase. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

/** class-transformer decorator applying {@link normalizeEmail} to string inputs. */
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );
