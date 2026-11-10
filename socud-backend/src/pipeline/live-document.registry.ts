import { Injectable } from '@nestjs/common';

/**
 * Bridge between Hocuspocus (which owns the live, in-memory Yjs documents) and Publish, so
 * Publish freezes what collaborators see right now instead of the last debounced save.
 * Deliberately tiny: neither side has to import the other's module.
 */
@Injectable()
export class LiveDocumentRegistry {
  private source?: (documentId: string) => Uint8Array | null;

  /** Called by HocuspocusService once the server runs. */
  setSource(source: ((documentId: string) => Uint8Array | null) | undefined) {
    this.source = source;
  }

  /** Encoded Yjs state of the open document, or null when nobody has it open. */
  getState(documentId: string): Uint8Array | null {
    return this.source?.(documentId) ?? null;
  }
}
