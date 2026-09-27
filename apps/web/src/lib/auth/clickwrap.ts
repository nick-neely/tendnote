import { recordAcceptances } from "@tendnote/db/queries/acceptance-records";
import { type AdmissionEnvironment, parseAdmissionPolicy } from "@tendnote/domain/admission";
import {
  CLICKWRAP_REQUIRED_MESSAGE,
  CURRENT_LEGAL_DOCUMENTS,
  isCurrentClickwrapAcceptance,
} from "@tendnote/domain/legal-documents";
import { APIError, getOAuthState } from "better-auth/api";

/**
 * The request field, in the email sign-up body or the OAuth flow's
 * `additionalData`, that carries the sign-up form's clickwrap acceptance.
 */
export const LEGAL_ACCEPTANCE_FIELD = "legalAcceptance";

/** The part of a Better Auth endpoint context the clickwrap reads. */
type EndpointContext = { body?: unknown } | null | undefined;

async function readClickwrapAcceptance(
  context: NonNullable<EndpointContext>,
  readOAuthState: () => Promise<unknown>,
): Promise<unknown> {
  const body = context.body as Record<string, unknown> | undefined;
  if (body && LEGAL_ACCEPTANCE_FIELD in body) return body[LEGAL_ACCEPTANCE_FIELD];

  // An OAuth sign-up creates the user on the provider callback, whose body is
  // the provider's; the form's acceptance rode through the flow's state.
  const state = (await readOAuthState()) as Record<string, unknown> | null;
  return state?.[LEGAL_ACCEPTANCE_FIELD];
}

export type ClickwrapHookDependencies = {
  env?: AdmissionEnvironment;
  record?: typeof recordAcceptances;
  readOAuthState?: () => Promise<unknown>;
};

/**
 * Hosted account creation carries clickwrap acceptance (#613). Every user a
 * Better Auth endpoint creates - email sign-up or an OAuth callback - must
 * arrive with acceptance of the current document versions and the eligibility
 * statement, and each accepted version becomes an Acceptance Record. A user
 * created with no endpoint context is server-side provisioning, such as the
 * loopback-only local demo owner, not a sign-up.
 *
 * Self-hosted deployments run neither half: the hosted Terms and Privacy Policy
 * are Neely Solutions LLC's, not the self-hosting operator's.
 */
export function createClickwrapHooks(dependencies: ClickwrapHookDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const record = dependencies.record ?? recordAcceptances;
  const readOAuthState = dependencies.readOAuthState ?? getOAuthState;

  const applies = (context: EndpointContext): context is NonNullable<EndpointContext> =>
    Boolean(context) && parseAdmissionPolicy(env).mode === "hosted";

  return {
    async requireAcceptance(context: EndpointContext) {
      if (!applies(context)) return;

      if (!isCurrentClickwrapAcceptance(await readClickwrapAcceptance(context, readOAuthState))) {
        throw new APIError("BAD_REQUEST", {
          code: "ACCEPTANCE_REQUIRED",
          message: CLICKWRAP_REQUIRED_MESSAGE,
        });
      }
    },

    async recordAcceptance(user: { id: string }, context: EndpointContext) {
      if (!applies(context)) return;

      await record({ userId: user.id, documents: CURRENT_LEGAL_DOCUMENTS });
    },
  };
}
