import { afterEach, describe, expect, it, vi } from "vitest";
import followupLifecycle from "../evals/behavior/followup-lifecycle.eval";
import actionMutation from "../evals/behavior/general-action-explicit-mutation.eval";

afterEach(() => vi.useRealTimers());

describe("lifecycle evaluation dates", () => {
  it.each(["2026-09-22T23:59:59Z", "2027-12-31T23:59:59Z"])(
    "uses concrete future dates even when run on %s",
    async (now) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      for (const evaluation of [followupLifecycle, actionMutation]) {
        const prompts: string[] = [];
        const scope = new Proxy(
          { events: [], message: "", inputRequests: [], status: "completed" },
          {
            get: (target, key) =>
              key === "then" ? undefined : (Reflect.get(target, key) ?? (() => {})),
          },
        );
        const context = new Proxy(
          {
            start: async (prompt: string) => {
              prompts.push(prompt);
              return { session: scope, result: async () => scope };
            },
            send: async (prompt: string) => {
              prompts.push(prompt);
              return scope;
            },
          },
          {
            get: (target, key) =>
              key === "then" ? undefined : (Reflect.get(target, key) ?? (() => {})),
          },
        );
        await evaluation.test(context as never);
        const dates = prompts.flatMap(
          (prompt) => prompt.match(/\d{4}-\d{2}-\d{2}|August \d{1,2}, 2026/g) ?? [],
        );
        expect(dates).toHaveLength(evaluation === followupLifecycle ? 2 : 1);
        for (const date of dates) expect(new Date(date).getTime()).toBeGreaterThan(Date.now());
        const [created, snoozed] = dates;
        if (created && snoozed) {
          expect(new Date(snoozed).getTime()).toBeGreaterThan(new Date(created).getTime());
        }
      }
    },
  );
});
