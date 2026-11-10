import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { UserSummaryDto } from '../../common/dto/common.dto';

/** A space as stored (raw row). */
export class SpaceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  isArchived: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt: Date | null;
}

export class SpaceCountDto {
  @ApiProperty()
  documents: number;

  /** Present on GET /space only. */
  @ApiProperty({ required: false })
  members?: number;
}

/** Space row with relation counts (GET /space, GET /space/my). */
export class SpaceWithCountDto extends SpaceDto {
  @ApiProperty({ type: () => SpaceCountDto })
  _count: SpaceCountDto;
}

export class SpaceDocumentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  updatedBy: string | null;
}

/** GET /space/:id: the space with its non-archived documents (newest first). */
export class SpaceDetailDto extends SpaceDto {
  @ApiProperty({ type: () => [SpaceDocumentSummaryDto] })
  documents: SpaceDocumentSummaryDto[];
}

export class SpaceMemberDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  spaceId: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;
}

export class SpaceMemberWithUserDto extends SpaceMemberDto {
  @ApiProperty({ type: () => UserSummaryDto })
  user: UserSummaryDto;
}
