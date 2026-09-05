# Eve Approval Modes Auto-Approve Reversible Private Writes in Untainted Conversations

ADR-0237 made every durable write, external egress, and restricted-content reveal
park for an in-turn Owner Approval, uniformly, because a model-supplied trust flag
is a request and not a proof. That uniformity is also a tax: an owner who wants Eve
to jot a memory or update their own self-context now clicks approve on a call that
could never have hurt anyone else, every single time. The fix is not a weaker gate;
it is a narrower one, chosen by the owner, that only ever widens on the safe side -
a private, reversible write - and only inside a conversation that has not read
anything from outside the household.

## Decision

**Approval Mode.** The account's access profile gains `eve_approval_mode`
(`ask` | `trusted`, default `ask`), set only through an owner server action via
`runOwnerAction`. The policy reads it from the database on every gated call rather
than stamping it onto the session principal in the AuthFn, which runs once per turn:
a value frozen there would survive a mid-turn setting change and would couple
authentication to an account preference it has no other reason to know. Reading
fresh means a mode change applies to the very next gated call. Any read failure
resolves to `ask`, never to a denial - parking is the safe direction when the
system cannot tell what the owner chose.

**Reversible Private Write.** A tool is in this tier only if it declares so through
the gate spec - a boolean or a predicate over the frozen input, the same shape as
`when` - and an absent declaration means always-ask. The classification test
enforces the CONTEXT.md definition directly: owner-scoped or owner-created; private
by construction with no argument that can widen its audience, or a predicate that
rejects the widening; and an undo, archive, restore, or lifecycle path. A rule beats
a list because the issue's own candidate list smuggled in counterexamples the rule
catches automatically: a household-visible gift-plan write has no private-by-
construction shape, `remove_gift_idea` has no path back, and a household asset edit
is neither owner-scoped nor private - each fails on a different clause, which is
the point of checking one predicate instead of maintaining a list someone has to
keep honest as tools are added. `update_person` stays tier 0 because it has no
reversal path yet; `update_self_context` qualifies today because the self-context
lifecycle already has one. `edit_general_action` stays tier 0 for the same reason and by the same
clause: rewriting an Action's title or notes overwrites wording nothing keeps a
copy of, and the Action's status lifecycle is a path back to a status, not to the
text it used to say. `update_person` moves tiers only when #557 gives it an
undo, not before - the tier follows the capability.

**Tainted Conversation.** Taint is derived, not accumulated: a dynamic tool
resolver runs on `step.started`, scans the full message history for a `web_search`
or `web_fetch` tool-call or tool-result part, and records the result in a
session-scoped state slot the policy reads; `web_fetch` also sets the same slot
inside its own `execute`, so a call already in flight when the resolver last ran is
still caught. Both mechanisms are needed because of a framework fact worth
recording plainly: eve 0.47.7's step emitter excludes provider-executed tool calls
from every hook event, so `web_search` is invisible to any hook-based design - there
is no `tool.completed` for it to catch. A `step.started` resolver has no such blind
spot: it sees the full history assembled so far, including provider-executed turns,
and runs inside eve's context scope, the same mechanism the mode gate already uses
on `turn.started`. Because taint is recomputed from history rather than flipped
once, a resumed conversation is tainted exactly when it was, with no separate
persistence to keep in sync. Nothing clears it; a new conversation is the only way
out, since there is no reliable way to tell an owner "the untrusted text is gone"
while it still sits in the transcript. Content another active Household Member
authored is deliberately not Untrusted Content - it is governed by Household
Authorization Proofs (ADR-0219), a different question about a known person's own
writes, not an unknown page's. Pasted email or document content is left for a
later extension rather than folded in now.

**Session Tool Trust.** A per-conversation, per-tool-name opt-out, recorded in a
Tendnote table keyed by Eve session id and tool name, owner-scoped through the
session-owner binding and written by a server action the approval card calls after
a successful approve. It is honoured only for Reversible Private Writes, in both
modes, and never in a Tainted Conversation. It is keyed by tool name, not input or
call, to match eve's own `once()` granularity - the grain the framework already
uses to remember a tool decision, so the owner's grant lines up with the unit the
model and runtime both reason about. Eve's own `approvedTools` memory is not used
for this: ADR-0237 already decided the policy ignores it, because it is a
model-visible signal with no owner-authored side channel behind it. A durable
Session Tool Trust needed one, so it got its own table instead.

**Approval decision record.** A new table is written from the policy seam for every
gated call outcome - parked, auto-approved, or denied - carrying session, turn, call
id, tool, tier, mode at decision, taint, and outcome; an `approval.settled` hook
updates the parked row when the owner answers. This sits at the policy seam rather
than threading a marker into domain audit rows because only three write modules
audit at all today: a uniform marker would mean touching every write module's audit
path to add a field most of them don't have, for a record that belongs to the
approval decision, not the domain write. The write is best-effort and never fails a
turn.

**Model-facing wording.** Reversible Private Write descriptions drop the "this call
pauses for the user's approval" sentence; tier-0 descriptions keep it, since it is
still true there. A dynamic instruction added on `turn.started` states the
conversation's posture once, in category words - saves pause for approval;
reversible private saves run immediately while sharing, deleting, sending,
fetching, and restricted reveals still pause; or web content was read so everything
pauses again - never the tool-to-tier map itself, so the model cannot reason about
which named tool it could try to slip past a review. The base rule "never ask the
user to type approve" stays even though the composer now intercepts exact `approve`
and `cancel`: eve clears a pending batch the moment an ordinary message arrives, so
a model that coached the owner to type `approve` as a chat message would blow away
the very card it meant to settle.

**Card.** One card renders per `input.requested` batch, with each parked call
showing its own subject and its own approve and cancel, plus an "Approve all" that
answers every remaining item in one `respond`. There is no "Cancel all": cancelling
is a decision about one specific write, and a stray click should not cost the owner
every other pending item. The taint explanation on the card is derived client-side
from the visible transcript and is explanatory only - it tells the owner why Eve
asked, it is not part of the authorization decision.

## Consequences

`web_search` still cannot be gated - the ADR-0237 residual stands; this decision
changes what happens after untrusted content is read, not whether reading it can be
intercepted.

Taint is per conversation, not per record: once a conversation reads untrusted
content, every write in it asks again for the rest of its life, even a write about
a fact the content never touched. That is a coarser grain than an owner might want,
and it is intentional - a finer grain would require tracking which facts a given
piece of untrusted text could plausibly have influenced, which this decision does
not attempt.

A `trusted`-mode owner has accepted that an injected instruction, arriving before
any web tool taints the conversation, can cause a private, reversible record to be
written without a click. That is a real widening of what a hostile document could
do to a `trusted` account, and it is bounded on every axis that matters: the write
is reversible, so the owner can undo it; private by construction, so it never
reaches another household member; owner-visible, so the owner will see it where the
record naturally surfaces; and captured in the approval decision record as an
auto-approved outcome, so the trail exists even though nobody clicked. The bound is
the tier definition itself doing its job, not a separate mitigation.

The approval decision record is not an owner-facing feature - there is no UI that
reads it yet. It exists so the policy's own behavior is auditable from outside the
policy, and a later surface can be built on it without a schema change.

The domain audit surface marker - a uniform way for a domain write to say which
approval decision authorized it - remains unresolved, a follow-up left out of scope
by the issue that produced this decision.

References: ADR-0237 (Eve tool arguments are requests, not proofs), ADR-0219
(Household Authorization Proofs), ADR-0128 (Phase 3 uses explicit Eve modes),
ADR-0014 (lifecycle fields plus audit for approval), ADR-0092 (Eve Gmail writes use
the shared approval gate).

Update: ADR 0241 implements #557. `update_person` now qualifies through its stored, owner-scoped latest-update inverse; `undo_person_update` itself remains always-ask because there is no redo.
