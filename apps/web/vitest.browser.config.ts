import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../node_modules/.vite-tendnote-browser",
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "@testing-library/dom",
      "class-variance-authority",
      "clsx",
      "@phosphor-icons/react/dist/ssr",
      "next/navigation",
      "radix-ui",
      "react",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "tailwind-merge",
      "zod",
    ],
  },
  resolve: {
    alias: [
      {
        find: /^@\/app\/actions\/(general-actions|general-action-areas|suggested-general-actions)$/,
        replacement: fileURLToPath(new URL("./src/test/browser-actions.ts", import.meta.url)),
      },
      {
        find: /^@\/app\/actions\/(conversational-capture|global-recall|reminders|today)$/,
        replacement: fileURLToPath(new URL("./src/test/browser-actions.ts", import.meta.url)),
      },
      {
        find: /^@\/app\/actions\/(asset-evidence|asset-review|memory-review)$/,
        replacement: fileURLToPath(new URL("./src/test/browser-actions.ts", import.meta.url)),
      },
      {
        find: /^next\/link$/,
        replacement: fileURLToPath(new URL("./src/test/next-link-mock.tsx", import.meta.url)),
      },
      {
        find: /^@\/components\/(asset-review-group-card|suggested-general-action-review)$/,
        replacement: fileURLToPath(
          new URL("./src/test/browser-review-components.tsx", import.meta.url),
        ),
      },
      {
        find: /^next\/navigation$/,
        replacement: fileURLToPath(new URL("./src/test/browser-actions.ts", import.meta.url)),
      },
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`,
      },
    ],
  },
  test: {
    include: ["src/**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      viewport: { width: 390, height: 844 },
      screenshotFailures: false,
    },
  },
});
