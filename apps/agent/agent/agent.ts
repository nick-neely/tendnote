import { defineAgent } from "eve";

export default defineAgent({
  // Default follows the Vercel AI Gateway model id format. Override with
  // TENDNOTE_AGENT_MODEL to compare candidate models.
  model: process.env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-sonnet-5",
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
      "ai",
      "better-auth",
      "drizzle-orm",
      "ioredis",
      "postgres",
      "zod",
    ],
  },
});
