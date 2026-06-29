import { z } from "zod";

/**
 * Provider Connections (Phase 2B foundation, ADR-0069).
 *
 * A Provider Connection is owner-scoped product integration authorization state
 * for a single provider capability (e.g. Google Calendar). The shape is
 * provider-capability oriented rather than Google-specific so future non-Google
 * providers — and future memory-system products — can reuse it without a table
 * rewrite.
 *
 * Phase 2B stores stable, NON-SECRET state only. It deliberately excludes access
 * tokens, refresh tokens, encrypted token blobs, sync cursors, provider API
 * watermarks, and any raw provider payloads (Calendar/Gmail/Contacts data). Token
 * custody begins in the first real OAuth/provider slice so refresh, revocation,
 * retention, and encryption are designed together.
 */

/**
 * Generic provider key (e.g. `google`). Modelled as a free-form lowercase
 * identifier rather than an enum so a new provider does not require a schema or
 * table change — only a catalog addition.
 */
export const providerKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Provider keys are lowercase identifiers (a-z, 0-9, underscore).");

/**
 * Generic capability key (e.g. `calendar`). One provider can expose several
 * independent capabilities, each its own consent surface, so authorizing one
 * capability never implies another.
 */
export const capabilityKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Capability keys are lowercase identifiers (a-z, 0-9, underscore).");

/**
 * Provider Connection lifecycle vocabulary. Defined now — before any OAuth work —
 * so Phase 2C (Calendar), 2D (Gmail), and 2E (Contacts) build on one status model.
 *
 * - `ready`: capability is offered and can be connected later; no provider state.
 * - `pending`: authorization started, awaiting completion (future OAuth).
 * - `connected`: authorized and active (future).
 * - `revoked`: authorization was withdrawn.
 * - `error`: the last authorization/connection attempt failed.
 * - `unavailable`: capability is not currently offered to this owner.
 */
export const providerConnectionStatusSchema = z.enum([
  "ready",
  "pending",
  "connected",
  "revoked",
  "error",
  "unavailable",
]);

export type ProviderConnectionStatus = z.infer<typeof providerConnectionStatusSchema>;

/**
 * Full persisted Provider Connection shape. Every field here is non-secret. There
 * is intentionally no token, refresh token, encrypted blob, sync cursor, or
 * provider watermark field — see the module doc comment and ADR-0069.
 */
export const providerConnectionSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  providerKey: providerKeySchema,
  capabilityKey: capabilityKeySchema,
  status: providerConnectionStatusSchema,
  /** Optional non-secret display identity (e.g. the connected account email). */
  displayIdentity: z.string().max(320).nullable().optional(),
  /** Optional non-secret authorized-scope metadata; explains granted scopes later. */
  authorizedScopes: z.array(z.string().max(256)).max(64).nullable().optional(),
  connectedAt: z.date().nullable().optional(),
  revokedAt: z.date().nullable().optional(),
  lastErrorAt: z.date().nullable().optional(),
  /** Audit-facing error detail; never a secret or raw provider payload. */
  lastErrorMessage: z.string().max(1000).nullable().optional(),
  /** Audit-facing revocation detail for placeholder/real revocation state. */
  revocationReason: z.string().max(1000).nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

/** Identifies a connectable provider capability (provider + capability key). */
export const providerCapabilityRefSchema = z.object({
  providerKey: providerKeySchema,
  capabilityKey: capabilityKeySchema,
});

export type ProviderCapabilityRef = z.infer<typeof providerCapabilityRefSchema>;

/** Stable composite key for a provider capability, e.g. `google:calendar`. */
export function providerCapabilityKey(ref: ProviderCapabilityRef): string {
  return `${ref.providerKey}:${ref.capabilityKey}`;
}

/**
 * Validated input for creating an owner-scoped Provider Connection row. Only
 * non-secret state is accepted; status defaults to `ready`.
 */
export const createProviderConnectionSchema = z.object({
  ownerUserId: z.string().min(1),
  providerKey: providerKeySchema,
  capabilityKey: capabilityKeySchema,
  status: providerConnectionStatusSchema.default("ready"),
  displayIdentity: z.string().max(320).nullable().optional(),
  authorizedScopes: z.array(z.string().max(256)).max(64).nullable().optional(),
});

export type CreateProviderConnectionInput = z.input<typeof createProviderConnectionSchema>;

/**
 * Phase 2B treats any change between statuses as a real, auditable transition; a
 * transition to the same status is a no-op that callers skip without writing an
 * audit entry. Richer transition rules (e.g. cannot move to `connected` from
 * `unavailable`) arrive with the first real OAuth slice (Phase 2C+).
 */
export function isProviderConnectionStatusChange(
  current: ProviderConnectionStatus,
  next: ProviderConnectionStatus,
): boolean {
  return current !== next;
}
