# Assistant Conversations Are Tendnote Threads Over Eve Sessions

Eve gives every session a durable, resumable event stream, and nothing that can
list one. There is no session index, no "sessions for this user" route, and no
title an application can read back: `$eve.title` is a Vercel Workflow dashboard
tag, write-only from the app's side. `eve_session_owners` already records *who
may attach* to a session id (ADR-0237's neighbour, the ownership guard), but it
holds no name, no activity, and no way to put a conversation away. So the
Assistant could resume a conversation the browser still happened to be holding
the id for, and lose it on the next reload.

## Decision

A conversation is a Tendnote-owned thread that references an Eve session, and
Tendnote owns exactly three facts about it: what it is called, when it was last
used, and whether the owner has archived it. `assistant_conversations` is keyed
by the Eve session id — globally unique, immutable, minted before the row
exists, so a thread and its session cannot drift apart — and cascades with the
owner's account like every other member-owned root.

**The transcript stays Eve's, and stays non-authoritative.** This table holds no
messages. It stores the opening user message, capped, for one reason: to
regenerate a title without replaying the stream. Resuming a conversation means
handing Eve's own `initialSession` + `resume` the id and letting the durable
stream rebuild it, not reading a Tendnote copy. ADR-0029 is unchanged — source
records, memories, follow-ups, briefs, drafts, and audit logs still own durable
product behavior, and no approval, suggestion, or dismissal becomes reachable
only through a chat log. This is the path ADR-0030 named and deferred: "later
follow-up and drafting phases should add Tendnote-owned conversation threads if
users need ChatGPT- or Claude-style resumable conversations. Those threads should
reference Eve session ids and persisted product records." That need has arrived
with the full-page Assistant, and this is that thread, with the same
transcript-is-not-truth line held. The "no transcript persistence" line in
`apps/web/DESIGN.md` §5 is superseded to the extent it read as "no conversation
list"; it still holds for transcripts themselves.

**A session id is an identifier, never an authorization.** Every owner-facing
query carries `owner_user_id` in its own `WHERE` clause, the upsert included
through its conflict path, so naming another owner's session id reads nothing,
writes nothing, and cannot even nudge a stranger's thread up their list. The
answer is byte-identical to naming a session that does not exist, so the
conversation list is not an existence oracle (ADR-0219). The two entry points
that take no owner argument — bumping activity, and writing the first title —
are called only by the agent hook running *inside* that session's own durable
execution, which is a stronger proof of authority than any argument, and neither
is reachable from a web request.

**Titles are a two-step ladder, not a model dependency.** The first message
writes a placeholder immediately: the owner's own opening words, clipped on a
word boundary, free and instant. The first turn's completion then replaces it
once with a five-word model title. `title_source` is what makes that safe to
retry: only a `placeholder` is ever overwritten, so a retried turn, a second
hook invocation, or a rename that lands mid-turn all leave the standing title
alone, and the person's own words always win over the model's. Titling is
best-effort throughout — the hook is wrapped, logs at `warn`, and never throws,
because a thread that keeps its placeholder is a cosmetic loss and a failed turn
is not — and `TENDNOTE_ASSISTANT_TITLES=off` removes the model call entirely.

Both the browser and the agent write the row. The browser learns the session id
first (`onSessionChange`) so the thread is listable before the first reply lands;
the hook writes the same row from inside the session because it is the one that
cannot be skipped. Both are idempotent and neither depends on the other arriving
first.

## Consequences

**Eve's session lifetime bounds what "resumable" means.** `limits.sessionTimeoutMs`
defaults to 30 days, absolute from creation. Stored session data is not deleted
at expiry, but the session stops accepting messages: a follow-up returns
`409 session_not_active`. A thread older than that therefore still lists, still
opens, and still renders its history, and cannot be continued. The Assistant must
render that state as a plain fact with a way forward — the conversation is closed,
start a new one — rather than as an error, and must not offer a composer that will
fail. Raising `sessionTimeoutMs` in `apps/agent/agent/agent.ts` moves the boundary
but does not remove it, and is a separate decision with its own storage cost.

Archiving is reversible and destroys nothing: the Eve session is untouched, so an
unarchived thread opens where it was left. Deletion is deliberately absent for
now — there is no way to erase an Eve session's durable stream from Tendnote, so a
"delete" that only dropped this row would be a promise the system cannot keep.
Owner account deletion is the exception that works, because the cascade takes the
row and the account's admission together.

Every write is owner-scoped, the agent hook's included. Running inside a
session's own durable execution proves *which session*, not which row: the table
is keyed by session id, and a session id can be named by anyone, so the hook
carries the principal the channel's `AuthFn` stamped into its activity bump and
its title write rather than filtering on the id alone. The one entry point that
can create a row — the browser's claim — cannot be protected by a `WHERE` clause
at all, because the row does not exist yet, so it verifies the id against
`eve_session_owners` before inserting and records nothing for an id that is
unbound or bound to someone else; the hook's own upsert creates that row
authoritatively from inside the session regardless, so refusing costs the rail a
moment and never the thread.

Only top-level `web_chat` sessions are recorded. A Discord session, a scheduled
run, and a subagent turn all resolve to a different mode from the principal the
channel's own `AuthFn` stamped (ADR-0128), so none of them can appear in a
person's conversation list, and none of them spend a model call on a title.

References: ADR-0029 (conversation is not source of truth), ADR-0030 (defer
threaded conversation model), ADR-0128 (Eve modes), ADR-0219 (household
authorization proofs / uniform opaque denial), ADR-0237 (Eve tool arguments are
requests, not proofs).
