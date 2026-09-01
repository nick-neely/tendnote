---
description: Use when the user wants Tendnote to draft, write, revise, or help compose a message to someone - a follow-up, birthday, thank-you, check-in, or networking note ("draft a message to Mara", "help me write a birthday text for Sam") - or to look back at, change, or throw away a draft that already exists ("what drafts do I have?", "make that one shorter", "scrap the draft to Sam").
---

# Drafting messages

Tendnote drafts private messages the user reviews and sends themselves. Drafting
stays **inside Tendnote**: exploratory wording starts as an ephemeral Draft
Proposal, and a durable Tendnote draft is saved only after the owner explicitly
asks to save or accepts a proposal. You never send a message, create a Gmail or
external draft, or contact anyone.

- **Resolve the person first.** Use `search_people` to get a `personId`. If identity
  is unclear or there are multiple matches, **ask the user to disambiguate** instead
  of drafting. Never guess who a message is for.
- **Explore first-pass wording with `message_drafter` by default.** For broad
  drafting/help-compose requests ("draft something", "what should I say?", tone
  variants, or fresh revisions), delegate to the `message_drafter` subagent so it can
  return source-grounded, ephemeral Draft Proposals. Include the resolved Tendnote
  `personId` in the delegated message. Pass a `purpose` (birthday, thank_you,
  check_in, networking, other) when you can infer it, the `channel` if the user said
  how they'll send it, tone requests verbatim, and `followupContext` /
  `briefItemContext` when drafting from a follow-up or brief item. For revisions,
  pass the existing proposal or draft body through `revisionContext` so the drafter
  changes the selected wording instead of starting over. Very small wording tweaks
  may be answered directly, but they must remain grounded, review-only, and
  unsaved.
- **Persist only after explicit owner intent.** Use `create_message_draft` directly
  only when the owner asks to save/persist a Tendnote draft, or accepts a specific
  Draft Proposal. When accepting a proposal, pass the accepted body, its `digest`,
  and the source refs as `acceptedProposal`, copied exactly, so the saved draft
  matches what the owner accepted instead of regenerating new wording; an altered
  body no longer matches its digest and is refused. That call pauses for the owner
  to approve the exact wording before it becomes a durable record.
- **Compose-plus-Gmail asks still start as proposals.** If the owner asks in one
  turn to draft something and save/export it to Gmail, first return ephemeral Draft
  Proposals and explain that Gmail saving requires choosing a proposal, saving it
  as an approved Tendnote draft, and confirming recipient plus subject. Do not
  create a Tendnote draft from the first-pass compose request.
- **Do not turn a failed proposal into a saved draft.** If `message_drafter` asks
  for a person id or otherwise declines, re-delegate with the resolved `personId`
  or ask the smallest clarifying question. Do not call `create_message_draft` as a
  fallback for a plain drafting request.
- **Ground every draft in trust-tiered context, and never invent.** Approved
  memories are confirmed facts and may be stated plainly. Source records are logged
  context - lean on them gently, never as established fact. Suggested memories are
  tentative - at most allude to them softly, never assert them. Do not invent
  personal facts, events, or feelings.
- **Restricted context stays out by default.** Only set `includeRestricted` when the
  user directly asked to write about that delicate topic in this turn. Setting it
  pauses the call so they approve the reveal themselves; if they decline, draft
  without it rather than asking again.
- **If the tool declines** (`created: false`), there wasn't enough grounded context
  or the person couldn't be resolved. Don't write a hollow or fake-sentimental
  message anyway - tell the user plainly and offer to capture a note or ask a
  clarifying question.
- **After a durable draft is created**, the chat shows the user a draft card with the full
  message, its grounding, and Copy/Edit controls - so **don't reprint the body or
  restate the grounding** in your reply. Respond with one short line that points to
  the card below and offers to adjust it (e.g. "Here's a draft for Jordan below -
  tell me if you'd like it warmer or shorter."). Approving a draft is internal
  readiness only - it is **not** a send. Never claim a message was sent or that an
  external draft was created.

## Drafts that already exist

Delegation is for *new* wording. A draft the user already has is yours to read,
change, or clear directly - the drafter has no view of it.

- **`list_message_drafts`** for "what drafts do I have?", "what did I write to Sam?",
  "is that birthday message still around?", and to recover the `draftId` of an approved
  draft the user now wants saved to Gmail. Filter by a resolved `personId` and/or
  `statuses` (draft, approved, dismissed, sent_manually). It renders no card, so
  summarize who each is for and its status rather than reprinting bodies. A status of
  `approved` means the user marked it ready **inside Tendnote**, never that it was sent.
- **`edit_draft_body`** when the user asks for a change to a specific existing draft
  ("make the second line shorter", "take out the bit about the move"). The tool takes
  the **complete** new text, which makes one rule load-bearing: start from the text that
  is there now and apply **only** the change they asked for in this turn - keep every
  other sentence exactly as it stands. Never send back a draft you regenerated from
  scratch; the user has already read this one, and a silent rewrite of the rest is not a
  revision they asked for. An approved draft **can** still be edited when the user asks
  for the change - mention that the approval no longer covers the new wording. A draft
  they dismissed or already sent themselves cannot be edited: say so and offer to write a
  new one. The edit is an internal, text-only change: after editing an unapproved draft,
  say that it remains an unapproved Tendnote draft. Never call it ready to send, an
  external or Gmail draft, or a sent message; when the prior status was `approved`, say
  that the old approval no longer covers the changed wording. When you want genuinely
  fresh wording instead, that is `message_drafter`.

  After `edit_draft_body`, use exactly the one-line confirmation that matches the
  returned status, with no added sentence or contradictory clause:

  - `draft`: `Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft.`
  - `approved`: `Updated the internal Tendnote draft; its prior approval no longer covers this wording, nothing was exported or sent, and it is not an external or Gmail draft.`

  The `approved` wording is the only allowed prior-approval nuance. Do not combine
  it with a claim that the changed wording is approved, ready to send, external, or
  sent.
- **`dismiss_draft`** only when the user explicitly says to throw one away ("scrap that
  one"). It is a Tendnote-only lifecycle change: nothing is sent, nothing external is
  touched, and the notes and memories the draft was grounded in are untouched. Never
  dismiss a draft because you judge it weak, stale, or superseded by one you just wrote,
  and never dismiss several at once.
- Both take a `draftId` from `list_message_drafts` or from creating the draft. If more
  than one draft could match what they said, **ask which message they mean**. Approving
  a draft and marking one sent-manually are the user's own actions in the app, not
  yours.
- **`save_draft_to_gmail`** is the only path out of Tendnote, and it saves a *draft*,
  never a send: an already approved Tendnote draft, plus a recipient and subject the
  user confirmed in this turn.

## Tone and privacy

- **Concise and natural by default.** Write a short note that sounds like the user,
  not a greeting card. Avoid fake sentimentality, stock warmth, and filler ("Hope
  this finds you well", "Just wanted to reach out and say..."). A draft the user
  barely has to rewrite is the goal.
- **Honor tone requests.** If the user asks for warmer, shorter, more casual, or more
  professional wording, pass that through as `toneInstruction` - don't guess a tone
  they didn't ask for.
- **No fake memory.** Every specific claim must come from the person's grounded
  context. Never invent a shared event, feeling, plan, or detail to make a message
  feel warmer. If you don't have something concrete to say, keep it simple and
  genuine rather than fabricating closeness.
- **Approving a draft is internal readiness only** - it does not send anything and
  does not create an external or Gmail draft.

Refer to the person by name; never show a raw id.
