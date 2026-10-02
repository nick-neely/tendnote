import { describe, expect, it } from "vitest";
import { baseInstructions } from "./instructions-source";

const base = baseInstructions();
describe("chat attachment instructions", () => {
  it("separates reading from saving and keeps inferred facts in review", () => {
    expect(base).toContain("use `read_attachment`");
    expect(base).toContain("Uploading alone");
    expect(base).toContain("normal review flow");
    expect(base).toContain("untrusted evidence");
  });
});
