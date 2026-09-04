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
 * ## Why nothing here imports the query layer
 *
 * The real implementations live in `./dependencies-production`, which imports
 * `@tendnote/db`. A static import of that module from this one would put the
 * whole query layer behind every tool file, because every gated tool imports the
 * policy: ~90 test files paid about a second of import each for a store they
 * never touch, and `web_fetch` carried a database in its bundle to fetch a URL.
 *
 * So the query layer arrives one of two ways, neither of them a static import:
 *
 * - {@link registerApprovalPolicyDependencies}, called once at agent startup by
 *   `agent/hooks/eve-approval-settled.ts`, which is loaded by eve itself and
 *   already owns the other half of this feature's database work.
 * - failing that, a cached `import("./dependencies-production")` the first time a
 *   decision actually needs one, so a tool called before that registration ran
 *   still reads a real Approval Mode rather than a fallback.
 *
 * A test never reaches either: `tests/approval-dependencies-setup.ts` installs
 * all three dependencies for every test file, and a complete set of overrides
 * short-circuits the production lookup entirely.
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

/** The database-backed set, once something has supplied it. */
let production: ApprovalPolicyDependencies | null = null;

/** The in-flight lazy load, so a burst of gated calls imports the layer once. */
let loading: Promise<ApprovalPolicyDependencies> | null = null;

/** Replace one or more dependencies. Tests only; production installs nothing. */
export function setApprovalPolicyDependencies(next: Partial<ApprovalPolicyDependencies>): void {
  overrides = { ...overrides, ...next };
}

/** Drop every override, restoring the database-backed dependencies. */
export function resetApprovalPolicyDependencies(): void {
  overrides = {};
}

/**
 * Install the database-backed dependencies. Called once at agent startup, so the
 * first gated call of the process does not pay for a dynamic import.
 */
export function registerApprovalPolicyDependencies(next: ApprovalPolicyDependencies): void {
  production = next;
}

/** Whether the overrides already answer every dependency on their own. */
function isComplete(candidate: Partial<ApprovalPolicyDependencies>): boolean {
  return (
    typeof candidate.readApprovalMode === "function" &&
    typeof candidate.readSessionToolTrust === "function" &&
    typeof candidate.recordApprovalDecision === "function"
  );
}

/**
 * What a decision gets when the query layer cannot be loaded at all.
 *
 * Reads that reject, and an audit write that does nothing. The policy already
 * parks on a failed read, so a broken dependency layer produces the documented
 * "we could not tell what the owner chose" behaviour rather than denying every
 * gated call in the process.
 */
const UNAVAILABLE: ApprovalPolicyDependencies = {
  readApprovalMode: () => Promise.reject(new Error("approval policy dependencies unavailable")),
  readSessionToolTrust: () => Promise.reject(new Error("approval policy dependencies unavailable")),
  recordApprovalDecision: () => Promise.resolve(undefined),
};

/**
 * The dependencies for one decision: the database-backed set with any test
 * override applied over it.
 *
 * Resolved fresh per decision so an override lands at once, and awaited because
 * the production half may still have to be imported. A test that overrides all
 * three never triggers that import at all.
 */
export async function resolveApprovalPolicyDependencies(): Promise<ApprovalPolicyDependencies> {
  if (isComplete(overrides)) return overrides as ApprovalPolicyDependencies;

  if (production === null) {
    loading ??= import("./dependencies-production").then(
      (module) => module.PRODUCTION_APPROVAL_POLICY_DEPENDENCIES,
    );
    try {
      production = await loading;
    } catch {
      // Let the next decision try again rather than pinning a failed import for
      // the life of the process.
      loading = null;
      return { ...UNAVAILABLE, ...overrides };
    }
  }

  return { ...production, ...overrides };
}
