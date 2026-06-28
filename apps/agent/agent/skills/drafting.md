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
- **After a draft is created**, the chat shows the user a draft card with the full
  message, its grounding, and Copy/Edit controls — so **don't reprint the body or
  restate the grounding** in your reply. Respond with one short line that points to
  the card below and offers to adjust it (e.g. "Here's a draft for Jordan below —
  tell me if you'd like it warmer or shorter."). Approving a draft is internal
  readiness only — it is **not** a send. Never claim a message was sent or that an
  external draft was created.

## Tone and privacy

- **Concise and natural by default.** Write a short note that sounds like the user,
  not a greeting card. Avoid fake sentimentality, stock warmth, and filler ("Hope
  this finds you well", "Just wanted to reach out and say..."). A draft the user
  barely has to rewrite is the goal.
- **Honor tone requests.** If the user asks for warmer, shorter, more casual, or more
  professional wording, pass that through as `toneInstruction` — don't guess a tone
  they didn't ask for.
- **No fake memory.** Every specific claim must come from the person's grounded
  context. Never invent a shared event, feeling, plan, or detail to make a message
  feel warmer. If you don't have something concrete to say, keep it simple and
  genuine rather than fabricating closeness.
- **Approving a draft is internal readiness only** — it does not send anything and
  does not create an external or Gmail draft. Sends and external drafts wait for a
  later, explicitly approved phase.

Refer to the person by name; never show a raw id.
