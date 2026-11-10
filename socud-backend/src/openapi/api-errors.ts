import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/common.dto';

export interface ApiErrorsOptions {
  /** 400: validation failed (or a malformed id). */
  badRequest?: boolean;
  /** 401: missing/invalid/expired access token. Default true. */
  unauthorized?: boolean;
  /** 403: authenticated but lacks the required role. */
  forbidden?: boolean;
  /** 409: conflicts with current state (duplicate email, last owner...). */
  conflict?: boolean;
  /** 404: resource does not exist (or is hidden from the caller). */
  notFound?: boolean;
}

/** Documents the standard error responses of a route with the shared error body. */
export function ApiErrors({
  badRequest,
  unauthorized = true,
  forbidden,
  notFound,
  conflict,
}: ApiErrorsOptions = {}) {
  const type = ErrorResponseDto;
  return applyDecorators(
    ...(badRequest
      ? [ApiBadRequestResponse({ description: 'Validation failed', type })]
      : []),
    ...(unauthorized
      ? [ApiUnauthorizedResponse({ description: 'Not authenticated', type })]
      : []),
    ...(forbidden
      ? [ApiForbiddenResponse({ description: 'Insufficient role', type })]
      : []),
    ...(conflict
      ? [
          ApiConflictResponse({
            description: 'Conflicts with current state',
            type,
          }),
        ]
      : []),
    ...(notFound
      ? [ApiNotFoundResponse({ description: 'Not found', type })]
      : []),
  );
}
