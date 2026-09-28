import { describe, expect, it } from "vitest";
import { BEAT_COUNT, beatForProgress, beats, progressForBeat } from "./loop-script";

describe("beatForProgress", () => {
  it("starts on the first beat and ends on the last", () => {
    expect(beatForProgress(0)).toEqual({ beat: 0, t: 0 });
    expect(beatForProgress(1)).toEqual({ beat: BEAT_COUNT - 1, t: 1 });
  });

  it("gives every beat an equal slice of the scroll", () => {
    for (let index = 0; index < BEAT_COUNT; index += 1) {
      const start = index / BEAT_COUNT;
      expect(beatForProgress(start).beat).toBe(index);
      expect(beatForProgress(start + 0.5 / BEAT_COUNT).beat).toBe(index);
      expect(beatForProgress(start + 0.5 / BEAT_COUNT).t).toBeCloseTo(0.5);
    }
  });

  it("clamps out-of-range and non-finite input instead of throwing", () => {
    expect(beatForProgress(-3)).toEqual({ beat: 0, t: 0 });
    expect(beatForProgress(7).beat).toBe(BEAT_COUNT - 1);
    expect(beatForProgress(Number.NaN)).toEqual({ beat: 0, t: 0 });
  });
});

describe("progressForBeat", () => {
  it("lands in the middle of the beat it names", () => {
    for (let index = 0; index < BEAT_COUNT; index += 1) {
      const result = beatForProgress(progressForBeat(index));
      expect(result.beat).toBe(index);
      expect(result.t).toBeCloseTo(0.5);
    }
  });

  it("clamps to the story", () => {
    expect(beatForProgress(progressForBeat(-1)).beat).toBe(0);
    expect(beatForProgress(progressForBeat(99)).beat).toBe(BEAT_COUNT - 1);
  });
});

describe("beats", () => {
  it("tells the loop in order: capture, memory, follow-up, today, ask", () => {
    expect(beats.map((beat) => beat.id)).toEqual(["capture", "memory", "followup", "today", "ask"]);
  });
});
