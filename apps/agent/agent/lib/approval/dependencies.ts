import type { EveApprovalDecisionInput } from "@tendnote/db/queries/eve-approval-decisions";
import type { EveApprovalMode } from "@tendnote/domain";

/**
 * The two owner-scoped reads and one audit write the approval policy performs,
 * behind one injectable seam.
 *
 * ## Why a module-level holder rather than a factory argument
 *
 * `requireOwnerApproval()` is called at module scope in ~40 tool files, which is
 * the property that makes the gate hard to forget: a tool declares it in one
 * line with nothing to wire. Threading dependencies through that call would put
 * a construction argument in every one of those lines for the benefit of the
 * tests alone. `createEveSessionOwnerHook(bind)` can take its dependency because
 * it is constructed once; this is not.
 *
 * So the seam is a holder the policy reads *at decision time* - which it has to
 * do anyway, since the Approval Mode is read fresh on every gated call (ADR-0240)
 * - and {@link setApprovalPolicyDependencies} is how a test replaces it.
 *
 * ## Why the real implementations are not in this file
 *
 * They live in `./dependencies-production`, which imports the `@tendnote/db`
 * query layer. This module imports nothing at runtime, so the vitest setup file
 * that installs test doubles for every test file
 * (`tests/approval-dependencies-setup.ts`) can do it without dragging the whole
 * query layer into ~90 test files that never touch a store: that measured about
 * a second of setup each.
 */
export interface ApprovalPolicyDependencies {
  /** The owner's Approval Mode, read fresh. Rejecting means the policy parks. */
  readonly readApprovalMode: (input: { userId: string }) => Promise<EveApprovalMode>;
  /** Whether a Session Tool Trust names this tool for this session. */
  readonly readSessionToolTrust: (input: {
    sessionId: string;
    toolName: string;
  }) => Promise<boolean>;
  /** The approval decision record. Best-effort at the call site; see the policy. */
  readonly recordApprovalDecision: (input: EveApprovalDecisionInput) => Promise<unknown>;
}

let overrides: Partial<ApprovalPolicyDependencies> = {};

/** Replace one or more dependencies. Tests only; production installs nothing. */
export function setApprovalPolicyDependencies(next: Partial<ApprovalPolicyDependencies>): void {
  overrides = { ...overrides, ...next };
}

/** Drop every override, restoring the database-backed dependencies. */
export function resetApprovalPolicyDependencies(): void {
  overrides = {};
}

/** The production dependencies with any test override applied over them. */
export function withApprovalPolicyOverrides(
  production: ApprovalPolicyDependencies,
): ApprovalPolicyDependencies {
  return { ...production, ...overrides };
}
