import type { ApprovalContext, ApprovalPolicy, ApprovalStatus } from "eve/tools/approval";
import { resolveSessionEveMode } from "../eve-modes";
import { OPAQUE_DENIAL } from "./contract";
import type { ApprovalSubjectResolver } from "./subject";

/** The single denial value. Frozen so no caller can edit the shared reason. */
const DENIED: ApprovalStatus = Object.freeze({ type: "denied", reason: OPAQUE_DENIAL } as const);

/** This call asks for nothing that needs a decision; it runs as it always did. */
const NOT_APPLICABLE: ApprovalStatus = "not-applicable";

/** Park the turn and wait for the owner. */
const USER_APPROVAL: ApprovalStatus = "user-approval";

export interface OwnerApprovalSpec<TInput> {
  /**
   * Gate only when this holds. Used by the flag-style tools, where the call is
   * ordinary until the model sets the argument that widens its authority
   * (`includeRestricted`, `directlyRequested`, `acceptedProposal`). The
   * restricted-reveal pair has {@link requireRestrictedRevealApproval} already;
   * this is for the ones that do not fit it.
   *
   * Evaluated first and on its own: a call the predicate rejects is
   * `not-applicable` for every caller, including the unattended ones, because
   * it is asking for nothing this gate exists to decide. Omit it to gate every
   * call, which is what a durable write wants.
   */
  readonly when?: (input: Readonly<TInput> | undefined) => boolean;
  /**
   * Resolves the record this call names, scoped to the authenticated owner.
   * A record that does not resolve produces the uniform opaque denial, so an
   * id belonging to somebody else never reaches the approval card. Build one
   * with `describeRegisteredSubject` (`./subject-registry`), or inline it when
   * the tool has nothing to load.
   */
  readonly describe?: ApprovalSubjectResolver<TInput>;
}

/**
 * The approval policy every durable write, external egress, and
 * authority-widening read in this agent shares.
 *
 * Returns an eve `ApprovalPolicy`, so a tool declares its gate with one line:
 *
 * ```ts
 * export default defineTool({
 *   inputSchema,
 *   approval: requireOwnerApproval(),
 *   async execute(input, ctx) { ... },
 * });
 * ```
 *
 * ## What it decides, in order
 *
 * 1. `spec.when` says this call is ordinary → `not-applicable`.
 * 2. The caller is not an authenticated owner on the interactive web channel,
 *    or this is a subagent turn → the uniform opaque denial.
 * 3. `spec.describe` cannot resolve the record inside that owner's scope →
 *    the same denial.
 * 4. Otherwise → `user-approval`: eve parks the *specific* call, with its input
 *    frozen, until the owner answers through the client.
 *
 * ## Why the caller check is the mode table
 *
 * `resolveSessionEveMode` is the repository's one trusted-signal reader: it
 * takes only what the channel's own `AuthFn` stamped, never message text or
 * anything the browser supplied. `web_chat` is by definition the mode where a
 * signed-in human is present and the client can render and answer a request.
 * Every other mode either has nobody watching (`scheduled_workflow`, which runs
 * as `eve:app`) or no way to answer (`discord_capture`, whose route never
 * starts a model session at all), so parking there would hang the turn rather
 * than protect anything.
 *
 * ## `always`, never `once`
 *
 * `ctx.approvedTools` is eve's session-wide memory behind `once()`. It is
 * deliberately unread here: a durable write is not authorised by an earlier,
 * unrelated call to the same tool, so every call is its own decision.
 *
 * ## It never throws
 *
 * eve invokes the policy inside its approval callback and does not guard it, so
 * a throw would abort the turn instead of failing closed. Every path returns a
 * status, and anything unexpected — a predicate that throws, a store that is
 * unreachable, a context arriving without a session — denies.
 */
export function requireOwnerApproval<TInput = Record<string, unknown>>(
  spec: OwnerApprovalSpec<TInput> = {},
): ApprovalPolicy<TInput> {
  return async (ctx: ApprovalContext<TInput>): Promise<ApprovalStatus> => {
    try {
      // eve passes the model's tool input only when it is an object, so this is
      // untrusted data that may simply be absent.
      const input = ctx?.toolInput as Readonly<TInput> | undefined;

      if (spec.when !== undefined && !spec.when(input)) return NOT_APPLICABLE;

      const ownerUserId = interactiveOwnerUserId(ctx);
      if (ownerUserId === null) return DENIED;

      if (spec.describe !== undefined) {
        const subject = await spec.describe(input, {
          ownerUserId,
          toolName: typeof ctx.toolName === "string" ? ctx.toolName : "",
          callId: typeof ctx.callId === "string" ? ctx.callId : "",
        });
        if (!subject.found) return DENIED;
      }

      return USER_APPROVAL;
    } catch {
      return DENIED;
    }
  };
}

/**
 * The gate every restricted-reveal argument shares.
 *
 * Eight tools offer the same request under two spellings — `includeRestricted`
 * on the reads that widen what they return, `directlyRequested` on the ones that
 * widen what they may ground a suggestion in — and each had written the
 * predicate out again. A hand-copied predicate is how one of them ends up
 * checking a truthy value, or a third spelling, or nothing at all. This is the
 * one definition: exactly those two keys, `=== true` and nothing looser, so a
 * `"false"` string or a `1` from a provider that stringifies booleans cannot
 * widen anything by being merely truthy.
 *
 * `create_message_draft` keeps its own predicate: it also gates
 * `acceptedProposal`, which is a different question (a proposal the model claims
 * the owner accepted) that happens to reach the same policy.
 */
export function requireRestrictedRevealApproval<
  TInput = Record<string, unknown>,
>(): ApprovalPolicy<TInput> {
  return requireOwnerApproval<TInput>({ when: asksForRestrictedReveal });
}

/** True when this input asks to widen the call's authority over restricted records. */
function asksForRestrictedReveal(input: unknown): boolean {
  const asked = input as { includeRestricted?: unknown; directlyRequested?: unknown } | undefined;
  return asked?.includeRestricted === true || asked?.directlyRequested === true;
}

/**
 * The owner who can actually be asked, or `null`.
 *
 * Read defensively all the way down: an approval context that arrives without
 * a session is exactly the shape this must not throw on.
 */
function interactiveOwnerUserId(ctx: unknown): string | null {
  const current = (ctx as ApprovalContext | undefined)?.session?.auth?.current;
  if (!current) return null;

  const ownerUserId = current.principalId?.trim();
  if (!ownerUserId) return null;

  // A subagent turn. Subagents propose; the parent session is where a person is.
  if ((ctx as ApprovalContext).session?.parent !== undefined) return null;

  if (resolveSessionEveMode(current) !== "web_chat") return null;

  return ownerUserId;
}
