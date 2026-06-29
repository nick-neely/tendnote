import type { ProviderCapabilityRef } from "./provider-connections";

/**
 * Provider-capability catalog (Phase 2B product layer, ADR-0069).
 *
 * ADR-0069: "the table should model provider keys and capability keys
 * generically, while product phases decide which capabilities are active and what
 * privacy rules apply." This module is that product-decision layer — UI labels and
 * the set of capabilities Tendnote currently offers — kept separate from the
 * generic, provider-agnostic shape in `provider-connections.ts`.
 */

export const PROVIDER_GOOGLE = "google";

/**
 * Default provider capabilities surfaced in Phase 2B. Calendar, Gmail, and
 * Contacts are distinct capabilities so each permission is reasoned about
 * independently. Adding a provider here is a catalog change, not a schema change.
 */
export const DEFAULT_PROVIDER_CAPABILITIES = [
  { providerKey: PROVIDER_GOOGLE, capabilityKey: "calendar", label: "Google Calendar" },
  { providerKey: PROVIDER_GOOGLE, capabilityKey: "gmail", label: "Gmail" },
  { providerKey: PROVIDER_GOOGLE, capabilityKey: "contacts", label: "Google Contacts" },
] as const satisfies ReadonlyArray<{
  providerKey: string;
  capabilityKey: string;
  label: string;
}>;

export type DefaultProviderCapability = (typeof DEFAULT_PROVIDER_CAPABILITIES)[number];

/** True when the ref matches a Phase 2B default provider capability. */
export function isDefaultProviderCapability(ref: ProviderCapabilityRef): boolean {
  return DEFAULT_PROVIDER_CAPABILITIES.some(
    (c) => c.providerKey === ref.providerKey && c.capabilityKey === ref.capabilityKey,
  );
}
