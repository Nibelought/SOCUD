import { Module } from '@nestjs/common';
import { LiveDocumentRegistry } from './live-document.registry';

@Module({
  providers: [LiveDocumentRegistry],
  exports: [LiveDocumentRegistry],
})
export class PipelineModule {}
