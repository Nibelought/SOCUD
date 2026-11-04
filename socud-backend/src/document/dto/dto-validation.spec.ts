import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ManageDocumentMemberDto, UpdateDocumentDto } from './document.dto';
import {
  ManageSpaceMemberDto,
  UpdateSpaceDto,
} from '../../space/dto/space.dto';

// Same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const run = (type: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: type });

const UUID = '3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b';

describe('strict request DTOs', () => {
  describe('UpdateDocumentDto (PATCH /document/:id)', () => {
    it('accepts and trims a title', async () => {
      await expect(
        run(UpdateDocumentDto, { title: '  Hello ' }),
      ).resolves.toEqual({ title: 'Hello' });
    });

    it.each([
      ['contentHtml', { title: 'a', contentHtml: '<script>' }],
      ['isArchived', { title: 'a', isArchived: true }],
      ['parentId', { title: 'a', parentId: UUID }],
      ['spaceId', { title: 'a', spaceId: UUID }],
      ['createdBy', { title: 'a', createdBy: UUID }],
      ['yjsState', { title: 'a', yjsState: 'x' }],
    ])('rejects the extra field %s', async (_f, body) => {
      await expect(run(UpdateDocumentDto, body)).rejects.toThrow(
        BadRequestException,
      );
    });

    it.each([
      ['empty body', {}],
      ['blank title', { title: '   ' }],
      ['non-string title', { title: 5 }],
      ['title over 255 chars', { title: 'x'.repeat(256) }],
    ])('rejects %s', async (_l, body) => {
      await expect(run(UpdateDocumentDto, body)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('UpdateSpaceDto (PATCH /space/:id)', () => {
    it('accepts title and description', async () => {
      await expect(
        run(UpdateSpaceDto, { title: ' Space ', description: 'd' }),
      ).resolves.toEqual({ title: 'Space', description: 'd' });
    });

    it.each([
      ['unknown field', { title: 'Space', isArchived: true }],
      ['name instead of title', { name: 'Space' }],
      ['short title', { title: 'ab' }],
      ['non-string description', { description: 1 }],
    ])('rejects %s', async (_l, body) => {
      await expect(run(UpdateSpaceDto, body)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe.each([
    ['ManageSpaceMemberDto', ManageSpaceMemberDto],
    ['ManageDocumentMemberDto', ManageDocumentMemberDto],
  ])('%s', (_name, Dto) => {
    it('accepts { userId, role }', async () => {
      await expect(
        run(Dto, { userId: UUID, role: Role.EDITOR }),
      ).resolves.toEqual({ userId: UUID, role: Role.EDITOR });
    });

    it.each([
      ['bad uuid', { userId: 'nope', role: Role.EDITOR }],
      ['bad role', { userId: UUID, role: 'GOD' }],
      ['missing role', { userId: UUID }],
      ['extra field', { userId: UUID, role: Role.EDITOR, spaceId: UUID }],
    ])('rejects %s', async (_l, body) => {
      await expect(run(Dto, body)).rejects.toThrow(BadRequestException);
    });
  });
});
