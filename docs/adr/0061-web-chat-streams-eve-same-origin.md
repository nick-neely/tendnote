# Web Chat Streams Eve Same-Origin

> Authentication was revised by ADR 0194 after production topology verification.
> Same-origin streaming and the separate Eve service remain the active decision.

The connected web chat should stream Eve turns client-side from a same-origin Eve mount, not proxy them through a Next.js server function. `apps/web/next.config.ts` wraps the config with `withEve()` (`eve/next`), which spawns the Eve agent (`apps/agent`, via `eveRoot`) and rewrites `/eve/v1/*` to it. The assistant panel uses `useEveAgent` (`eve/react`) so the browser opens Eve's session and NDJSON turn stream directly. This supersedes the earlier two-app bridge, where a server action read the whole turn with `eve/client`'s `response.result()`; that server-side blocking read did not reliably terminate in the Next runtime and hung the chat.

Owner scoping stays a single authenticated boundary (ADR 0001). Because hosted `withEve()` routing reaches the separate agent service before Next.js filesystem routing, the Eve channel validates the Better Auth session cookie directly and derives the owner from that verified session (ADR 0194). The agent is not moved or merged; it stays in `apps/agent` with its own build and evals, just served same-origin in dev/prod.

Chat is semi-ephemeral. Eve sessions carry short-term multi-turn continuity for drafting and review (ADR 0030); Tendnote stores no chat transcript. Durable product state remains in source records, memories, follow-ups, and drafts (ADR 0029), and streamed tool results still render as components that reference persisted record ids (ADR 0028). Explicit person context still rides along on each turn's client context (ADR 0031). The `TENDNOTE_EVE_URL` env var and the `src/lib/eve` bridge/transport are removed.
