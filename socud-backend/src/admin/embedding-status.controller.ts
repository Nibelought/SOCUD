import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../openapi/api-errors';
import { BEARER_SCHEME } from '../openapi/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../permission/system-admin.guard';
import { EmbeddingModelGuard } from '../queue/embedding-model.guard';

export class StoredEmbeddingModelDto {
  @ApiProperty({ example: 'qwen3-embedding-4b@1024' })
  model: string;

  @ApiProperty({ description: 'Chunks with a vector produced by this model.' })
  chunks: number;

  @ApiProperty({ description: 'Distinct documents owning those chunks.' })
  documents: number;
}

export class EmbeddingStatusDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'api',
    description:
      'Active embedding profile (EMBEDDING_PROFILE), or null when none is selected.',
  })
  profile: string | null;

  @ApiProperty({
    example: 'qwen3-embedding-4b@1024',
    description: 'Vector space the active provider produces from now on.',
  })
  activeModel: string;

  @ApiProperty({ enum: ['worker', 'api'] })
  provider: 'worker' | 'api';

  @ApiProperty({ example: 1024 })
  dim: number;

  @ApiProperty({
    type: [StoredEmbeddingModelDto],
    description:
      'Models present in the index, largest first. Chunks without a vector are not counted.',
  })
  stored: StoredEmbeddingModelDto[];

  @ApiProperty({
    description:
      'True when the index holds vectors of a model other than the active one.',
  })
  mismatch: boolean;

  @ApiProperty({
    type: [String],
    description: 'Human-readable remedies; empty when there is no mismatch.',
  })
  recommendedActions: string[];
}

/** Admin-only view of which embedding model(s) the search index was built with. */
@ApiTags('admin')
@Controller('admin')
export class EmbeddingStatusController {
  constructor(private readonly modelGuard: EmbeddingModelGuard) {}

  @Get('embedding-status')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Embedding model of the index vs the active model',
    description:
      'Compares the embedding model(s) that produced the stored vectors with the model that embeds new content. `mismatch: true` means semantic search mixes vector spaces and is unreliable until the documents are re-embedded; search and embedding are never blocked. System admins only. The result is cached for 30 seconds.',
  })
  @ApiBearerAuth(BEARER_SCHEME)
  @ApiOkResponse({ type: EmbeddingStatusDto })
  @ApiErrors({ forbidden: true })
  status(): Promise<EmbeddingStatusDto> {
    return this.modelGuard.getStatus();
  }
}
