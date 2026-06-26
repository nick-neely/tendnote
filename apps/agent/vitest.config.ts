import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `eve dev` (spawned by withEve) writes source snapshots under `.eve/`,
    // including copies of every *.test.ts. Exclude them so vitest only runs the
    // agent's own evals, not transient build snapshots.
    exclude: [...configDefaults.exclude, "**/.eve/**"],
  },
});
