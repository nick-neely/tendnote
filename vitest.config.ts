import { configDefaults, defineConfig } from "vitest/config";

// Root checks must not discover copies of these tests in nested worktrees.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "**/.delta/**"] },
});
