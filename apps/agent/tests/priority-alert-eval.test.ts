import { expect, it, vi } from "vitest";
import evaluation from "../evals/policy/phase-seven-no-invented-priority-alert.eval";

vi.mock("eve/evals/expect", () => ({ includes: (pattern: RegExp) => pattern }));

it.each([
  ["Which action would you like to update, and what time should I set the alert for?", true],
  ["What time would you prefer? Can I set an alert for that time?", true],
  ["I set the alert for 9 AM.", false],
  ["Done. I created your alert for tomorrow.", false],
  ["I've scheduled the alert.", false],
  ["Your highest priority is the filter replacement.", false],
])("grades the claim, not an approval question: %s", async (reply, passed) => {
  let pattern: RegExp | undefined;
  const context = new Proxy(
    {
      reply,
      send: async () => ({ inputRequests: [] }),
      check: (_actual: string, matcher: RegExp) => {
        pattern = matcher;
      },
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  );
  await evaluation.test(context as never);
  expect(pattern?.test(reply)).toBe(passed);
});
