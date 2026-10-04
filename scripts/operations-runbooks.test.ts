import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATOR_USAGE } from "../apps/web/src/lib/billing/operator-actions";

const root = resolve(import.meta.dirname, "..");
const operationsDir = resolve(root, "docs/operations");

/** The one runbook template (docs/operations/README.md), in order. */
const TEMPLATE = [
  "Trigger",
  "Preconditions",
  "Steps",
  "Record produced",
  "Verification",
  "Rollback",
];

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

const index = resolve(operationsDir, "README.md");
const runbooks = markdownFiles(operationsDir)
  .filter((path) => path !== index)
  .map((path) => ({
    name: relative(operationsDir, path),
    text: readFileSync(path, "utf8"),
  }));

/** The operator CLI's commands, read from its own usage text. */
const operatorCommands = [...OPERATOR_USAGE.matchAll(/^\s+operator ([a-z-]+)/gm)].map(
  ([, command]) => command,
);

describe("operations runbooks", () => {
  it.each(runbooks)("$name fills the template", ({ text }) => {
    const sections = [...text.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading);
    expect(sections).toEqual(TEMPLATE);
  });

  it("are all listed in the index", () => {
    const readme = readFileSync(index, "utf8");
    for (const { name } of runbooks) expect(readme).toContain(`(${name})`);
  });

  it("give every Operator Action command a runbook, and name no other", () => {
    expect(operatorCommands.length).toBeGreaterThan(0);
    const documented = new Set(
      runbooks
        .filter(({ name }) => name.startsWith("operator-actions/"))
        .flatMap(({ text }) =>
          [...text.matchAll(/pnpm --filter @tendnote\/web operator ([a-z-]+)/g)].map(
            ([, command]) => command,
          ),
        ),
    );
    expect([...documented].sort()).toEqual([...operatorCommands].sort());

    const named = runbooks.flatMap(({ text }) =>
      [...text.matchAll(/`operator ([a-z-]+)/g)].map(([, command]) => command),
    );
    for (const command of named) expect(operatorCommands).toContain(command);
  });

  it("hold no secret or contact", () => {
    const secretShapes = [
      /\b[sr]k_(live|test)_[A-Za-z0-9]{8,}/,
      /\bwhsec_[A-Za-z0-9]{8,}/,
      /\bre_[A-Za-z0-9]{16,}/,
      /\bnapi_[A-Za-z0-9]{8,}/,
      /\bvercel_blob_rw_[A-Za-z0-9]{8,}/,
      /\bpostgres(ql)?:\/\/[^:\s/]+:[^@\s<]+@/,
      /\brediss?:\/\/[^:\s/]*:[^@\s<]+@/,
      /https:\/\/[0-9a-f]{16,}@/,
    ];
    const allowedEmailDomains = /@(example\.(test|com|org)|.*\.example)$/;

    for (const { name, text } of [
      ...runbooks,
      { name: "README.md", text: readFileSync(index, "utf8") },
    ]) {
      for (const shape of secretShapes) {
        expect(text, `${name} matches ${shape}`).not.toMatch(shape);
      }
      for (const [email] of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) {
        expect(email, `${name} names a contact`).toMatch(allowedEmailDomains);
      }
    }
  });
});
