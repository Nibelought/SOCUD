import { Test, TestingModule } from '@nestjs/testing';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { SearchService } from '../search/search.service';
import { PermissionService } from '../permission/permission.service';

describe('DocumentController', () => {
  let controller: DocumentController;
  const search = jest.fn();

  beforeEach(async () => {
    search.mockReset().mockResolvedValue([{ id: 'doc' }]);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        { provide: DocumentService, useValue: {} },
        { provide: SearchService, useValue: { search } },
        // RoleGuard dependency; route authorization is covered by document.guard.matrix.spec.ts
        { provide: PermissionService, useValue: {} },
      ],
    }).compile();

    controller = module.get<DocumentController>(DocumentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('search', () => {
    it('delegates to SearchService with the caller id', async () => {
      await expect(controller.search('user-1', 'deploy')).resolves.toEqual([
        { id: 'doc' },
      ]);
      expect(search).toHaveBeenCalledWith('user-1', 'deploy');
    });

    it.each(['', '   ', undefined])(
      'returns [] for a blank query (%p)',
      async (q) => {
        await expect(controller.search('user-1', q as string)).resolves.toEqual(
          [],
        );
        expect(search).not.toHaveBeenCalled();
      },
    );
  });
});
