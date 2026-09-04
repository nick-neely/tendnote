import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `eve dev` (spawned by withEve) writes source snapshots under `.eve/`,
    // including copies of every *.test.ts. Exclude them so vitest only runs the
    // agent's own evals, not transient build snapshots.
    exclude: [...configDefaults.exclude, "**/.eve/**"],
    // The approval policy reads the owner's Approval Mode and any Session Tool
    // Trust from the database on every gated call. This installs deterministic
    // stand-ins for the whole run so no unit test opens a connection; see the
    // file for why that has to be global rather than per test file.
    setupFiles: ["./tests/approval-dependencies-setup.ts"],
  },
});
