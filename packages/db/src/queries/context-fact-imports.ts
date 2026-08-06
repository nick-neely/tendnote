import { createDefaultContextFactImportAdapter } from "./context-fact-imports/ai-sdk-adapter";
import { createDrizzleContextFactImportStore } from "./context-fact-imports/drizzle-store";
import { createContextFactImportQueries } from "./context-fact-imports/queries";
import type { ImportSelfContextFactsInput } from "./context-fact-imports/types";
import type { ContextFactCallerVerification } from "./context-facts/types";

export { createAiSdkContextFactImportAdapter } from "./context-fact-imports/ai-sdk-adapter";
export { createDrizzleContextFactImportStore } from "./context-fact-imports/drizzle-store";
export { createInMemoryContextFactImportStore } from "./context-fact-imports/in-memory-store";
export { createContextFactImportQueries } from "./context-fact-imports/queries";
export type * from "./context-fact-imports/types";

function createVerifiedContextFactImportQueries(
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createContextFactImportQueries(createDrizzleContextFactImportStore(), {
    resolveVerifiedCaller,
    extractionAdapter: createDefaultContextFactImportAdapter(),
  });
}

export function importSelfContextFacts(
  input: ImportSelfContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactImportQueries(resolveVerifiedCaller).importSelfContextFacts(
    input,
  );
}
