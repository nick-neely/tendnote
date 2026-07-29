/**
 * The in-page half of the navigation measurement.
 *
 * Every budget in ADR 0210 is expressed in milliseconds from the owner's click,
 * and the only clock that can see that interval honestly is the page's own. A
 * shell can commit in under 10 ms, so driving the wait from Node would fold one
 * or more CDP round trips into a reading whose budget is 100 ms — the harness
 * would be measuring itself. So the recorder is armed with what to look for
 * *before* the click, starts its own frame loop from a capture-phase click
 * listener, and stamps each stage the first frame it becomes true. Node only
 * reads the finished numbers.
 *
 * The stage definitions match the recorded 16.2 baseline
 * (`docs/research/nextjs-16-current-navigation-baseline.md`, "Timing
 * definitions") so the two are directly comparable:
 *
 * - **acknowledgement** — click to the destination URL plus the next frame.
 * - **shell** — click to the truthful destination marker being on screen.
 * - **complete** — click to the authoritative marker, then a frame and 50 ms
 *   with no DOM mutation.
 */

export const INSTRUMENTATION_KEY = "__tendnoteInstant";

/** A DOM condition expressed so it can be evaluated inside the page. */
export type MarkerSpec = {
  /** CSS selector the element must match. */
  selector: string;
  /** Optional substring the element's rendered text must contain. */
  text?: string;
  /**
   * Optional alternative substrings, any one of which satisfies the marker.
   *
   * Needed because a shell marker has to stay true across the whole 0–100 ms
   * window. With Partial Prefetching a destination sometimes commits its
   * reserve and sometimes commits straight to settled content, so a marker
   * that only matches the reserve would pass or fail on prefetch timing rather
   * than on the contract.
   */
  anyText?: string[];
  /** When true, the marker is satisfied by the *absence* of a visible match. */
  absent?: boolean;
};

/** What the recorder is asked to watch for during one interaction. */
export type StageSpec = {
  /** `pathname + search` of the destination, or null for a same-page mutation. */
  toUrl: string | null;
  /** The truthful shell, or the optimistic acknowledgement of a mutation. */
  shell: MarkerSpec[];
  /** Settled authoritative content. */
  authoritative: MarkerSpec[];
};

export type StageTiming = {
  /** Click to destination URL plus a frame, in milliseconds. Null for mutations. */
  acknowledgement: number | null;
  /** Click to truthful shell (or optimistic acknowledgement), in milliseconds. */
  shell: number;
  /** Click to settled authoritative content, in milliseconds. */
  complete: number;
  /**
   * Click to the first frame after 50 ms with no DOM mutation, regardless of
   * what is on screen. This is the recorded 16.2 baseline's "complete"
   * definition exactly, kept separately so the upgrade comparison is like for
   * like — `complete` above additionally requires the owner's content, which
   * the baseline never checked.
   */
  stable: number;
  /** Layout shift accumulated between the click and settled content. */
  cumulativeLayoutShift: number;
  /**
   * Median interval between the animation frames observed during this
   * interaction, in milliseconds.
   *
   * Every stage above is stamped on a frame boundary, so no reading can be finer
   * than the cadence the browser is actually painting at: an acknowledgement is
   * always some whole number of frames. On a quiet machine that quantum is
   * ~16.7 ms and it disappears into the budget; on a contended two-vCPU runner it
   * is not, and a reading then says as much about the runner's compositor as
   * about the application. Recording it alongside the timings is what lets a
   * later reader tell "the route got slower" from "the runner dropped frames"
   * without re-running anything — the distinction #331 had no evidence for.
   */
  frameIntervalMs: number;
};

/**
 * Serialised so `page.addInitScript` can install it before any application code
 * runs. Written as one self-contained function on purpose: the init script is
 * evaluated in the page realm and cannot close over module scope.
 */
export function instrumentationScript(key: string): string {
  return `(${installRecorder.toString()})(${JSON.stringify(key)});`;
}

/* c8 ignore start -- this body executes in the browser, not in Node. */
function installRecorder(key: string) {
  type MarkerLike = { selector: string; text?: string; anyText?: string[]; absent?: boolean };

  type Spec = {
    toUrl: string | null;
    shell: MarkerLike[];
    authoritative: MarkerLike[];
  };

  let spec: Spec | null = null;
  let armedAt: number | null = null;
  let lastMutationAt = 0;
  let layoutShift = 0;
  let frameTimes: number[] = [];
  let result: {
    acknowledgement: number | null;
    shell: number | null;
    complete: number | null;
    stable: number | null;
  } = { acknowledgement: null, shell: null, complete: null, stable: null };
  let settle: ((value: unknown) => void) | null = null;
  let running = false;

  // `document`, not `document.documentElement`: an init script runs before the
  // parser has created the root element, and observing null throws — which would
  // silently leave the recorder uninstalled and every reading undefined.
  new MutationObserver(() => {
    lastMutationAt = performance.now();
  }).observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[]) {
        // A shift the owner caused by interacting is not a layout-stability
        // failure; only unattributed movement counts against the budget.
        if (!entry.hadRecentInput && armedAt !== null) layoutShift += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // Engines without the layout-instability API report 0. ADR 0210 gates CLS
    // on Chromium only, so that is the intended degradation.
  }

  function matches(marker: MarkerLike): boolean {
    const visible = Array.from(document.querySelectorAll(marker.selector)).filter((node) => {
      const element = node as HTMLElement;
      const text = element.textContent ?? "";
      if (marker.text && !text.includes(marker.text)) return false;
      if (marker.anyText && !marker.anyText.some((candidate) => text.includes(candidate))) {
        return false;
      }
      return (
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"
      );
    });
    return marker.absent ? visible.length === 0 : visible.length > 0;
  }

  function currentUrl(): string {
    return location.pathname + location.search;
  }

  /** The frame cadence this interaction was measured at. 0 before two frames. */
  function frameInterval(): number {
    const gaps: number[] = [];
    for (let index = 1; index < frameTimes.length; index += 1) {
      const current = frameTimes[index];
      const previous = frameTimes[index - 1];
      if (current === undefined || previous === undefined) continue;
      gaps.push(current - previous);
    }
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] ?? 0;
  }

  function tick(frameTime: number) {
    if (!spec || armedAt === null) return;

    frameTimes.push(frameTime);

    // A `requestAnimationFrame` callback receives the timestamp of the frame it
    // belongs to, which can predate the click handler that armed the recorder
    // when both run inside the same frame. Clamping keeps that from reading as a
    // negative interaction time.
    const now = Math.max(frameTime, armedAt);

    if (result.acknowledgement === null && (spec.toUrl === null || currentUrl() === spec.toUrl)) {
      result.acknowledgement = now - armedAt;
    }
    if (result.shell === null && spec.shell.every(matches)) {
      result.shell = now - armedAt;
    }
    if (result.stable === null && now - lastMutationAt > 50) {
      result.stable = now - armedAt;
    }
    if (
      result.complete === null &&
      spec.authoritative.every(matches) &&
      now - lastMutationAt > 50
    ) {
      result.complete = now - armedAt;
    }

    if (finished() && settle) {
      const resolve = settle;
      settle = null;
      resolve(undefined);
    }
  }

  function finished(): boolean {
    return result.acknowledgement !== null && result.shell !== null && result.complete !== null;
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame((now) => {
      // `now` is the frame's own timestamp — what the owner would have seen —
      // rather than `performance.now()`, which already includes this callback.
      tick(now);
      if (finished()) {
        running = false;
        return;
      }
      loop();
    });
  }

  // The loop runs from the click itself, not from the moment the test process
  // asks for a reading: a shell can commit before a CDP round trip completes.
  document.addEventListener(
    "click",
    () => {
      if (!spec) return;
      armedAt = performance.now();
      lastMutationAt = armedAt;
      layoutShift = 0;
      frameTimes = [];
      running = true;
      loop();
    },
    { capture: true },
  );

  const api = {
    /** Describe the interaction about to happen. Must precede the click. */
    arm(next: Spec) {
      spec = next;
      armedAt = null;
      running = false;
      settle = null;
      frameTimes = [];
      result = { acknowledgement: null, shell: null, complete: null, stable: null };
    },
    /** Resolve once every armed stage has been recorded. */
    async settled(timeoutMs: number) {
      if (armedAt === null) {
        throw new Error("The navigation recorder was armed but no click reached the document.");
      }

      if (!finished()) {
        const waiter = new Promise((resolve) => {
          settle = resolve;
        });
        const timeout = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Interaction did not settle within ${timeoutMs}ms. Recorded ${JSON.stringify(result)}.`,
                ),
              ),
            timeoutMs,
          ),
        );
        await Promise.race([waiter, timeout]);
      }

      return {
        acknowledgement: spec?.toUrl === null ? null : result.acknowledgement,
        shell: result.shell as number,
        complete: result.complete as number,
        stable: result.stable as number,
        cumulativeLayoutShift: layoutShift,
        frameIntervalMs: frameInterval(),
      };
    },
  };

  (window as unknown as Record<string, unknown>)[key] = api;
}
/* c8 ignore stop */
