const HREF_UUID_REGEX =
  /href="[^"]*?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[^"]*?"/gi;

/**
 * Document ids referenced from `href` attributes of sanitized HTML
 * (relative `/document/<uuid>` as well as absolute URLs), without the document itself.
 */
export function extractLinkedDocumentIds(
  html: string,
  selfId: string,
): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(HREF_UUID_REGEX)) {
    const id = match[1].toLowerCase();
    if (id !== selfId.toLowerCase()) ids.add(id);
  }
  return Array.from(ids);
}
