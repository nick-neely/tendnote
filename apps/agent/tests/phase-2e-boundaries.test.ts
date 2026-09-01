import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const agentRoot = join(import.meta.dirname, "../agent");

function listFiles(root: string): string[] {
  return readdirSync(join(repoRoot, root)).flatMap((entry) => {
    const path = join(repoRoot, root, entry);
    const rel = relative(repoRoot, path);
    if (entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return listFiles(rel);
    return [rel];
  });
}

function contactImportSurfaceFiles(): string[] {
  const roots = ["packages/db/src/queries", "apps/web/src"];
  return roots
    .flatMap(listFiles)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => /contact(s)?-import|contactimport|account\/contacts\/import/i.test(file))
    .sort();
}

function read(relativePath: string): string {
  const full = join(repoRoot, relativePath);
  expect(existsSync(full), `${relativePath} should exist`).toBe(true);
  return readFileSync(full, "utf8");
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/export\s+[^;]*\s+from\s+["']([^"']+)["']/g),
    ...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1] ?? "");
}

const CONTACT_IMPORT_SURFACES = contactImportSurfaceFiles();
const contactImportSources = CONTACT_IMPORT_SURFACES.map(read).join("\n").toLowerCase();

describe("Phase 2E Contacts import boundary - no external write or inference side effects", () => {
  it("scans every current Contacts import source surface", () => {
    expect(CONTACT_IMPORT_SURFACES).toEqual([
      "apps/web/src/app/(admitted)/account/contacts/import/contact-import-preview-client.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/contact-import-preview-fixture.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/contact-import-review.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/page.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/refresh-preview-button.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/resolution-zone.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/review-columns.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/review-controls.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/review-model.ts",
      "apps/web/src/app/(admitted)/account/contacts/import/review-table-features.ts",
      "apps/web/src/app/(admitted)/account/contacts/import/review-table.tsx",
      "apps/web/src/app/(admitted)/account/contacts/import/review-toasts.ts",
      "apps/web/src/app/(admitted)/account/contacts/import/use-confirm-runner.ts",
      "apps/web/src/app/(admitted)/account/contacts/import/use-contact-import-review.ts",
      "apps/web/src/app/(admitted)/account/contacts/import/use-reduced-motion.ts",
      "apps/web/src/app/(admitted)/account/contacts/import/use-review-working-set.ts",
      "apps/web/src/app/actions/contact-import.ts",
      "apps/web/src/lib/integrations/contact-import-preview-data.ts",
      "packages/db/src/queries/contacts-import-preview.ts",
      "packages/db/src/queries/contacts-import-preview/apply.ts",
      "packages/db/src/queries/contacts-import-preview/candidate.ts",
      "packages/db/src/queries/contacts-import-preview/decisions.ts",
      "packages/db/src/queries/contacts-import-preview/fake-adapter.ts",
      "packages/db/src/queries/contacts-import-preview/google-adapter.ts",
      "packages/db/src/queries/contacts-import-preview/service.ts",
      "packages/db/src/queries/contacts-import-preview/test-fixtures.ts",
      "packages/db/src/queries/contacts-import-preview/types.ts",
    ]);
  });

  it("cannot create Gmail drafts, send email, or bypass the Gmail approval gate", () => {
    for (const relativePath of CONTACT_IMPORT_SURFACES) {
      const imports = importSpecifiers(read(relativePath));
      expect(imports, `${relativePath} imports`).not.toContain("@tendnote/db/queries/gmail-drafts");
      expect(imports, `${relativePath} imports`).not.toContain("@/lib/integrations/gmail-drafts");
      expect(imports, `${relativePath} imports`).not.toContain("@/app/actions/gmail-drafts");
    }

    for (const forbidden of [
      "createdefaultgooglegmaildraftservice",
      "createdefaultgmailapprovalgate",
      "creategmaildraft",
      "updategmaildraft",
      "save_draft_to_gmail",
      "messages/send",
      "drafts/send",
      "gmail.send",
      "auth/gmail.send",
      "nodemailer",
      "sendgrid",
      "mailgun",
      "transporter.send",
    ]) {
      expect(contactImportSources).not.toContain(forbidden);
    }
  });

  it("does not infer suggested memories, follow-ups, embeddings, or retrieval context", () => {
    for (const relativePath of CONTACT_IMPORT_SURFACES) {
      const imports = importSpecifiers(read(relativePath)).join("\n").toLowerCase();
      for (const forbidden of [
        "queries/memories",
        "queries/followups",
        "queries/semantic-retrieval",
        "queries/relationship-context-search",
        "queries/context-snapshots",
        "queries/relationship-agenda",
        "background-jobs/embedding",
        "extraction-queue",
      ]) {
        expect(imports, `${relativePath} imports ${forbidden}`).not.toContain(forbidden);
      }
    }

    for (const forbidden of [
      "capturememory",
      "suggestfollowup",
      "proposefollowup",
      "enqueueandpublishsemanticembeddingjob",
      "relationship_context_embeddings",
      "searchsemanticcontext",
      "searchrelationshipcontext",
      "getpersoncontextsnapshot",
    ]) {
      expect(contactImportSources).not.toContain(forbidden);
    }
  });

  it("limits provider HTTP to the explicit People API read-only preview adapter", () => {
    const adapter = read("packages/db/src/queries/contacts-import-preview/google-adapter.ts");
    expect(adapter).toContain("/v1/people/me/connections");
    expect(adapter).toContain("READ_SOURCE_TYPE_CONTACT");
    expect(adapter).toContain("names,emailAddresses,phoneNumbers,birthdays");

    for (const relativePath of CONTACT_IMPORT_SURFACES.filter(
      (path) => path !== "packages/db/src/queries/contacts-import-preview/google-adapter.ts",
    )) {
      const source = read(relativePath).toLowerCase();
      expect(source, `${relativePath} should not call provider HTTP directly`).not.toContain(
        "people.googleapis",
      );
      expect(source, `${relativePath} should not call provider HTTP directly`).not.toContain(
        "googleapis.com",
      );
    }

    for (const forbidden of [
      "/v1/people:createcontact",
      "/v1/people:updatecontact",
      "/v1/contactgroups",
      "people.connections.updatecontact",
      "people.connections.deletecontact",
    ]) {
      expect(contactImportSources).not.toContain(forbidden);
    }
  });
});

describe("Phase 2E Contacts import boundary - Eve has no import/mutation tool path", () => {
  it("can explain Contacts import status by linking to the Account import surface", () => {
    const instructions = read("apps/agent/agent/instructions/base.md");
    expect(instructions).toContain("Contacts import stays on the Account page");
    expect(instructions).toContain("/account/contacts/import");
    expect(instructions).toContain("do not fetch, preview, apply, or mutate contact-import");
  });

  it("exposes no Eve tool that fetches, previews, applies, or mutates Contacts import candidates", () => {
    const tools = readdirSync(join(agentRoot, "tools")).filter((file) => file.endsWith(".ts"));
    expect(tools.filter((name) => /contact.*import|import.*contact|contacts/i.test(name))).toEqual(
      [],
    );

    for (const tool of tools) {
      const source = readFileSync(join(agentRoot, "tools", tool), "utf8").toLowerCase();
      for (const forbidden of [
        "contacts-import-preview",
        "contactimportpreview",
        "contact import candidate",
        "google contacts preview",
        "fetchcontacts",
        "applycontactimportcandidates",
      ]) {
        expect(source, `${tool} should not expose Contacts import`).not.toContain(forbidden);
      }
    }
  });

  it("keeps Contacts import out of rendered Eve tool components", () => {
    const domain = read("packages/domain/src/assistant-tool-results.ts").toLowerCase();
    expect(domain).not.toContain("contact_import");
    expect(domain).not.toContain("contacts_import");
  });
});

describe("Phase 2E Contacts import boundary - raw payloads stay out of durable schema", () => {
  it("stores only minimized provider references for confirmed imports", () => {
    const currentSchema = read("packages/db/src/schema/app/contact-import-provider-refs.ts");
    for (const allowed of [
      "ownerUserId",
      "personId",
      "providerKey",
      "providerContactId",
      "confirmedAt",
    ]) {
      expect(currentSchema).toContain(allowed);
    }
    for (const forbidden of ["payload", "raw", "jsonb", "etag", "metadata", "photo", "token"]) {
      expect(currentSchema.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("does not add raw-provider columns in any Contacts import migration", () => {
    const migrationSources = readdirSync(join(repoRoot, "packages/db/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => [file, read(`packages/db/migrations/${file}`).toLowerCase()] as const)
      .filter(([, source]) => source.includes("contact_import_provider_refs"));

    expect(migrationSources.length).toBeGreaterThan(0);
    const createTableBlocks = migrationSources.flatMap(([file, source]) => {
      const start = source.indexOf('create table "contact_import_provider_refs"');
      if (start === -1) return [];
      return [[file, source.slice(start, source.indexOf(");", start))] as const];
    });
    expect(createTableBlocks.length).toBe(1);
    for (const [file, block] of createTableBlocks) {
      const columns = [...block.matchAll(/^\s+"([a-z_]+)"/gm)].map((match) => match[1]);
      expect(columns.sort(), `${file} columns`).toEqual(
        [
          "confirmed_at",
          "id",
          "owner_user_id",
          "person_id",
          "provider_contact_id",
          "provider_key",
        ].sort(),
      );
    }
    for (const [file, source] of migrationSources) {
      for (const forbidden of ["payload", "raw", "jsonb", "etag", "metadata", "photo", "token"]) {
        expect(source, `${file} should not add ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
