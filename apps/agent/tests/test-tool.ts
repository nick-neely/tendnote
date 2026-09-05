/**
 * Eve 0.32 supports streaming tool results, so its public `execute` type is
 * a union with AsyncIterable. Tendnote's authored tools are all async
 * functions; this test adapter preserves that local contract while keeping
 * the production tool definitions on Eve's public type.
 */
type ToolWithExecute = { execute: (...args: never[]) => unknown };

type ResolvedToolOutput<T> =
  T extends Promise<infer U>
    ? ResolvedToolOutput<U>
    : T extends AsyncIterable<infer U>
      ? ResolvedToolOutput<U>
      : T;

/**
 * Parses an input through the tool's own schema, which is what Eve does before it
 * calls `execute` — the only place a schema `.default()` is applied. Eve's public
 * `inputSchema` type is opaque, so the cast stays here rather than in every test.
 */
export function parseToolInput<T extends ToolWithExecute & { inputSchema: unknown }>(
  tool: T,
  input: unknown,
): Parameters<T["execute"]>[0] {
  const schema = tool.inputSchema as { parse: (value: unknown) => Parameters<T["execute"]>[0] };
  return schema.parse(input);
}

/** The model-facing projection, which is the only part of a result the model reads. */
export function toolModelValue(tool: unknown, output: unknown): Record<string, unknown> {
  const projected = (tool as { toModelOutput: (value: never) => { value: unknown } }).toModelOutput(
    output as never,
  );
  return projected.value as Record<string, unknown>;
}

/**
 * The session principal an approval policy reads. Defaults to the one
 * `lib/eve-auth.ts` stamps for a signed-in owner in web chat, so a test only
 * states the field it is actually varying.
 */
type TestPrincipal = {
  attributes?: Record<string, string | readonly string[]>;
  authenticator?: string;
  principalId?: string;
  principalType?: string;
};

export type ApprovalContextOptions = {
  /** `session.auth.current`. Pass `null` for an unauthenticated turn. */
  principal?: TestPrincipal | null;
  /** The model-supplied tool input, as eve hands it to the policy. */
  toolInput?: Record<string, unknown>;
  /** True for a subagent turn, which eve marks with `session.parent`. */
  subagent?: boolean;
  /** eve's session-wide `once()` memory. A policy with `always` semantics ignores it. */
  approvedTools?: readonly string[];
  toolName?: string;
  callId?: string;
  /** `session.id`. The Session Tool Trust and the decision record are keyed by it. */
  sessionId?: string;
  /** `session.turn.id`. Pass `null` for a context that carries no turn at all. */
  turnId?: string | null;
};

const OWNER_PRINCIPAL: Required<TestPrincipal> = {
  attributes: { channel: "eve" },
  authenticator: "better-auth",
  principalId: "user-1",
  principalType: "user",
};

/**
 * A hand-rolled `ApprovalContext`, in the same spirit as the `ctx` the execute
 * tests build inline.
 *
 * An approval policy reads more of the session than `execute` does — the
 * principal's type and channel attribute, whether the turn is a subagent's, the
 * approved-tools memory — so it needs its own shape rather than the
 * `{ session: { auth: { current: { principalId } } } }` literal those use. The
 * result is deliberately `unknown`-typed at the boundary: it is a stand-in for a
 * framework context whose full shape (`getSandbox`, `getSkill`, `session.turn`)
 * no policy touches.
 */
export function toolApprovalContext(options: ApprovalContextOptions = {}): unknown {
  const principal =
    options.principal === null ? null : { ...OWNER_PRINCIPAL, ...(options.principal ?? {}) };

  const turnId = options.turnId === undefined ? "turn-1" : options.turnId;

  return {
    approvedTools: new Set(options.approvedTools ?? []),
    callId: options.callId ?? "call-1",
    session: {
      id: options.sessionId ?? "session-1",
      auth: { current: principal, initiator: principal },
      ...(turnId === null ? {} : { turn: { id: turnId } }),
      ...(options.subagent === true
        ? { parent: { sessionId: "parent-session-1", turnId: "parent-turn-1" } }
        : {}),
    },
    toolInput: options.toolInput,
    toolName: options.toolName ?? "test_tool",
  };
}

/** The request-time policy a tool declares, or `undefined` when it declares none. */
export function toolApprovalPolicy(
  tool: unknown,
): ((ctx: unknown) => unknown | Promise<unknown>) | undefined {
  const approval = (tool as { approval?: unknown }).approval;
  if (typeof approval === "function") return approval as (ctx: unknown) => unknown;
  // eve also accepts the `{ request, response }` authoring shape.
  const request = (approval as { request?: unknown } | undefined)?.request;
  return typeof request === "function" ? (request as (ctx: unknown) => unknown) : undefined;
}

/**
 * Invoke a tool's approval policy against a hand-rolled context and return its
 * status. Fails loudly when the tool declares no policy, because "this tool is
 * gated" is exactly the claim these tests exist to make.
 */
export async function runToolApproval(
  tool: unknown,
  options: ApprovalContextOptions = {},
): Promise<unknown> {
  const policy = toolApprovalPolicy(tool);
  if (policy === undefined) {
    throw new Error("This tool declares no approval policy, so nothing gates it.");
  }
  return await policy(toolApprovalContext(options));
}

export function asTestTool<T extends ToolWithExecute>(tool: T) {
  type Execute = T["execute"];
  type Output = ResolvedToolOutput<ReturnType<Execute>>;
  return tool as Omit<T, "execute"> & {
    execute: (...args: Parameters<Execute>) => Promise<Output>;
  };
}
