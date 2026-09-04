import type {
  EveApprovalDecisionInput,
  EveApprovalDecisionTier,
} from "@tendnote/db/queries/eve-approval-decisions";
import type { EveApprovalMode } from "@tendnote/domain";
import type { ApprovalContext, ApprovalPolicy, ApprovalStatus } from "eve/tools/approval";
import { readConversationTaint } from "../conversation-taint";
import { resolveSessionEveMode } from "../eve-modes";
import { OPAQUE_DENIAL } from "./contract";
import { approvalPolicyDependencies } from "./dependencies-production";
import type { ApprovalSubjectResolver } from "./subject";

/** The single denial value. Frozen so no caller can edit the shared reason. */
const DENIED: ApprovalStatus = Object.freeze({ type: "denied", reason: OPAQUE_DENIAL } as const);

/** This call asks for nothing that needs a decision; it runs as it always did. */
const NOT_APPLICABLE: ApprovalStatus = "not-applicable";

/** Park the turn and wait for the owner. */
const USER_APPROVAL: ApprovalStatus = "user-approval";

/**
 * The Approval Mode every unreadable answer resolves to.
 *
 * ADR-0240: a mode the system cannot read is `ask`, never a denial - parking is
 * the safe direction when nothing can tell what the owner chose. It is also what
 * a decision record carries for a call denied before any mode was read.
 */
const FALLBACK_APPROVAL_MODE: EveApprovalMode = "ask";

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
  /**
   * Declares this call a **Reversible Private Write**: owner-scoped or
   * owner-created, private by construction with no argument that can widen its
   * audience, and carrying an undo, archive, restore, or lifecycle path back.
   *
   * Absent means always-ask, deliberately. A tier is a claim about what a write
   * can cost, and the safe default for a claim nobody made is that it was not
   * made. `tests/write-tool-approval.test.ts` holds every write to the rule
   * rather than to a list, so a tool that declares this without earning it fails
   * there.
   *
   * A predicate takes the same frozen input `when` does, for the tool whose tier
   * depends on its arguments: `capture_saved_item` is a Reversible Private Write
   * only while `requestedScope` is absent, because setting it asks to widen the
   * audience beyond the owner.
   *
   * The declaration alone never lets a call run. It is read after the caller
   * check and the describer, and only in a conversation that is not a Tainted
   * Conversation, when the owner's Approval Mode is `trusted` or a Session Tool
   * Trust names this tool for this session.
   */
  readonly reversiblePrivateWrite?: boolean | ((input: Readonly<TInput> | undefined) => boolean);
}

/** Everything a decision record needs from the call itself, or `null`. */
type CallIdentity = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly toolName: string;
};

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
 * 1. `spec.when` says this call is ordinary → `not-applicable`, and nothing is
 *    recorded: it asked for nothing this gate decides.
 * 2. The caller is not an authenticated owner on the interactive web channel,
 *    or this is a subagent turn → the uniform opaque denial.
 * 3. `spec.describe` cannot resolve the record inside that owner's scope →
 *    the same denial.
 * 4. This call is a Reversible Private Write and the conversation is not a
 *    Tainted Conversation, and either the owner's Approval Mode is `trusted` or
 *    a Session Tool Trust names this tool for this session → `not-applicable`:
 *    the write runs without a click, and the decision record says so.
 * 5. Otherwise → `user-approval`: eve parks the *specific* call, with its input
 *    frozen, until the owner answers through the client.
 *
 * ## Why the mode is read here, every time
 *
 * Not stamped onto the session principal in the channel's `AuthFn`, which runs
 * once per turn: a value frozen there would survive a mid-turn setting change,
 * and it would couple authentication to an account preference it has no other
 * reason to know. Reading fresh means a mode change applies to the very next
 * gated call. The read is owner-scoped by construction - the id it is given is
 * the one the caller check just verified - so no `clientContext`, model input, or
 * message text can reach it (ADR-0240).
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
 * unrelated call to the same tool, so every call is its own decision. The
 * Session Tool Trust that *can* let a repeat run is a row the owner wrote from
 * an approval card, not a memory the model can see (ADR-0240).
 *
 * ## It never throws, and a broken dependency parks
 *
 * eve invokes the policy inside its approval callback and does not guard it, so
 * a throw would abort the turn instead of failing closed. Every path returns a
 * status, and anything unexpected — a predicate that throws, a store that is
 * unreachable, a context arriving without a session — denies. The one deliberate
 * exception is the dependency reads: a mode or trust lookup that fails parks
 * rather than denies, because "we could not tell what the owner chose" is a
 * reason to ask them, not a reason to refuse a call they may well have wanted.
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

      const tier = resolveTier(spec, input);
      const tainted = readConversationTaint().tainted;
      const call = callIdentity(ctx);

      const ownerUserId = interactiveOwnerUserId(ctx);
      if (ownerUserId === null) {
        recordDecision(call, { tier, modeAtDecision: FALLBACK_APPROVAL_MODE, tainted }, "denied");
        return DENIED;
      }

      if (spec.describe !== undefined) {
        const subject = await spec.describe(input, {
          ownerUserId,
          toolName: typeof ctx.toolName === "string" ? ctx.toolName : "",
          callId: typeof ctx.callId === "string" ? ctx.callId : "",
        });
        if (!subject.found) {
          recordDecision(call, { tier, modeAtDecision: FALLBACK_APPROVAL_MODE, tainted }, "denied");
          return DENIED;
        }
      }

      const mode = await readApprovalMode(ownerUserId);
      const decision = { tier, modeAtDecision: mode ?? FALLBACK_APPROVAL_MODE, tainted };

      // An unreadable mode parks without consulting anything else: a Session Tool
      // Trust is an exception to a posture the system cannot currently see.
      if (mode === null) {
        recordDecision(call, decision, "parked");
        return USER_APPROVAL;
      }

      if (tier === "reversible_private" && !tainted) {
        if (mode === "trusted" || (await readSessionToolTrust(call))) {
          recordDecision(call, decision, "auto_approved");
          return NOT_APPLICABLE;
        }
      }

      recordDecision(call, decision, "parked");
      return USER_APPROVAL;
    } catch {
      return DENIED;
    }
  };
}

/**
 * Which side of the Approval Mode line this call falls on.
 *
 * A declaration that is neither `true` nor a predicate returning `true` is
 * always-ask, including a predicate that answers with something merely truthy:
 * the tier is a claim, and only the exact claim counts.
 */
function resolveTier<TInput>(
  spec: OwnerApprovalSpec<TInput>,
  input: Readonly<TInput> | undefined,
): EveApprovalDecisionTier {
  const declared = spec.reversiblePrivateWrite;
  if (declared === undefined) return "always_ask";

  const reversible = typeof declared === "function" ? declared(input) === true : declared === true;
  return reversible ? "reversible_private" : "always_ask";
}

/** The owner's Approval Mode, or `null` when it could not be read as one. */
async function readApprovalMode(userId: string): Promise<EveApprovalMode | null> {
  try {
    const mode = await approvalPolicyDependencies().readApprovalMode({ userId });
    if (mode === "trusted" || mode === "ask") return mode;
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether a Session Tool Trust names this tool for this session.
 *
 * A failure answers `false`, which parks: an unreadable exception is not an
 * exception. A call with no readable identity answers `false` for the same
 * reason - there is no session to have trusted anything in.
 */
async function readSessionToolTrust(call: CallIdentity | null): Promise<boolean> {
  if (call === null) return false;

  try {
    const trusted = await approvalPolicyDependencies().readSessionToolTrust({
      sessionId: call.sessionId,
      toolName: call.toolName,
    });
    return trusted === true;
  } catch {
    return false;
  }
}

/**
 * Write the approval decision record, best-effort.
 *
 * Fire and forget with the rejection swallowed: this is an audit row, and the
 * one thing it must never do is fail or delay the decision it is describing.
 * A call whose turn id is unreadable is skipped rather than written with a
 * placeholder - `turn_id` is `NOT NULL` because a decision belongs to a turn,
 * and inventing one would put a lie in the audit trail.
 */
function recordDecision(
  call: CallIdentity | null,
  decision: {
    readonly tier: EveApprovalDecisionTier;
    readonly modeAtDecision: EveApprovalMode;
    readonly tainted: boolean;
  },
  outcome: EveApprovalDecisionInput["outcome"],
): void {
  if (call === null) return;

  try {
    void Promise.resolve(
      approvalPolicyDependencies().recordApprovalDecision({ ...call, ...decision, outcome }),
    ).catch(() => {
      // Best-effort: the decision itself has already been made.
    });
  } catch {
    // A dependency that throws synchronously is the same non-event.
  }
}

/** The call's durable identity, or `null` when any part of it is missing. */
function callIdentity(ctx: unknown): CallIdentity | null {
  const session = (ctx as ApprovalContext | undefined)?.session;
  const sessionId = trimmed(session?.id);
  const turnId = trimmed(session?.turn?.id);
  const callId = trimmed((ctx as ApprovalContext | undefined)?.callId);
  const toolName = trimmed((ctx as ApprovalContext | undefined)?.toolName);

  if (sessionId === null || turnId === null || callId === null || toolName === null) return null;
  return { sessionId, turnId, callId, toolName };
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
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
 * Never a Reversible Private Write: the whole point of the argument is that the
 * call reveals restricted-sensitivity content it would otherwise withhold, which
 * is neither private by construction nor undoable once read.
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
