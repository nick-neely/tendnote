import { hostedModel } from "@tendnote/db/queries/model-calls";
import { defineAgent } from "eve";

export default defineAgent({
  // Default follows the Vercel AI Gateway model id format. Override with
  // TENDNOTE_AGENT_MODEL to compare candidate models. The model-call entry point
  // pins Gemini to Vertex with the gateway's privacy flags, so an Eve turn never
  // reaches the Gemini Developer API. Eve 0.47.7 compiles a gateway instance's id
  // as `gateway/<model id>`, which has no catalog context window; the pinned Eve
  // patch keeps the gateway model id, matching how Eve's runtime resolves it.
  model: hostedModel({
    modelId: process.env.TENDNOTE_AGENT_MODEL ?? "google/gemini-3.7-flash",
    costCategory: "interactive",
  }),
  /**
   * Thought summaries, so the Assistant can show a thinking disclosure.
   *
   * Eve has no `sendReasoning` switch: it forwards reasoning the moment the
   * provider emits any, as `reasoning.appended` deltas closed by
   * `reasoning.completed` (`eve/dist/src/harness/emission.js`), which the
   * client reducer projects as a `reasoning` message part. So the only thing
   * to configure here is whether the provider emits thoughts at all, and how
   * much it is allowed to think.
   *
   * ## Why the budget is `reasoning`, not `thinkingConfig.thinkingBudget`
   *
   * `reasoning` is the provider-agnostic effort knob; eve passes it straight to
   * `streamText` (`harness/tool-loop.js`). Each provider translates it into the
   * control its own API actually wants, and every branch matters here because
   * `TENDNOTE_AGENT_MODEL` can point at any model the entry point pins, Gemini
   * or OpenAI (any other creator fails closed at startup):
   *
   * - A Gemini 3 model gets `thinkingConfig.thinkingLevel: "low"`; a Gemini 2.5
   *   model gets a computed `thinkingConfig.thinkingBudget`. Authoring a literal
   *   `thinkingBudget` would not replace that - the provider merges authored
   *   keys *over* the effort-derived ones (`{...fromEffort, ...authored}`), so a
   *   Gemini 3 request would carry `thinkingLevel` and `thinkingBudget`
   *   together, two mutually exclusive thinking controls in one call.
   * - An OpenAI reasoning model gets its `reasoningEffort` from it, so an
   *   authored `openai` block would only duplicate the effort.
   *
   * `includeThoughts` is the exception: it carries no effort semantics, it is
   * Google-only, and without it Gemini thinks silently and the disclosure has
   * nothing to show.
   */
  reasoning: "low",
  modelOptions: {
    providerOptions: {
      google: { thinkingConfig: { includeThoughts: true } },
    },
  },
  build: {
    // The @tendnote/db snapshot path pulls the `ai` SDK, whose internal dynamic
    // imports make Rolldown emit multiple chunks; eve requires one chunk per
    // authored tool. Keep the AI SDK and ordinary runtime dependencies external
    // so the dev build does not rebundle them. Workspace packages stay bundled:
    // their extensionless TypeScript imports are not directly runnable by Node.
    // Every external package below must be a direct production dependency of
    // @tendnote/agent: Eve executes the generated snapshot from this package's
    // resolution boundary, not from a workspace dependency's node_modules.
    externalDependencies: [
      "@better-auth/redis-storage",
      "@vercel/queue",
      "@vercel/blob",
      "ai",
      "better-auth",
      "drizzle-orm",
      "ioredis",
      "postgres",
      "zod",
    ],
  },
});
