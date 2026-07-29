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

/**
 * The ceiling no individual sample may exceed, however good the row's median is.
 *
 * The budget above is the contract and {@link summariseSamples} enforces it on
 * the median, which is the statistic ADR 0210 reasons in. That alone would let a
 * row hide one genuinely broken transition behind three good ones, so a single
 * reading past this ceiling still fails on its own. Twice the budget, because the
 * failures this tolerance exists for land a frame or two over it (#331 recorded
 * 103.8 ms and 104.0 ms against 100 ms) while the failures it must still catch
 * are nothing like marginal — the contended two-worker run that ADR 0210's
 * `workers: 1` came from recorded 621 ms on this very row.
 */
export const SAMPLE_CEILING_MULTIPLE = 2;

/**
 * Why a row is gated on its median rather than on every sample (#331).
 *
 * Each stage above is stamped on an animation frame, so no reading can be finer
 * than the cadence the browser is painting at: an acknowledgement is a whole
 * number of frames, and the difference between passing at 99 ms and failing at
 * 104 ms on a two-vCPU runner is one dropped frame. Measured on a workstation,
 * `desktop person detail to Today` acknowledges in 25.8–26.8 ms, indistinguishable
 * from the other two desktop rows (26.2–26.8 ms and 24.9–27.3 ms), and it stays
 * there — 25–28 ms — with the whole rig pinned to a single core. There is no
 * route-specific work in that window to remove, which is why #331 is answered by
 * the statistic and not by the number: `SHELL_BUDGET_MS` is still 100 ms.
 *
 * The row already collects four samples precisely because "a single warm reading
 * on a contended runner is not a median"; gating each of them individually threw
 * that away. Cold and warm are pooled because the cold penalty lands in
 * `complete`, not in the acknowledgement — measured cold 23.3–27.0 ms against
 * warm 15.8–28.6 ms on the same pinned run.
 */
export type SampleSummary = {
  median: number;
  max: number;
  samples: number[];
};

export function summariseSamples(values: number[]): SampleSummary {
  if (values.length === 0) {
    throw new Error("A measured row recorded no samples, so it has nothing to gate.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = at(sorted, middle);

  return {
    median: sorted.length % 2 === 0 ? (at(sorted, middle - 1) + upper) / 2 : upper,
    max: at(sorted, sorted.length - 1),
    samples: values,
  };
}

/**
 * Read one position of a sorted, non-empty sample list.
 *
 * The guard above makes every index below reachable, but the compiler cannot see
 * that, and the alternative — a fallback value — would turn a harness that
 * stopped recording into a row that quietly passed.
 */
function at(sorted: number[], index: number): number {
  const value = sorted[index];
  if (value === undefined) {
    throw new Error(`A measured row has no sample at index ${index} of ${sorted.length}.`);
  }
  return value;
}

/** Render a summary for an assertion message: the statistic and what produced it. */
export function formatSamples(summary: SampleSummary): string {
  const samples = summary.samples.map((value) => Math.round(value)).join(", ");
  return `median ${Math.round(summary.median)}ms of [${samples}]`;
}

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
  )}ms, complete ${Math.round(timing.complete)}ms, CLS ${timing.cumulativeLayoutShift.toFixed(
    4,
  )}, frame ${Math.round(timing.frameIntervalMs)}ms`;
}
