import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';
import { SearchUsersDto } from './search-users.dto';

const errorsFor = async <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) => {
  const inst = plainToInstance(cls, plain);
  const errors = await validate(inst, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { inst, props: errors.map((e) => e.property) };
};

describe('RegisterDto', () => {
  const ok = { email: 'a@b.co', password: 'abcdefghij' };

  it('accepts a 10-character password', async () => {
    expect((await errorsFor(RegisterDto, ok)).props).toEqual([]);
  });

  it('rejects passwords shorter than 10', async () => {
    const { props } = await errorsFor(RegisterDto, {
      ...ok,
      password: 'abcdefghi',
    });
    expect(props).toEqual(['password']);
  });

  it('accepts exactly 72 bytes and rejects 73', async () => {
    expect(
      (await errorsFor(RegisterDto, { ...ok, password: 'a'.repeat(72) })).props,
    ).toEqual([]);
    expect(
      (await errorsFor(RegisterDto, { ...ok, password: 'a'.repeat(73) })).props,
    ).toEqual(['password']);
  });

  it('counts bytes, not characters (multi-byte characters)', async () => {
    // 37 x 2-byte chars = 37 characters but 74 bytes
    const tooManyBytes = 'é'.repeat(37);
    expect(tooManyBytes.length).toBe(37);
    expect(
      (await errorsFor(RegisterDto, { ...ok, password: tooManyBytes })).props,
    ).toEqual(['password']);
    // 36 x 2-byte chars = 72 bytes
    expect(
      (await errorsFor(RegisterDto, { ...ok, password: 'é'.repeat(36) })).props,
    ).toEqual([]);
  });

  it('rejects non-string passwords and invalid emails', async () => {
    expect(
      (await errorsFor(RegisterDto, { ...ok, password: 1234567890 })).props,
    ).toContain('password');
    expect(
      (await errorsFor(RegisterDto, { ...ok, email: 'nope' })).props,
    ).toEqual(['email']);
  });

  it('normalises the email to trimmed lowercase', async () => {
    const { inst, props } = await errorsFor(RegisterDto, {
      ...ok,
      email: '  Foo.Bar@Example.COM ',
    });
    expect(props).toEqual([]);
    expect(inst.email).toBe('foo.bar@example.com');
  });
});

describe('LoginDto', () => {
  it('accepts short legacy passwords', async () => {
    expect(
      (await errorsFor(LoginDto, { email: 'a@b.co', password: 'abc' })).props,
    ).toEqual([]);
  });

  it('rejects empty and non-string passwords', async () => {
    expect(
      (await errorsFor(LoginDto, { email: 'a@b.co', password: '' })).props,
    ).toEqual(['password']);
    expect(
      (await errorsFor(LoginDto, { email: 'a@b.co', password: { $ne: 1 } }))
        .props,
    ).toEqual(['password']);
  });

  it('normalises the email', async () => {
    const { inst } = await errorsFor(LoginDto, {
      email: ' USER@Example.com',
      password: 'x',
    });
    expect(inst.email).toBe('user@example.com');
  });
});

describe('SearchUsersDto', () => {
  it('accepts 3..254 characters (after trimming)', async () => {
    expect((await errorsFor(SearchUsersDto, { email: 'abc' })).props).toEqual(
      [],
    );
    expect(
      (await errorsFor(SearchUsersDto, { email: 'a'.repeat(254) })).props,
    ).toEqual([]);
  });

  it('rejects short, long, whitespace-padded-short and non-string queries', async () => {
    expect((await errorsFor(SearchUsersDto, { email: 'ab' })).props).toEqual([
      'email',
    ]);
    expect((await errorsFor(SearchUsersDto, { email: ' a ' })).props).toEqual([
      'email',
    ]);
    expect(
      (await errorsFor(SearchUsersDto, { email: 'a'.repeat(255) })).props,
    ).toEqual(['email']);
    expect(
      (await errorsFor(SearchUsersDto, { email: ['abc', 'def'] })).props,
    ).toEqual(['email']);
  });
});
