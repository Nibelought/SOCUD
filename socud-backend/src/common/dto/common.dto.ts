import { ApiProperty } from '@nestjs/swagger';

/** Shape of every error body produced by Nest's HTTP exceptions. */
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode: number;

  /** A single message, or the list of validation messages for 400 responses. */
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Not found',
  })
  message: string | string[];

  @ApiProperty({ required: false, example: 'Not Found' })
  error?: string;
}

/** `{ success: true }` acknowledgement returned by delete-like operations. */
export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
}

/** Public part of a user account (never includes the password hash). */
export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;
}
