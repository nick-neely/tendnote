import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror the tsconfig `@/*` -> `./src/*` path alias so component tests can import
// app modules the same way the app does. Scoped to `@/` so workspace packages
// like `@tendnote/db` keep resolving through node.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`,
      },
    ],
  },
});
