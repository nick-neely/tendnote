#!/usr/bin/env node
/**
 * Refresh the loc-inventory Cursor canvas sidecar.
 *
 * Usage (from repo root):
 *   node scripts/loc-inventory.mjs
 *
 * Writes inventory into:
 *   ~/.cursor/projects/<workspace-slug>/canvases/loc-inventory.canvas.data.json
 *
 * The canvas reads that file via useCanvasState("inventory", …).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss"]);
const TOOLING_PREFIXES = [
  ".agents/",
  ".claude/",
  ".cursor/",
  ".github/",
  ".vscode/",
  ".fallow/",
  ".husky/",
  ".impeccable/",
  ".codex/",
];
const AREA_ORDER = [
  "packages/db",
  "apps/web",
  "apps/agent",
  "packages/domain",
  "scripts",
  "packages/auth",
  "packages/rate-limit",
];

function gitLsFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function extname(path) {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i).toLowerCase();
}

function basename(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function isTest(path) {
  const base = basename(path);
  const parts = new Set(path.split("/"));
  if (["test", "tests", "e2e", "__tests__", "__mocks__", "fixtures"].some((p) => parts.has(p))) {
    return true;
  }
  if (base.includes(".test.") || base.includes(".spec.") || base.endsWith(".snap")) {
    return true;
  }
  return [
    "vitest.config.ts",
    "vitest.config.mts",
    "vitest.config.js",
    "playwright.config.ts",
    "jest.config.ts",
    "jest.config.js",
  ].includes(base);
}

function hardExcludeReason(path) {
  if (TOOLING_PREFIXES.some((p) => path.startsWith(p))) return "tooling";
  if (`/${path}`.includes("/components/ui/")) return "shadcn-ui";
  if (`/${path}`.includes("/components/ai-elements/")) return "ai-elements";
  if (`/${path}`.includes("/migrations/") || path.endsWith(".sql")) return "migrations";
  if (path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".mdx")) return "docs";
  if (
    ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"].includes(
      basename(path),
    )
  ) {
    return "lockfile";
  }
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)$/i.test(path)) {
    return "assets";
  }
  if (`/${path}`.includes("/generated/") || /\.(gen|generated)\.ts$/i.test(basename(path))) {
    return "generated";
  }
  return null;
}

function countLinesSync(absPath) {
  const data = readFileSync(absPath);
  const head = data.subarray(0, Math.min(4096, data.length));
  if (head.includes(0)) return null;
  if (data.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 10) n++;
  }
  if (data[data.length - 1] !== 10) n++;
  return n;
}

function areaOf(path) {
  const parts = path.split("/");
  if (parts[0] === "apps" && parts.length > 1) return `apps/${parts[1]}`;
  if (parts[0] === "packages" && parts.length > 1) return `packages/${parts[1]}`;
  return parts[0];
}

function pct(n, total) {
  if (!total) return "0%";
  const v = (100 * n) / total;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

function formatInt(n) {
  return n.toLocaleString("en-US");
}

function summarize(files, { includeTests }) {
  /** @type {{ lines: number, path: string, isTest: boolean }[]} */
  const rows = [];
  /** @type {Record<string, { loc: number, files: number, testLoc: number }>} */
  const byArea = Object.create(null);
  /** @type {Record<string, number>} */
  const byExt = Object.create(null);

  for (const rel of files) {
    if (hardExcludeReason(rel)) continue;
    const ext = extname(rel);
    if (!SOURCE_EXTS.has(ext)) continue;
    const test = isTest(rel);
    if (test && !includeTests) continue;
    const n = countLinesSync(join(repoRoot, rel));
    if (n == null) continue;
    rows.push({ lines: n, path: rel, isTest: test });
    const area = areaOf(rel);
    if (!byArea[area]) byArea[area] = { loc: 0, files: 0, testLoc: 0 };
    byArea[area].loc += n;
    byArea[area].files += 1;
    if (test) byArea[area].testLoc += n;
    byExt[ext] = (byExt[ext] ?? 0) + n;
  }

  rows.sort((a, b) => b.lines - a.lines);
  const totalLoc = rows.reduce((s, r) => s + r.lines, 0);
  const fileCount = rows.length;
  const testLoc = rows.filter((r) => r.isTest).reduce((s, r) => s + r.lines, 0);
  const top10 = rows.slice(0, 10).map((r, i) => ({
    rank: String(i + 1),
    path: r.path,
    lines: formatInt(r.lines),
    linesRaw: r.lines,
    pct: pct(r.lines, totalLoc),
    isTest: r.isTest,
  }));

  const byExtRows = Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  return {
    totalLoc,
    fileCount,
    testLoc,
    avg: fileCount ? Math.round(totalLoc / fileCount) : 0,
    byArea,
    byExt: byExtRows,
    top10,
    top10Sum: top10.reduce((s, r) => s + r.linesRaw, 0),
  };
}

function countExcluded(files) {
  /** @type {Record<string, { files: number, loc: number }>} */
  const out = Object.create(null);
  for (const rel of files) {
    const reason = hardExcludeReason(rel);
    const ext = extname(rel);
    const isSourceish = SOURCE_EXTS.has(ext) || rel.endsWith(".sql");
    if (reason) {
      if (!out[reason]) out[reason] = { files: 0, loc: 0 };
      out[reason].files += 1;
      if (isSourceish) {
        const n = countLinesSync(join(repoRoot, rel));
        if (n) out[reason].loc += n;
      }
      continue;
    }
    if (isTest(rel)) {
      if (!out.tests) out.tests = { files: 0, loc: 0 };
      out.tests.files += 1;
      if (SOURCE_EXTS.has(ext)) {
        const n = countLinesSync(join(repoRoot, rel));
        if (n) out.tests.loc += n;
      }
      continue;
    }
    if (!SOURCE_EXTS.has(ext)) {
      if (!out["non-source"]) out["non-source"] = { files: 0, loc: 0 };
      out["non-source"].files += 1;
    }
  }
  return out;
}

function approxLoc(n) {
  if (!n) return "—";
  if (n >= 1000) {
    const k = n / 1000;
    const text = k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "");
    return `~${text}k`;
  }
  return formatInt(n);
}

function buildExcludedRows(excluded, { includeTestsInCount }) {
  const rows = [
    ["Agent tooling (.agents / .claude / …)", excluded.tooling],
    ...(includeTestsInCount ? [] : [["Tests / e2e / fixtures", excluded.tests]]),
    ["shadcn ui (components/ui)", excluded["shadcn-ui"]],
    ["AI Elements", excluded["ai-elements"]],
    ["Migrations / SQL", excluded.migrations],
  ];
  const otherFiles =
    (excluded.docs?.files ?? 0) +
    (excluded.assets?.files ?? 0) +
    (excluded.lockfile?.files ?? 0) +
    (excluded["non-source"]?.files ?? 0) +
    (excluded.generated?.files ?? 0);
  rows.push(["Docs / assets / lockfile / other", { files: otherFiles, loc: 0 }]);
  return rows
    .filter(([, stats]) => stats)
    .map(([category, stats]) => [category, formatInt(stats.files), approxLoc(stats.loc)]);
}

function canvasDataPath() {
  if (process.env.LOC_INVENTORY_CANVAS_DATA) {
    return resolve(process.env.LOC_INVENTORY_CANVAS_DATA);
  }
  const slug = repoRoot.replace(/^\//, "").replaceAll("/", "-");
  return join(homedir(), ".cursor", "projects", slug, "canvases", "loc-inventory.canvas.data.json");
}

function areaNote(production, withTests, mode) {
  if (mode === "production") {
    const db = production.byArea["packages/db"]?.loc ?? 0;
    const web = production.byArea["apps/web"]?.loc ?? 0;
    const dbPct = Math.round((100 * db) / production.totalLoc);
    const webPct = Math.round((100 * web) / production.totalLoc);
    return `packages/db is ${dbPct}% of production LOC; apps/web is ${webPct}%.`;
  }
  const testShare = Math.round((100 * withTests.testLoc) / withTests.totalLoc);
  return `Tests are ${testShare}% of this view. Area chart stacks production vs tests.`;
}

function extNote(byExt, mode) {
  if (mode === "production") {
    const total = byExt.reduce((s, r) => s + r.value, 0);
    const ts = byExt.find((r) => r.label === ".ts")?.value ?? 0;
    const tsx = byExt.find((r) => r.label === ".tsx")?.value ?? 0;
    return `TypeScript (.ts) dominates at ${Math.round((100 * ts) / total)}%; React (.tsx) is ${Math.round((100 * tsx) / total)}%.`;
  }
  return "Includes test files; .ts grows the most when tests are added.";
}

function topNote(summary, mode) {
  const testInTop = summary.top10.filter((r) => r.isTest).length;
  if (mode === "production") {
    return `Top 10 sum to ${formatInt(summary.top10Sum)} lines (${pct(summary.top10Sum, summary.totalLoc)} of total).`;
  }
  return `Top 10 sum to ${formatInt(summary.top10Sum)} lines (${pct(summary.top10Sum, summary.totalLoc)} of total). ${testInTop} of the ten largest files are tests.`;
}

const files = gitLsFiles();
const production = summarize(files, { includeTests: false });
const withTests = summarize(files, { includeTests: true });
const excluded = countExcluded(files);

const areaStacked = AREA_ORDER.map((label) => {
  const prod = production.byArea[label]?.loc ?? 0;
  const total = withTests.byArea[label]?.loc ?? 0;
  return { label, prod, test: Math.max(0, total - prod) };
}).filter((a) => a.prod > 0 || a.test > 0);

const inventory = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  production: {
    title: "Tendnote production LOC",
    blurb:
      "Physical lines via git ls-files · excludes gitignored, tests, migrations/SQL, shadcn, AI Elements, and agent tooling · source: .ts/.tsx/.js/.mjs/.css",
    totalLoc: production.totalLoc,
    totalLabel: "Production LOC",
    fileCount: production.fileCount,
    avg: production.avg,
    byExt: production.byExt,
    extNote: extNote(production.byExt, "production"),
    areaNote: areaNote(production, withTests, "production"),
    top10: production.top10.map(({ rank, path, lines, pct: p, isTest }) => ({
      rank,
      path,
      lines,
      pct: p,
      isTest,
    })),
    topNote: topNote(production, "production"),
    excluded: buildExcludedRows(excluded, { includeTestsInCount: false }),
    excludedNote:
      "Tooling and tests together can exceed production source; they are omitted so this reflects hand-written product code only.",
  },
  withTests: {
    title: "Tendnote LOC (with tests)",
    blurb:
      "Same filters as production, plus tests / e2e / fixtures · still excludes gitignored, migrations/SQL, shadcn, AI Elements, and agent tooling",
    totalLoc: withTests.totalLoc,
    totalLabel: "LOC with tests",
    fileCount: withTests.fileCount,
    avg: withTests.avg,
    testLoc: withTests.testLoc,
    testSharePct: Math.round((100 * withTests.testLoc) / withTests.totalLoc),
    byExt: withTests.byExt,
    extNote: extNote(withTests.byExt, "with-tests"),
    areaNote: areaNote(production, withTests, "with-tests"),
    top10: withTests.top10.map(({ rank, path, lines, pct: p, isTest }) => ({
      rank,
      path,
      lines,
      pct: p,
      isTest,
    })),
    topNote: topNote(withTests, "with-tests"),
    excluded: buildExcludedRows(excluded, { includeTestsInCount: true }),
    excludedNote: "Tests are included in this view. Other generated/vendor/tooling paths stay out.",
  },
  areaStacked,
};

const dataPath = canvasDataPath();
let existing = {};
if (existsSync(dataPath)) {
  try {
    existing = JSON.parse(readFileSync(dataPath, "utf8"));
  } catch {
    existing = {};
  }
}

const next = { ...existing, inventory };
await writeFile(dataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

console.log(`Wrote inventory → ${dataPath}`);
console.log(
  `Production: ${formatInt(production.totalLoc)} LOC / ${formatInt(production.fileCount)} files`,
);
console.log(
  `With tests: ${formatInt(withTests.totalLoc)} LOC / ${formatInt(withTests.fileCount)} files (tests ${formatInt(withTests.testLoc)})`,
);
console.log(`Generated at ${inventory.generatedAt}`);
