import { getEveApprovalMode } from "@tendnote/db/queries/access-profiles";
import { recordEveApprovalDecision } from "@tendnote/db/queries/eve-approval-decisions";
import { hasEveSessionToolTrust } from "@tendnote/db/queries/eve-session-tool-trusts";
import {
  type ApprovalPolicyDependencies,
  registerApprovalPolicyDependencies,
} from "./dependencies";

/**
 * What the approval policy actually calls: the `@tendnote/db` queries.
 *
 * Split from `./dependencies` because this module imports the query layer and
 * that one must not - see that file for what a static import of this one costs
 * every tool that imports the gate.
 */
export const PRODUCTION_APPROVAL_POLICY_DEPENDENCIES: ApprovalPolicyDependencies = {
  readApprovalMode: getEveApprovalMode,
  readSessionToolTrust: hasEveSessionToolTrust,
  recordApprovalDecision: recordEveApprovalDecision,
};

/**
 * Install them for the process. Called once from an eve-loaded module at agent
 * startup, so a gated call resolves its dependencies without importing anything.
 */
export function installProductionApprovalPolicyDependencies(): void {
  registerApprovalPolicyDependencies(PRODUCTION_APPROVAL_POLICY_DEPENDENCIES);
}
