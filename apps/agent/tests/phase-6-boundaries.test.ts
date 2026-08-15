import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { authoredInstructions } from "./instructions-source";

/**
 * The Phase 6 Asset Memory boundary, as Eve can reach it (#196, #205).
 *
 * The Eve asset evals prove what Eve *says*. This file proves what Eve *has*: the shape
 * of the asset surface she is given at all. Behavior evals need a live model and can only
 * sample the space of things a user might ask; a surface scan is total, deterministic, and
 * fails the moment someone hands the assistant a capability Phase 6 deliberately withheld.
 *
 * Two absences carry most of the weight:
 *
 * - **No durable asset write Eve was not told to make.** Everything Eve works out for
 *   herself - a fact, an asset she inferred, a reminder - she can only *propose*: the two
 *   proposal tools reach the seam's `suggested`-only entry points, so a proposal becoming
 *   durable requires the user's own accept. The one thing that is not review-gated is the
 *   thing ADR 0169 never gated: an Asset created or renamed on the user's explicit
 *   instruction in the current turn. That is the ADR's own line - "directly only from
 *   explicit user intent", with everything *inferred* into review - and it is drawn below
 *   as a two-file allowance rather than a promise, so the review gate stays the only door
 *   for every other tool and every other write. Nothing anywhere archives, deletes, or
 *   accepts an Asset, an Asset Memory, Asset Evidence, or a link.
 * - **No file contents.** Nothing in the agent reads uploaded bytes. Chat uploads route to
 *   the shared Asset Evidence capture flow in the web app; the agent never sees the file, so
 *   OCR, receipt parsing, arbitrary file Q&A, and a document inbox are not features that were
 *   turned off — they are absent by construction, which is why Eve must never offer them.
 */

const agentRoot = join(import.meta.dirname, "..");

/**
 * Removes comments so an absence scan matches real code, never prose — a doc comment that
 * explains why OCR is out of scope must not read as OCR. Stripping only ever *reduces*
 * matches, so it can never manufacture a false pass.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every authored agent source file (tools, libs, channels, subagents) — code only. */
function agentSources(): Array<{ path: string; code: string }> {
  const files: Array<{ path: string; code: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files.push({ path: full, code: stripComments(readFileSync(full, "utf8")) });
      }
    }
  };
  walk(join(agentRoot, "agent"));
  return files;
}

/**
 * EVERY tool the agent ships, root and subagent alike — `agent/tools/` plus the tool sets the
 * subagents carry under `agent/subagents/<name>/tools/`.
 *
 * The recursion is the assertion. A scan that read only the root directory would let a durable
 * asset write — or a fifth asset tool — land inside a subagent and pass every check in this
 * file, which is precisely the shape a capability creeps in through: nobody adds
 * `create_asset.ts` next to `search_assets.ts` where it would be noticed, and the model reaches
 * a subagent's tools just as readily as the root's.
 */
function toolFiles(): Array<{ name: string; code: string }> {
  return agentSources()
    .filter((file) => file.path.includes(`${sep}tools${sep}`))
    .map((file) => ({
      name: (file.path.split(sep).pop() as string).replace(/\.ts$/, ""),
      code: file.code,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toolNames(): string[] {
  return toolFiles().map((tool) => tool.name);
}

/** One tool's source, comments stripped, wherever in the agent tree it lives. */
function toolSource(name: string): string {
  const tool = toolFiles().find((file) => file.name === name);
  expect(tool, `tool ${name} should exist`).toBeDefined();
  return (tool as { code: string }).code;
}

const ASSET_TOOLS = [
  "create_asset",
  "edit_asset",
  "get_asset_context",
  "propose_asset_actions",
  "propose_asset_memories",
  "search_assets",
];

/**
 * The two writes ADR 0169 leaves ungated, and the only tool each may live in.
 *
 * The ADR gates *extraction*: asset-like information inferred from a receipt, a photo, a
 * warranty, a note, or a promoted hint goes to review as a Suggested Asset. It does not
 * gate a user saying "add my car" - it says the opposite, in as many words - and for two
 * phases the absence of a tool for that sentence was read as a boundary. It was a gap:
 * asked to add an asset, the model either proposed a review card nobody wanted or claimed
 * a record it could not create.
 *
 * So the allowance is keyed to the tool, not to the seam. `createAsset`/`editAsset` may
 * appear in the two tools whose whole content is the explicit-instruction template - a
 * current-turn ask, a deterministically resolved record, the shared layer's private
 * default, no scope argument (ADR 0179), and no path to a fact - and nowhere else. Every
 * other durable asset write stays absent from every tool, including these two.
 */
const EXPLICIT_INTENT_ASSET_WRITES: Record<string, string> = {
  createAsset: "create_asset",
  editAsset: "edit_asset",
};

describe("Phase 6 boundary - Eve's asset surface is read, review-gated proposals, and explicit-intent creation", () => {
  it("exposes exactly six asset tools, anywhere in the agent", () => {
    // List equality, over every tool the agent ships - root and subagent. A seventh asset
    // tool cannot appear without this line naming it.
    expect(toolNames().filter((name) => name.includes("asset"))).toEqual(ASSET_TOOLS);
  });

  it("gives Eve no way to write a durable Asset, Memory, Evidence, or link she was not told to", () => {
    // The owner-scoped write seam exports these. If one ever appears in a tool that is not
    // its named explicit-instruction home, the review gate stopped being structural and
    // became a promise the model is asked to keep.
    const durableWrites = [
      "createAsset",
      "editAsset",
      "archiveAsset",
      "restoreAsset",
      "createActiveAssetMemory",
      "acceptSuggestedAsset",
      "acceptSuggestedAssetMemory",
      "addAssetEvidence",
      "addAssetEvidenceToNewAsset",
      "removeAssetEvidence",
      "addAssetLink",
      "acceptSuggestedAssetLink",
      "addAssetPersonLink",
    ];

    for (const { name, code } of toolFiles()) {
      for (const write of durableWrites) {
        if (EXPLICIT_INTENT_ASSET_WRITES[write] === name) continue;
        expect(code, `${name} must not call the durable asset write ${write}`).not.toMatch(
          new RegExp(`\\b${write}\\s*\\(`),
        );
      }
    }
  });

  it("keeps each explicit-intent asset write to one tool that is only reachable on an explicit ask", () => {
    for (const [write, toolName] of Object.entries(EXPLICIT_INTENT_ASSET_WRITES)) {
      const code = toolSource(toolName);
      expect(code, `${toolName} should call ${write}`).toMatch(new RegExp(`\\b${write}\\s*\\(`));
      // No scope argument reaches the seam: an Asset's visibility is the ceiling for every
      // child record hung on it (ADR 0179), so widening one is the user's decision in the
      // app and the shared layer's private default is what a tool gets.
      expect(code, `${toolName} must not choose an Asset's audience`).not.toMatch(
        /\b(scope|householdId|selectedUserIds|ownership)\s*:/,
      );
      // The explicit-turn gate lives in the description, which is the model's map of when
      // the tool applies. Both halves have to be there: when to use it, and the inferred
      // case that belongs in review instead.
      const description = /description:\s*(`[\s\S]*?`|"[\s\S]*?")/.exec(code)?.[1] ?? "";
      expect(description, `${toolName} must gate on an explicit current-turn ask`).toMatch(
        /explicit/i,
      );
      expect(description, `${toolName} must route inferred asset facts to review`).toMatch(
        /propose_asset_memories/,
      );
    }
  });

  it("keeps the asset-derived action write on the proposal seam, which cannot make an active action", () => {
    const code = toolSource("propose_asset_actions");

    expect(code).toMatch(/proposeAssetMemoryActions\(/);
    expect(code).not.toMatch(/\bcreateGeneralAction\s*\(/);
    expect(code).not.toMatch(/acceptSuggestedGeneralAction\s*\(/);
  });

  it("routes a proposed asset fact through the suggested-only entry points and nothing else", () => {
    // This is what makes a *writing* asset tool safe to hand the model at all: the two
    // entry points it may call are the ones that can only ever produce `suggested` rows in
    // an Asset Review Group. Promotion is the user's accept — there is no code path from
    // this tool to a durable record, which is why "propose, do not save" survives a model
    // that would rather be helpful. (The durable-write scan above covers the rest.)
    const code = toolSource("propose_asset_memories");

    expect(code).toMatch(/\bsuggestAssetMemories\s*\(/);
    expect(code).toMatch(/\bsuggestAsset\s*\(/);
    // The suggestion is grounded in the user's own sentence (ADR 0151), never ungrounded.
    expect(code).toMatch(/captureSourceRecord\s*\(/);
    expect(code).toMatch(/sourceRecordId:\s*sourceRecord\.id/);
  });

  it("never lets the model widen its own read scope to review-gated records", () => {
    // Twice locked: the flag is not even in the model's input schema, and the store call
    // pins it false *after* spreading the input — so a hallucinated `includeReviewGated`
    // is dropped at the schema and could not survive the call even if it were not.
    const code = toolSource("search_assets");

    expect(code).toMatch(/searchAssetsSchema\.omit\(\{\s*includeReviewGated:\s*true\s*\}\)/);
    expect(code).toMatch(/\.\.\.input,\s*includeReviewGated:\s*false/);
    expect(code).not.toMatch(/includeReviewGated:\s*input\b/);
  });
});

describe("Phase 6 boundary — the agent never reads a file's contents", () => {
  it("reaches no evidence bytes and no image/document parsing anywhere in the agent", () => {
    // `getAssetEvidenceFile` is the gated bytes read the *web* file route uses. The agent
    // has no business calling it, and no OCR/vision/pdf parser may appear either.
    const forbidden = [
      /\bgetAssetEvidenceFile\s*\(/,
      /\btesseract\b/i,
      /\bocr\b/i,
      /pdf-parse|pdfjs|pdf2json/i,
      /\bsharp\b/,
    ];

    for (const { path, code } of agentSources()) {
      for (const pattern of forbidden) {
        expect(code, `${path} must not reach for file contents (${pattern})`).not.toMatch(pattern);
      }
    }
  });

  it("tells Eve, in the always-on instructions, that uploads are Asset Evidence she never reads", () => {
    const instructions = authoredInstructions(agentRoot);

    expect(instructions).toMatch(/plus-menu/i);
    expect(instructions).toMatch(/never receive or read file contents/i);
    expect(instructions).toMatch(/do not offer OCR, receipt parsing, arbitrary file Q&A/i);
    expect(instructions).toMatch(/never claim to have viewed or analyzed an upload/i);
  });
});

describe("Phase 6 boundary — assets are not a document library, a finance product, or a graph", () => {
  it("offers no provider import, finance/subscription management, or bulk document feature in any tool description", () => {
    // Tool descriptions ARE the model's map of what it can do. A capability named here is a
    // capability Eve will offer — so the out-of-scope vocabulary must not appear as an offer.
    const offered = [
      /import (your |my )?(gmail|amazon|bank|drive)/i,
      /spend (analytics|report|dashboard)/i,
      /\bbudget(ing|s)?\b/i,
      /cancel (your |the )?subscription/i,
      /document (inbox|library)/i,
      /upload (a |your )?file/i,
    ];

    for (const name of toolNames()) {
      const source = toolSource(name);
      const description = /description:\s*(`[\s\S]*?`|"[\s\S]*?")/.exec(source)?.[1] ?? "";
      for (const pattern of offered) {
        expect(description, `${name} must not offer ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("keeps the asset tool set free of any graph, hierarchy, or auto-approve capability", () => {
    for (const name of ASSET_TOOLS) {
      const code = toolSource(name);

      // No component tree, no inherited permissions, no rollup — Phase 6 links are flat and
      // review-gated (#196 deferred scope).
      expect(code).not.toMatch(/\b(parentAssetId|childAssets|assetTree|rollup|inherit)\b/i);
      // No trusted-agent auto mode: nothing here may skip review on the model's say-so.
      expect(code).not.toMatch(/\b(autoApprove|autoAccept|trustedAgent|skipReview)\b/i);
    }
  });
});
