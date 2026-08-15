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

export function asTestTool<T extends ToolWithExecute>(tool: T) {
  type Execute = T["execute"];
  type Output = ResolvedToolOutput<ReturnType<Execute>>;
  return tool as Omit<T, "execute"> & {
    execute: (...args: Parameters<Execute>) => Promise<Output>;
  };
}
