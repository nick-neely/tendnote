import { defineAgent } from "eve";

export default defineAgent({
  // Default follows the Vercel AI Gateway model id format. Override with
  // TENDNOTE_AGENT_MODEL to compare candidate models.
  model: process.env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-haiku-4.5",
  build: {
    // The @tendnote/db snapshot path pulls the `ai` SDK, whose internal dynamic
    // imports make Rolldown emit multiple chunks; eve requires one chunk per
    // authored tool. Keep the AI SDK and ordinary runtime dependencies external
    // so the dev build does not rebundle them. Workspace packages stay bundled:
    // their extensionless TypeScript imports are not directly runnable by Node.
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
