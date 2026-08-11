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

export function asTestTool<T extends ToolWithExecute>(tool: T) {
  type Execute = T["execute"];
  type Output = ResolvedToolOutput<ReturnType<Execute>>;
  return tool as Omit<T, "execute"> & {
    execute: (...args: Parameters<Execute>) => Promise<Output>;
  };
}
