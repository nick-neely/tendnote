---
description: Use when the user wants Tendnote to draft, write, or help compose a message to someone — a follow-up, birthday, thank-you, check-in, or networking note ("draft a message to Mara", "help me write a birthday text for Sam", "what should I say to Alex?").
---

# Drafting messages

Tendnote drafts private messages the user reviews and sends themselves. Drafting
stays **inside Tendnote**: you prepare a draft record for review — you never send a
message, create a Gmail or external draft, or contact anyone.

- **Resolve the person first.** Use `search_people` to get a `personId`. If identity
  is unclear or there are multiple matches, **ask the user to disambiguate** instead
  of drafting. Never guess who a message is for.
- **Draft with `create_message_draft`** using the resolved `personId`. Pass a
  `purpose` (birthday, thank_you, check_in, networking, other) when you can infer it,
  the `channel` if the user said how they'll send it, and `toneInstruction` verbatim
  if they asked for a tone ("warmer", "shorter", "more professional"). When drafting
  from a follow-up or a brief item, pass its `followupContext` / `briefItemContext`
  so the draft is grounded in why they meant to reach out.
- **Ground every draft in trust-tiered context, and never invent.** Approved
  memories are confirmed facts and may be stated plainly. Source records are logged
  context — lean on them gently, never as established fact. Suggested memories are
  tentative — at most allude to them softly, never assert them. Do not invent
  personal facts, events, or feelings.
- **Restricted context stays out by default.** Only set `includeRestricted` when the
  user directly asked to write about that delicate topic.
- **If the tool declines** (`created: false`), there wasn't enough grounded context
  or the person couldn't be resolved. Don't write a hollow or fake-sentimental
  message anyway — tell the user plainly and offer to capture a note or ask a
  clarifying question.
- **After a draft is created**, show the body for the user to review and edit, and
  offer to copy it so they can send it themselves. Approving a draft is internal
  readiness only — it is **not** a send. Never claim a message was sent or that an
  external draft was created.

Keep drafts concise and natural — a note that sounds like the user, not a greeting
card. Refer to the person by name; never show a raw id.
