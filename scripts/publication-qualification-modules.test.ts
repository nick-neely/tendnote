import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { junitCounts } from "./publication-qualification/junit.mjs";
import {
  containedBy,
  parseJson,
  readJsonl,
  secureBundleFiles,
  secureChildPath,
  secureRead,
  sha256,
} from "./publication-qualification/secure-fs.mjs";

/**
 * The qualification contract is fail-closed, so its two lowest seams have to
 * fail closed on their own. A JUnit reader that trusts the file's own attribute
 * counts, or a reader that follows a symlink out of the bundle, would let a
 * non-clean run present itself as evidence without any gate noticing.
 */

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "tendnote-qual-modules-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const suite = (attributes: string, body: string) => `<testsuite ${attributes}>${body}</testsuite>`;
const CLEAN_BODY = '<testcase name="one"/><testcase name="two"/>';
const CLEAN_ATTRIBUTES = 'tests="2" failures="0" skipped="0"';

describe("strict JUnit reader", () => {
  it("recomputes counts and IDs from the testcase elements", () => {
    const counts = junitCounts(suite(CLEAN_ATTRIBUTES, CLEAN_BODY));
    expect(counts).toMatchObject({
      tests: 2,
      failures: 0,
      skipped: 0,
      errors: 0,
      ids: ["one", "two"],
    });
    expect(counts?.structuralErrors).toEqual([]);
  });

  it("refuses a report whose declared totals disagree with its elements", () => {
    const counts = junitCounts(suite('tests="5" failures="0" skipped="0"', CLEAN_BODY));
    expect(counts?.structuralErrors).toContain(
      "JUnit aggregate counts disagree with testcase elements.",
    );
  });

  it("counts an inline failure, error, or skip against the declared totals", () => {
    const body = '<testcase name="one"><failure/></testcase><testcase name="two"/>';
    expect(junitCounts(suite(CLEAN_ATTRIBUTES, body))?.structuralErrors).toContain(
      "JUnit aggregate counts disagree with testcase elements.",
    );
    expect(
      junitCounts(suite('tests="2" failures="1" skipped="0"', body))?.structuralErrors,
    ).toEqual([]);
  });

  it("treats retry recovery evidence as structural, not as a pass", () => {
    const body = '<testcase name="one"><flakyFailure/></testcase><testcase name="two"/>';
    expect(junitCounts(suite(CLEAN_ATTRIBUTES, body))?.structuralErrors).toContain(
      "JUnit contains flakyFailure recovery evidence.",
    );
  });

  it("rejects duplicate, unnamed, multi-outcome, and out-of-root content", () => {
    const duplicate = '<testcase name="one"/><testcase name="one"/>';
    expect(junitCounts(suite(CLEAN_ATTRIBUTES, duplicate))?.structuralErrors).toContain(
      "JUnit duplicates testcase one.",
    );
    expect(
      junitCounts(suite(CLEAN_ATTRIBUTES, '<testcase/><testcase name="two"/>'))?.structuralErrors,
    ).toContain("JUnit testcase is missing name.");
    const twoOutcomes =
      '<testcase name="one"><failure/><skipped/></testcase><testcase name="two"/>';
    expect(junitCounts(suite(CLEAN_ATTRIBUTES, twoOutcomes))?.structuralErrors).toContain(
      "JUnit testcase one has multiple outcomes.",
    );
    expect(
      junitCounts(`${suite(CLEAN_ATTRIBUTES, CLEAN_BODY)}<extra/>`)?.structuralErrors,
    ).toContain("JUnit has content outside its testsuite root.");
    expect(
      junitCounts(`${suite(CLEAN_ATTRIBUTES, CLEAN_BODY)}${suite(CLEAN_ATTRIBUTES, CLEAN_BODY)}`)
        ?.structuralErrors,
    ).toContain("JUnit must contain exactly one testsuite element.");
  });

  it("refuses a missing or non-numeric aggregate attribute", () => {
    expect(junitCounts(suite('failures="0" skipped="0"', CLEAN_BODY))?.structuralErrors).toContain(
      "JUnit testsuite is missing tests.",
    );
    expect(
      junitCounts(suite('tests="two" failures="0" skipped="0"', CLEAN_BODY))?.structuralErrors,
    ).toContain("JUnit tests must be a non-negative integer.");
  });

  it("returns null only for a non-string input", () => {
    expect(junitCounts(undefined)).toBeNull();
    expect(junitCounts(42)).toBeNull();
  });
});

describe("symlink-refusing evidence reads", () => {
  it("reads and digests a regular file inside the bundle", () => {
    const root = scratch();
    writeFileSync(join(root, "a.txt"), "hello");
    expect(secureRead(join(root, "a.txt")).toString("utf8")).toBe("hello");
    expect(sha256(Buffer.from("hello"))).toBe(createHash("sha256").update("hello").digest("hex"));
  });

  it("refuses a symlinked file even when it resolves inside the bundle", () => {
    const root = scratch();
    writeFileSync(join(root, "real.txt"), "hello");
    symlinkSync(join(root, "real.txt"), join(root, "link.txt"));
    expect(() => secureRead(join(root, "link.txt"))).toThrow(/Symlink paths are not accepted/);
    expect(() => secureChildPath(root, "link.txt")).toThrow(/Symlink paths are not accepted/);
    expect(() => secureBundleFiles(root)).toThrow(/Symlink paths are not accepted/);
  });

  it("refuses a child path that escapes or names its own directory", () => {
    const root = scratch();
    mkdirSync(join(root, "bundle"));
    writeFileSync(join(root, "outside.txt"), "x");
    expect(() => secureChildPath(join(root, "bundle"), "../outside.txt")).toThrow(/escapes/);
    expect(() => secureChildPath(join(root, "bundle"), "")).toThrow(/escapes/);
  });

  it("enumerates nested bundle files with forward-slash relative paths", () => {
    const root = scratch();
    mkdirSync(join(root, "raw"));
    writeFileSync(join(root, "metadata.json"), "{}");
    writeFileSync(join(root, "raw", "initial-summary.json"), "{}");
    expect(secureBundleFiles(root).sort()).toEqual(["metadata.json", "raw/initial-summary.json"]);
  });

  it("contains only a directory itself or its descendants", () => {
    expect(containedBy("/a/b", "/a/b")).toBe(true);
    expect(containedBy("/a/b/c", "/a/b")).toBe(true);
    expect(containedBy("/a/bc", "/a/b")).toBe(false);
    expect(containedBy("/a", "/a/b")).toBe(false);
  });

  it("reports unparseable JSON and JSONL as blockers instead of throwing", () => {
    const root = scratch();
    writeFileSync(join(root, "bad.json"), "{oops");
    writeFileSync(join(root, "bad.jsonl"), "{oops\n");
    writeFileSync(join(root, "good.jsonl"), '{"id":"one"}\n\n{"id":"two"}\n');
    const jsonBlockers: string[] = [];
    expect(parseJson(join(root, "bad.json"), jsonBlockers)).toBeNull();
    expect(jsonBlockers).toHaveLength(1);
    const jsonlBlockers: string[] = [];
    expect(readJsonl(join(root, "bad.jsonl"), jsonlBlockers)).toEqual([]);
    expect(jsonlBlockers).toHaveLength(1);
    expect(readJsonl(join(root, "good.jsonl"), [])).toEqual([{ id: "one" }, { id: "two" }]);
  });
});
