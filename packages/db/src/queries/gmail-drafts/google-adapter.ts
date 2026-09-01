import { GMAIL_CAPABILITY_KEY, GMAIL_PROVIDER_KEY, isMimeHeaderSafe } from "@tendnote/domain";
import type { GoogleGmailAccessTokenProvider } from "./access-token";
import type {
  GmailDraftAdapter,
  GmailDraftAdapterCreateInput,
  GmailDraftAdapterUpdateInput,
} from "./types";

const GOOGLE_GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type GoogleGmailAdapterOptions = {
  /** Owner-scoped access-token retrieval (Better Auth on web/agent). */
  getAccessToken: GoogleGmailAccessTokenProvider;
  /** Injectable fetch so tests never hit the network. */
  fetchImpl?: FetchLike;
  /** Override the API base (tests). */
  baseUrl?: string;
};

/**
 * Reject a header value that carries a CR, LF, NUL, or other control character
 * before it is interpolated into a raw MIME header. This is the adapter-boundary
 * half of the header-injection defense (`isMimeHeaderSafe` in the shared schema is
 * the other): even a caller that reaches this builder without passing the schema
 * cannot smuggle an injected `Bcc:`/`Reply-To:` line into the draft.
 */
function assertMimeHeaderSafe(field: string, value: string): void {
  if (!isMimeHeaderSafe(value)) {
    throw new Error(`Gmail draft ${field} contains an illegal control character.`);
  }
}

// An RFC 2047 "B" encoded-word may be at most 75 characters including the
// `=?UTF-8?B?…?=` wrapper (12 chars), so its base64 payload is capped and rounded
// down to a multiple of 4; the raw bytes that fit are the base64 cap × 3/4.
const RFC2047_WORD_PREFIX = "=?UTF-8?B?";
const RFC2047_WORD_SUFFIX = "?=";
const RFC2047_MAX_BASE64 =
  Math.floor((75 - RFC2047_WORD_PREFIX.length - RFC2047_WORD_SUFFIX.length) / 4) * 4;
const RFC2047_MAX_BYTES = (RFC2047_MAX_BASE64 / 4) * 3;

/** Wrap a run of raw UTF-8 bytes as one RFC 2047 base64 encoded-word. */
function encodedWord(bytes: number[]): string {
  return `${RFC2047_WORD_PREFIX}${Buffer.from(bytes).toString("base64")}${RFC2047_WORD_SUFFIX}`;
}

/**
 * Encode a header value with RFC 2047 when it contains non-ASCII, so subjects with
 * accents/emoji survive as a valid MIME header; plain ASCII is passed through.
 *
 * A non-ASCII value is split into as many encoded-words as needed to keep each
 * within the RFC 2047 75-character limit, cutting only on whole UTF-8 code points so
 * a multi-byte character is never severed, and folding the words with CRLF + SPACE
 * (a header continuation). A single unfoldable ~1300-char encoded-word — what a long
 * accented subject previously produced — is not RFC-conformant and some receivers
 * reject it; this keeps every word legal.
 */
function encodeHeaderValue(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII range check.
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }

  const words: string[] = [];
  let chunk: number[] = [];
  for (const codePoint of value) {
    const bytes = [...Buffer.from(codePoint, "utf8")];
    if (chunk.length > 0 && chunk.length + bytes.length > RFC2047_MAX_BYTES) {
      words.push(encodedWord(chunk));
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length > 0 || words.length === 0) {
    words.push(encodedWord(chunk));
  }
  // Adjacent encoded-words are recombined by the reader, with the folding
  // whitespace between them discarded (RFC 2047 §6.2).
  return words.join("\r\n ");
}

/** Build the minimized RFC 2822 message (to, subject, plain-text body) as base64url. */
function buildRawMessage(input: { to: string; subject: string; body: string }): string {
  // The shared schema already rejects control characters in the subject and the
  // recipient; re-check at this boundary so the raw header can never be forged.
  assertMimeHeaderSafe("recipient", input.to);
  assertMimeHeaderSafe("subject", input.subject);
  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  const message = `${headers.join("\r\n")}\r\n\r\n${input.body}`;
  return Buffer.from(message, "utf8").toString("base64url");
}

/** Extract the Gmail draft id from a drafts create/update response. */
function readDraftId(payload: unknown): string {
  const id = (payload as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Gmail draft response did not include a draft id.");
  }
  return id;
}

/**
 * Live Google Gmail draft adapter (Phase 2D, ADR-0084). Exposes ONLY draft
 * create/update — no send, read, list, or history call exists here, so the
 * no-send/no-read boundary is structural (ADR-0089). The access token is injected
 * per owner so the seam is reusable by web and Eve, and so normal tests supply a
 * fake fetch and never touch the network. Only the minimized `to`/subject/body are
 * written; raw Google payloads never leave this adapter (only the draft id is kept).
 */
export function createGoogleGmailDraftAdapter(
  options: GoogleGmailAdapterOptions,
): GmailDraftAdapter {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = options.baseUrl ?? GOOGLE_GMAIL_API_BASE;

  async function token(ownerUserId: string): Promise<string> {
    return options.getAccessToken({
      ownerUserId,
      providerKey: GMAIL_PROVIDER_KEY,
      capabilityKey: GMAIL_CAPABILITY_KEY,
    });
  }

  // Create and update differ only by HTTP method and URL; the bearer auth, the
  // minimized to/subject/body message body, and the status-only error (no token or
  // raw payload leaks, ADR-0081) are identical.
  async function write(input: {
    ownerUserId: string;
    method: "POST" | "PUT";
    url: string;
    message: { to: string; subject: string; body: string };
    verb: string;
  }): Promise<{ gmailDraftId: string }> {
    const accessToken = await token(input.ownerUserId);
    const response = await fetchImpl(input.url, {
      method: input.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: { raw: buildRawMessage(input.message) } }),
    });
    if (!response.ok) {
      throw new Error(`Gmail draft ${input.verb} failed with status ${response.status}.`);
    }
    return { gmailDraftId: readDraftId(await response.json()) };
  }

  return {
    async createDraft(input: GmailDraftAdapterCreateInput) {
      return write({
        ownerUserId: input.ownerUserId,
        method: "POST",
        url: `${baseUrl}/users/me/drafts`,
        message: input,
        verb: "create",
      });
    },

    async updateDraft(input: GmailDraftAdapterUpdateInput) {
      return write({
        ownerUserId: input.ownerUserId,
        method: "PUT",
        url: `${baseUrl}/users/me/drafts/${encodeURIComponent(input.gmailDraftId)}`,
        message: input,
        verb: "update",
      });
    },
  };
}
