import type { Page } from "@playwright/test";
import { INSTRUMENTATION_KEY, type StageSpec, type StageTiming } from "./instrumentation";

/**
 * The Instant Interaction budgets, in milliseconds (ADR 0210).
 *
 * These are hard gates, not diagnostics. `SHELL_BUDGET_MS` is the 100 ms
 * contract itself; the optimistic and reconciliation budgets are the mutation
 * halves of the same promise.
 */
export const SHELL_BUDGET_MS = 100;
export const OPTIMISTIC_ACK_BUDGET_MS = 100;
export const RECONCILIATION_BUDGET_MS = 500;
export const LAYOUT_SHIFT_BUDGET = 0.01;

const SETTLE_TIMEOUT_MS = 20_000;

/** The shape `instrumentation.ts` installs on `window`, as seen from the page. */
type InPageRecorder = {
  arm(spec: StageSpec): void;
  settled(timeoutMs: number): Promise<StageTiming>;
};

/**
 * Reach the in-page recorder.
 *
 * The lookup is written out at each call site rather than shared, because
 * `page.evaluate` serialises only the function it is given: a helper in module
 * scope would not exist inside the page. A missing recorder throws with its own
 * message, since the alternative — `undefined.arm is not a function` — reads
 * like a harness bug rather than "the init script did not install".
 */
function api(page: Page) {
  return {
    arm: (spec: StageSpec) =>
      page.evaluate(
        ([key, next]) => {
          const recorder = (window as unknown as Record<string, InPageRecorder | undefined>)[
            key as string
          ];
          if (!recorder) throw new Error("The instant-navigation recorder was not installed.");
          return recorder.arm(next as StageSpec);
        },
        [INSTRUMENTATION_KEY, spec] as const,
      ),
    settled: () =>
      page.evaluate(
        ([key, timeout]) => {
          const recorder = (window as unknown as Record<string, InPageRecorder | undefined>)[
            key as string
          ];
          if (!recorder) throw new Error("The instant-navigation recorder was not installed.");
          return recorder.settled(timeout as number);
        },
        [INSTRUMENTATION_KEY, SETTLE_TIMEOUT_MS] as const,
      ),
  };
}

/**
 * Measure one owner-initiated interaction, from the click that started it.
 *
 * The caller supplies the click so the harness never has to guess what the owner
 * actually pressed. Arming happens first, so the page is already watching when
 * the click lands.
 */
export async function measureInteraction(
  page: Page,
  options: StageSpec & { click: () => Promise<void> },
): Promise<StageTiming> {
  const recorder = api(page);
  await recorder.arm({
    toUrl: options.toUrl,
    shell: options.shell,
    authoritative: options.authoritative,
  });
  await options.click();
  return recorder.settled();
}

/** Format a timing for a failure message or a recorded diagnostic. */
export function formatTiming(timing: StageTiming): string {
  const acknowledgement =
    timing.acknowledgement === null ? "n/a" : `${Math.round(timing.acknowledgement)}ms`;
  return `ack ${acknowledgement}, shell ${Math.round(timing.shell)}ms, stable ${Math.round(
    timing.stable,
  )}ms, complete ${Math.round(timing.complete)}ms, CLS ${timing.cumulativeLayoutShift.toFixed(4)}`;
}
