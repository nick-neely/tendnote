import type { AsyncLocalStorage } from "node:async_hooks";

type EveContext = { get(key: { name: string }): unknown };
type EveSession = { auth?: { current?: { principalId?: string | null } | null } };

/** Eve keeps one process-wide context store under this symbol (`eve/dist/src/context/container.js`). */
const EVE_CONTEXT_STORAGE = Symbol.for("eve.context-storage");
/** Eve's context key for the session, whose auth tools read as `ctx.session.auth`. */
const EVE_SESSION_KEY = { name: "eve.session" };

/**
 * The account an Eve model call is metered to: the session's authenticated
 * principal, the same owner `resolveOwnerUserId` scopes every tool to.
 *
 * Eve builds its models once at import, before any session, so the model-call
 * entry point calls this when each call starts. Eve runs model calls inside its
 * context store, but exposes no public reader for the session outside a tool or
 * hook, so this reads the store directly. `tests/hosted-models.test.ts` pins it
 * to Eve's real context store; outside a session it returns `null` and the call
 * goes unmetered with a warning.
 */
export function eveSessionAccount(): string | null {
  const storage = (globalThis as Record<symbol, AsyncLocalStorage<EveContext> | undefined>)[
    EVE_CONTEXT_STORAGE
  ];
  const session = storage?.getStore()?.get(EVE_SESSION_KEY) as EveSession | undefined;
  return session?.auth?.current?.principalId?.trim() || null;
}
