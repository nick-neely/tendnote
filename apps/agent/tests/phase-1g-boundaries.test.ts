import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectAllowedAgentChannels, expectChannelToExclude } from "./agent-channel-boundaries";

const agentRoot = join(import.meta.dirname, "../agent");
const repoRoot = join(import.meta.dirname, "../../..");

/**
 * Phase 1G boundary evals (PRD #75, issue #82). They confirm that Tendnote-only
 * message drafting did not cross into external sends, external/Gmail draft
 * creation, provider integrations, or new delivery channels — across the shared
 * generator, web surfaces, and the Eve tool — and that the governing docs/ADRs
 * stay aligned with the implemented boundary. Per-slice policy (trust tiers,
 * restricted exclusion, owner scoping, raw-id hiding, refusal) is unit-tested in
 * the db generator/lifecycle tests, the web component/action tests, and the Eve
 * tool eval; this file guards the repository-wide invariants those cannot.
 */

// The db drafting module is globbed (not hardcoded) so a future-added file — the
// most likely place an external-delivery module would land — cannot slip past the
// scan. The cross-package drafting files are listed explicitly.
const dbDraftsDir = join(repoRoot, "packages/db/src/queries/drafts");
const dbDraftFiles = readdirSync(dbDraftsDir)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => `packages/db/src/queries/drafts/${file}`);

const PHASE_1G_FILES = [
  "packages/db/src/queries/drafts.ts",
  ...dbDraftFiles,
  "packages/domain/src/drafts.ts",
  "packages/domain/src/draft-generation.ts",
  "apps/web/src/lib/draft-view.ts",
  "apps/web/src/app/actions/drafts.ts",
  "apps/web/src/app/actions/create-draft.ts",
  "apps/web/src/components/draft-message-button.tsx",
  "apps/web/src/components/use-create-draft.ts",
  // The Eve draft-result render path — the surfaces that show a draft to the user.
  // The draft result module owns the Message Draft / Draft Proposal projection and
  // rendering; the registry dispatches to it and the presentational host renders it.
  "apps/web/src/lib/eve/tool-result-view.ts",
  "apps/web/src/components/assistant-results/follow-up-draft.tsx",
  "apps/web/src/components/assistant-results/registry.tsx",
  "apps/web/src/components/assistant-tool-result.tsx",
  "apps/agent/agent/tools/create_message_draft.ts",
  // The root read-back of the same records. It sends nothing by construction, and this
  // scan is what keeps it that way as the drafting surface grows.
  "apps/agent/agent/tools/list_message_drafts.ts",
];

// Phase 2D adds APPROVED Gmail draft externalization (ADR-0083/0096) to the person
// draft surfaces. These may reference the shared Gmail draft-write modules — which
// route every write through the approval gate — but must still make no raw
// provider/send call and import no send/other-provider module (Gmail *draft* write
// is allowed; sending and other delivery providers are not).
const PHASE_2D_GMAIL_SURFACES = [
  "apps/web/src/components/person-drafts.tsx",
  "apps/web/src/app/(admitted)/people/[personId]/page.tsx",
];

// External delivery / provider modules that must never be imported by Phase 1G
// drafting surfaces. Gmail draft-write stays out of these surfaces entirely — it is
// confined to the Phase 2D Gmail surfaces below.
const FORBIDDEN_IMPORT =
  /gmail|googleapis|nodemailer|twilio|sendgrid|@sendgrid|resend|telegram|discord|slack/i;

// External SEND / other-provider modules that must never be imported by ANY draft
// surface, including the Phase 2D Gmail surfaces (Gmail draft-write is allowed;
// sending and other delivery providers are not).
const FORBIDDEN_SEND_IMPORT =
  /googleapis|nodemailer|twilio|sendgrid|@sendgrid|resend|telegram|discord|slack|gmail\.send/i;

// Provider/network CALL sites the import scan can't see (raw fetch to a provider,
// SMTP, dynamic import, etc.). These tokens never appear in the tools' own
// boundary-affirming prose ("never creates a Gmail draft"), so they catch a real
// delivery implementation without false-positiving on the guardrail wording.
const FORBIDDEN_CALL =
  /nodemailer|createtransport|\bsmtp\b|sendmail|googleapis\.com|api\.sendgrid|api\.twilio|hooks\.slack\.com|api\.resend|mcp__/i;

/**
 * The transactional email provider Tendnote sends its *own* mail with — one
 * Household Invitation, to an address an Owner typed, as an explicit Owner
 * action. It is confined to `apps/web/src/lib/email` and forbidden everywhere
 * the user's drafted messages are handled; see the two assertions at the end of
 * the boundary block.
 */
const TRANSACTIONAL_EMAIL_PACKAGE = "resend";

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("Phase 1G boundary — no external delivery in drafting surfaces", () => {
  it("imports no external send/draft/provider module in any Phase 1G surface", () => {
    for (const relativePath of PHASE_1G_FILES) {
      const fullPath = join(repoRoot, relativePath);
      expect(existsSync(fullPath), `${relativePath} should exist`).toBe(true);
      for (const moduleId of importSpecifiers(readFileSync(fullPath, "utf8"))) {
        expect(moduleId, `${relativePath} imports ${moduleId}`).not.toMatch(FORBIDDEN_IMPORT);
      }
    }
  });

  it("confines the Phase 2D Gmail surfaces to draft-write — no send/other-provider import", () => {
    for (const relativePath of PHASE_2D_GMAIL_SURFACES) {
      const fullPath = join(repoRoot, relativePath);
      expect(existsSync(fullPath), `${relativePath} should exist`).toBe(true);
      for (const moduleId of importSpecifiers(readFileSync(fullPath, "utf8"))) {
        expect(moduleId, `${relativePath} imports ${moduleId}`).not.toMatch(FORBIDDEN_SEND_IMPORT);
      }
    }
  });

  it("makes no raw provider/network call (fetch/SMTP/dynamic import) in any surface", () => {
    // The no-send / no-raw-provider-call invariant holds for every draft surface,
    // including the Phase 2D Gmail surfaces (which write drafts only via the shared
    // service, never a raw provider call here).
    for (const relativePath of [...PHASE_1G_FILES, ...PHASE_2D_GMAIL_SURFACES]) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source, `${relativePath} contains a provider call site`).not.toMatch(FORBIDDEN_CALL);
    }
  });

  it("keeps drafting externalization out of delivery channels", () => {
    expectAllowedAgentChannels(agentRoot);
    expectChannelToExclude(
      agentRoot,
      "discord.ts",
      /save_draft_to_gmail|gmail\.send|sendgrid|resend|nodemailer/i,
    );
  });

  it("adds no provider/send dependency to any drafting package", () => {
    for (const pkg of ["packages/db", "packages/domain", "apps/web", "apps/agent"]) {
      const manifest = JSON.parse(readFileSync(join(repoRoot, pkg, "package.json"), "utf8"));
      const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
      for (const dep of deps) {
        const sanctioned = pkg === "apps/web" && dep === TRANSACTIONAL_EMAIL_PACKAGE;
        expect(dep, `${pkg} depends on ${dep}`).not.toMatch(
          sanctioned
            ? /nodemailer|twilio|sendgrid|@sendgrid|googleapis|gmail/i
            : /nodemailer|twilio|sendgrid|@sendgrid|resend|googleapis|gmail/i,
        );
      }
    }
  });

  /**
   * The one sanctioned exception, pinned to the shape that makes it safe.
   *
   * `apps/web` carries a transactional email provider so Tendnote can send a
   * Household Invitation on its own behalf, to an address an Owner typed, as an
   * explicit Owner action. That is a different act from the one this file
   * guards: delivering a message the *user* drafted to somebody they know. The
   * package-level ban above was a usable proxy for that rule only while Tendnote
   * had no mailbox at all, so the rule is now stated directly instead.
   *
   * Every drafting surface is already checked import by import above. This adds
   * the other half: the provider has exactly one home, and a second one cannot
   * appear unnoticed.
   */
  it("confines the transactional email provider to its own module", () => {
    const webSrc = join(repoRoot, "apps/web/src");
    const importers = readdirSync(webSrc, { recursive: true, encoding: "utf8" })
      .filter((entry) => /\.tsx?$/.test(entry))
      .filter((entry) =>
        importSpecifiers(readFileSync(join(webSrc, entry), "utf8")).includes(
          TRANSACTIONAL_EMAIL_PACKAGE,
        ),
      )
      .map((entry) => entry.replaceAll("\\", "/"));

    expect(importers.length).toBeGreaterThan(0);
    for (const importer of importers) {
      expect(importer, `${importer} imports ${TRANSACTIONAL_EMAIL_PACKAGE}`).toMatch(
        /^lib\/email\//,
      );
    }
  });
});

describe("Phase 1G boundary — docs and ADRs aligned", () => {
  it("keeps the governing drafting ADR present", () => {
    expect(existsSync(join(repoRoot, "docs", "adr", "0040-drafting-after-review-loop.md"))).toBe(
      true,
    );
  });

  it("ADR-0040 records the persisted source-reference grounding boundary", () => {
    const adr = readFileSync(
      join(repoRoot, "docs", "adr", "0040-drafting-after-review-loop.md"),
      "utf8",
    );
    expect(adr).toMatch(/source reference/i);
    expect(adr).toMatch(/persist/i);
  });
});
