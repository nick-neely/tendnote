import {
  type AccessProfileGateway,
  type AdmissionEntity,
  createAdmissionResolver,
  type HostedFlagEvaluator,
} from "@tendnote/db/queries/access-profiles";
import type {
  AdmissionConfigurationDiagnostic,
  AdmissionEnvironment,
  AdmissionPolicy,
} from "@tendnote/domain";

/** The trusted Better Auth entity passed to Private Beta Access evaluation. */
export type BetaFlagEntity = AdmissionEntity;

/** Hosted Flags evaluation. */
export type PrivateBetaFlagEvaluator = HostedFlagEvaluator;

export type { AccessProfileGateway };

/**
 * Web's historical name for the shared admission resolver. Keeping this thin
 * adapter means Web, Eve, and tests all use one persisted Access Decision seam.
 */
export function createPrivateBetaAccessResolver(deps: {
  accessProfiles: AccessProfileGateway;
  evaluateFlag: PrivateBetaFlagEvaluator;
  policy?: AdmissionPolicy;
  environment?: AdmissionEnvironment;
  reportConfiguration?: (diagnostic: AdmissionConfigurationDiagnostic) => void;
}) {
  return createAdmissionResolver(deps);
}
