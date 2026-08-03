import {
  type ContextFactExtractionInput,
  MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH,
} from "@tendnote/domain";
import type { SessionAuthContext, SessionParent } from "eve/context";

export const EVE_CONTEXT_FACT_CHANNEL_MARKER = "eve";

export type AmbientContextFactEligibilityInput = ContextFactExtractionInput & {
  auth: SessionAuthContext | null;
  parent?: SessionParent;
};

/** Trusted auth + root-session gate for the post-durable Eve message hook. */
export function resolveAmbientContextFactOwner(
  input: AmbientContextFactEligibilityInput,
): string | null {
  const principalId = input.auth?.principalId.trim();
  if (
    !principalId ||
    input.auth?.principalType !== "user" ||
    input.auth.attributes.channel !== EVE_CONTEXT_FACT_CHANNEL_MARKER ||
    input.parent ||
    input.message.trim().length === 0 ||
    input.message.trim().length > MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH
  ) {
    return null;
  }
  return principalId;
}
