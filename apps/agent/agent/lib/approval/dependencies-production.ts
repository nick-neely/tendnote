import { getEveApprovalMode } from "@tendnote/db/queries/access-profiles";
import { recordEveApprovalDecision } from "@tendnote/db/queries/eve-approval-decisions";
import { hasEveSessionToolTrust } from "@tendnote/db/queries/eve-session-tool-trusts";
import { type ApprovalPolicyDependencies, withApprovalPolicyOverrides } from "./dependencies";

/**
 * What the approval policy actually calls: the `@tendnote/db` queries, with any
 * test override applied over them.
 *
 * Split from `./dependencies` so the seam itself carries no runtime import - see
 * that file for why the test setup cannot afford one.
 */
const PRODUCTION_DEPENDENCIES: ApprovalPolicyDependencies = {
  readApprovalMode: getEveApprovalMode,
  readSessionToolTrust: hasEveSessionToolTrust,
  recordApprovalDecision: recordEveApprovalDecision,
};

/** The dependencies to use for this decision, resolved fresh so an override lands at once. */
export function approvalPolicyDependencies(): ApprovalPolicyDependencies {
  return withApprovalPolicyOverrides(PRODUCTION_DEPENDENCIES);
}
