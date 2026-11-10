import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SpaceModule } from '../space/space.module';
import { DocumentModule } from '../document/document.module';
import { HocuspocusModule } from '../hocuspocus/hocuspocus.module';
import { PrismaService } from '../prisma/prisma.service';
import { SpaceService } from '../space/space.service';
import { DocumentService } from '../document/document.service';
import { HocuspocusService } from '../hocuspocus/hocuspocus.service';
import { PermissionService } from './permission.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
} from '../test-utils/mocks';

// `@hocuspocus/server` pulls in an ESM-only dependency Jest cannot load; only DI is under test.
jest.mock('@hocuspocus/server', () => ({ Server: class {} }));

/** Guards the DI wiring: every consumer must resolve the one PermissionService provider. */
describe('PermissionModule wiring', () => {
  it('resolves PermissionService in Space, Document and Hocuspocus modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SpaceModule, DocumentModule, HocuspocusModule],
    })
      .overrideProvider(PrismaService)
      .useValue(createPrismaServiceMock())
      .overrideProvider(ConfigService)
      .useValue(createConfigServiceMock())
      .compile(); // compile only: no init, so no WebSocket server is started

    expect(moduleRef.get(SpaceService, { strict: false })).toBeDefined();
    expect(moduleRef.get(DocumentService, { strict: false })).toBeDefined();
    expect(moduleRef.get(HocuspocusService, { strict: false })).toBeDefined();
    expect(moduleRef.get(PermissionService, { strict: false })).toBeDefined();
  });
});
