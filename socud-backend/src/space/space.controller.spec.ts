import { Test, TestingModule } from '@nestjs/testing';
import { SpaceController } from './space.controller';
import { SpaceService } from './space.service';
import { PermissionService } from '../permission/permission.service';

describe('SpaceController', () => {
  let controller: SpaceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SpaceController],
      providers: [
        { provide: SpaceService, useValue: {} },
        // RoleGuard dependency; route authorization is covered by space.guard.matrix.spec.ts
        { provide: PermissionService, useValue: {} },
      ],
    }).compile();

    controller = module.get<SpaceController>(SpaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
