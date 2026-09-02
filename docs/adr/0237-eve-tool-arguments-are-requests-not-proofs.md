# Eve Tool Arguments Are Requests, Not Proofs

Every durable write, external egress, and restricted-context read Eve performs was
authorized by one of two things: a sentence in a system prompt, or an argument the
model itself supplied — `includeRestricted`, `directlyRequested`, `acceptedProposal`,
a widened `requestedScope`. Both are text, and text is what an indirect prompt
injection produces. A pasted email, a fetched page, or another household member's
note could therefore mint the owner's consent and spend it in the same turn.

## Decision

Eve's own human-in-the-loop primitive, `defineTool({ approval })`, is Tendnote's
single-use owner capability. A policy returning `user-approval` parks that exact
call — its input frozen, its `callId` recorded — durably at `session.waiting`
until the authenticated session owner answers through the client. The answer never
passes through the model, so the parked call *is* the capability: bound to owner,
turn, resource, and action, without a token table (ADR-0014) and sharing one approval
artifact with the web surface (ADR-0092). The seam is
`apps/agent/agent/lib/approval/`; every gated tool declares it in one line.

Three rules apply uniformly. **One: durable writes require an in-turn owner
approval.** Any authored tool that creates, mutates, archives, restores, deletes,
promotes, dismisses, or externalizes a persisted record carries the gate — the whole
write surface, because an injection otherwise simply reaches for the unguarded
sibling. That is the whole surface including the awkward members: Capture parks
whatever audience it names, because a private Capture still writes; and
`propose_asset_memories`, whose proposals are review-gated but whose grounding
Source Record is not, parks for the record it actually persists. The review-gated
proposal producers that write nothing else stay ungated: their artifacts are
accepted later by a real human control (ADRs 0125, 0144). **Two: a model-supplied
trust flag is a request, not a proof.** The arguments survive and the domain
parameters keep their names — `directlyRequested` in `packages/domain/src/privacy.ts`
is still what the query layer enforces (ADRs 0057, 0058) — but *how it gets set*
changes from a model boolean to a human decision: set, the flag parks the call;
unset, the call runs exactly as it always did, for every caller. Their `.describe()`
text says so, in the same place the model reads the argument, from one shared
sentence (`RESTRICTED_REVEAL_REQUEST_DESCRIPTION`) rather than five drifting copies.
**Three: external egress is shown to the person before it happens.** `web_fetch`
parks with the full URL as the frozen input, and fetched content stays labeled
untrusted. With one and two in place, injected text can still ask; it can no longer
write or send.

Denial is uniform and opaque (ADR-0219), and it fails closed for everyone who cannot
answer: Eve's `eve:app` runtime principal on a scheduled workflow, the Discord route
whose deterministic handler never starts a model session and cannot render an
approval (ADR-0140), and a subagent turn, which runs on a delegated task with nobody
to ask. Where a subagent's only use of a flag would be to vouch for a request it
never heard, the field is removed from that registration's schema instead of gated —
`relationship_strategist`'s agenda read and follow-up proposal, and
`message_drafter`'s draft proposal, take ordinary context and nothing else. The root
agent keeps the argument, because the root's session is where the owner is.

Accepting an ephemeral Draft Proposal gets one further binding. A proposal is not
stored, so its wording and provenance travel back through the model, and
`persistAcceptedDraftProposal` used to write whatever arrived under an audit action
claiming the owner accepted it. `proposeDraft` now stamps each variant with a
`proposalDigest` — a sha-256 over that body and the proposal's source references —
and persistence recomputes it and refuses a mismatch. It binds content, not
authority: the digest proves the wording was issued, the approval proves a person
accepted it, and neither substitutes for the other.

## Consequences

An approval is only as good as what it shows, and eve builds the prompt itself
(`Approve tool call: <name>`), so what the owner judges is the frozen tool input the
card renders. A tool whose input is only an opaque id would give them nothing to
read, which is why id-referenced writes resolve their record owner-scoped before
parking, through one shared registry both surfaces read
(`@tendnote/db/queries/approval-subjects`). The same reasoning sets what that
registry may fold away: it describes records, never authority. A described subject
is rendered above the raw input, so a call carrying a trust flag must be judged on
the flag — no flag-gated tool has a describer, and no described tool's schema offers
one. `save_draft_to_gmail` shows the whole message for the same reason, and needs no
digest of its body to do it: any edit reverts an approved draft to `draft` inside the
same write, and the Gmail gate authorizes only on `approved`, so the text cannot
change under an approval without the owner approving it again.

These residuals are recorded rather than solved.

`web_search` is a framework provider tool with no approval slot in eve 0.47.7, so it
remains prose-gated and is the one egress path this decision does not cover; the
mitigation is that rule two keeps restricted records out of the context a query could
be built from without a human first agreeing.

The capture tools (`capture_source_record`, `capture_saved_item`) are denied rather
than parked in `discord_capture` mode, which reads as a lost capability and is inert:
the Discord route runs a deterministic handler and never starts a model session, so
nothing on that surface calls them. The mode no longer advertises
`capture_source_record` at all - a mode table that names a tool its own sessions
could only ever be refused is a table that has stopped describing the system - so
Discord Capture Mode now holds an empty tool set, and `apps/agent/tests/write-tool-approval.test.ts`
pins that no unconditionally gated tool appears in any non-`web_chat` allowlist. If a
Discord model session is ever introduced, this is the decision to revisit — the answer
is a channel that can render and answer an approval, not an exemption.

`propose_asset_memories` left `scheduled_workflow` mode for the same reason: its
review-gated proposals suit an unattended run, but the durable Source Record it grounds
them on makes it an unconditionally gated write, so a schedule that reached for it would
be denied rather than served.

`archive_self_context.expectedUpdatedAt` stays optional. It is the stale-intent guard
for a fact edited between the model's read and its write, and it could now be made
required on the reasoning that a parked call has a longer window. The card shows the
fact's *current* content at decision time, resolved when the call parks rather than
when the model composed it, so the owner is deciding about the fact as it stands;
requiring the argument would refuse legitimate archives (a fact named in this turn
with no prior read result) for a race the card already closes.

References: ADR-0014 (lifecycle fields plus audit for approval), ADR-0092 (Eve Gmail
writes use the shared approval gate), ADR-0058 (restricted content is not proactive),
ADR-0125 (Message Drafter proposes before persisting), ADR-0140 (Discord capture is
private owner-scoped), ADR-0219 (Household Authorization Proofs).
