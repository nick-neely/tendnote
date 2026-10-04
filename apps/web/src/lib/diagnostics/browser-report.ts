import { z } from "zod";
import {
  BROWSER_NAMES,
  BROWSER_OPERATIONS,
  type BrowserDiagnostic,
  DIAGNOSTIC_ERROR_CODES,
  MAX_FRAMES,
  MAX_POSITION,
  sanitizeStackFile,
  sanitizeStackFunction,
} from "./envelope";

const position = z.number().int().min(0).max(MAX_POSITION);

/** A frame's file and function go through the same sanitizers the page used, so a tampered page gains nothing. */
const frameSchema = z
  .object({ file: z.string(), function: z.string(), line: position, column: position })
  .transform((frame) => ({
    file: sanitizeStackFile(frame.file),
    function: sanitizeStackFunction(frame.function),
    line: frame.line,
    column: frame.column,
  }));

const browserDiagnosticSchema = z.object({
  code: z.enum(DIAGNOSTIC_ERROR_CODES),
  operation: z.enum(BROWSER_OPERATIONS),
  frames: z.array(frameSchema).max(MAX_FRAMES),
  browser: z.object({
    name: z.enum(BROWSER_NAMES),
    major: z.number().int().min(0).max(999).nullable(),
  }),
});

/**
 * Validate a browser's report on the server. Only the four known fields are
 * read and each is rebuilt from its allowlist; an unknown key is stripped, so
 * a field the page added, or a value it failed to sanitize, never reaches the
 * outbound envelope. Returns `null` for anything malformed.
 */
export function parseBrowserDiagnostic(raw: unknown): BrowserDiagnostic | null {
  const parsed = browserDiagnosticSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
