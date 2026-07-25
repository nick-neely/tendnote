import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

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
  test: {
    // `tests/instant` is the Playwright matrix (#310): its `*.spec.ts` files
    // match Vitest's default include but are driven by a real browser against a
    // production build, not by Vitest.
    exclude: [...configDefaults.exclude, "**/*.browser.test.{ts,tsx}", "tests/instant/**"],
  },
});
