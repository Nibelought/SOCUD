import { ApiProperty } from '@nestjs/swagger';
import { UserSummaryDto } from '../../common/dto/common.dto';

/** Body of POST /auth/login (the refresh token travels only in the httpOnly cookie). */
export class LoginResponseDto {
  /** Short-lived JWT for the `Authorization: Bearer` header. */
  @ApiProperty()
  access_token: string;

  @ApiProperty({ type: () => UserSummaryDto })
  user: UserSummaryDto;
}

/** Body of POST /auth/refresh. */
export class AccessTokenResponseDto {
  @ApiProperty()
  access_token: string;
}
