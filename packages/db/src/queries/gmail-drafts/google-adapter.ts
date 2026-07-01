import { GMAIL_CAPABILITY_KEY, GMAIL_PROVIDER_KEY } from "@tendnote/domain";
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
 * Encode a header value with RFC 2047 when it contains non-ASCII, so subjects with
 * accents/emoji survive as a valid MIME header; plain ASCII is passed through.
 */
function encodeHeaderValue(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII range check.
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Build the minimized RFC 2822 message (to, subject, plain-text body) as base64url. */
function buildRawMessage(input: { to: string; subject: string; body: string }): string {
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
