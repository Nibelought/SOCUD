/**
 * Message of a Nest error body (`{ statusCode, message: string | string[], error }`).
 * Validation errors carry a list of messages; they are joined with `separator` (default ", ").
 */
export function apiErrorMessage(error: unknown, fallback: string, separator = ', '): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message) return message;
    if (Array.isArray(message) && message.length > 0) {
      return message.map(String).join(separator);
    }
  }
  return fallback;
}

/** Message of a caught value (`catch (err: unknown)`): the Error's message, otherwise `fallback`. */
export function caughtMessage(err: unknown, fallback = 'Something went wrong'): string {
    return err instanceof Error && err.message ? err.message : fallback;
}
