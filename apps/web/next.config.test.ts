import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { describe, expect, it } from "vitest";
import { nextConfigForPhase } from "./next.config";

describe("dev server memory (#684)", () => {
  it("validates Cache Components on the dev server's own thread", () => {
    const config = nextConfigForPhase(PHASE_DEVELOPMENT_SERVER);

    expect(config.experimental?.devValidationWorker).toBe(false);
  });
});

describe("React Compiler per phase (#684)", () => {
  it("compiles with Turbopack's Rust port under next dev", () => {
    const config = nextConfigForPhase(PHASE_DEVELOPMENT_SERVER);

    expect(config.reactCompiler).toBe(true);
    expect(config.experimental?.turbopackRustReactCompiler).toBe(true);
  });

  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])(
    "keeps the Babel React Compiler for %s",
    (phase) => {
      const config = nextConfigForPhase(phase);

      expect(config.reactCompiler).toBe(true);
      expect(config.experimental?.turbopackRustReactCompiler).toBe(false);
    },
  );
});
