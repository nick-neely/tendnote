import { and, eq } from "drizzle-orm";
import { getDb } from "../client";
import { auditLog, contactImportProviderRefs, providerConnections } from "../schema";
import { createDrizzleContactMethodStore } from "./contact-methods/drizzle-store";
import {
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
} from "./contacts-import-preview/fake-adapter";
import { applyContactImportCandidatesWithAffectedScopes } from "./contacts-import-preview/service";
import type {
  ContactImportApplyDeps,
  ContactImportAuditEntry,
  ContactImportCandidateConfirmation,
  ContactImportPreviewAdapter,
  ContactImportProviderReferenceInput,
} from "./contacts-import-preview/types";
import { createDrizzlePeopleStore } from "./people/drizzle-store";
import { createPeopleQueries } from "./people/queries";

export {
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
} from "./contacts-import-preview/fake-adapter";
export {
  createGoogleContactsAdapter,
  type GoogleContactsAdapterOptions,
} from "./contacts-import-preview/google-adapter";
export {
  applyContactImportCandidates,
  applyContactImportCandidatesWithAffectedScopes,
  createContactImportPreviewSession,
} from "./contacts-import-preview/service";
export type * from "./contacts-import-preview/types";
export type {
  ContactImportAuditEntry,
  ContactImportProviderReferenceInput,
} from "./contacts-import-preview/types";

export async function createContactImportProviderReference(
  input: ContactImportProviderReferenceInput,
) {
  await getDb()
    .insert(contactImportProviderRefs)
    .values(input)
    .onConflictDoNothing({
      target: [
        contactImportProviderRefs.ownerUserId,
        contactImportProviderRefs.providerKey,
        contactImportProviderRefs.providerContactId,
      ],
    });
}

export async function createContactImportAuditLogEntry(entry: ContactImportAuditEntry) {
  await getDb().insert(auditLog).values(entry);
}

export async function applyOwnerContactImportCandidates(input: {
  ownerUserId: string;
  mode?: "safe_bulk" | "explicit";
  confirmations: ContactImportCandidateConfirmation[];
  adapter?: ContactImportPreviewAdapter;
}) {
  const db = getDb();

  return applyContactImportCandidatesWithAffectedScopes(input, {
    adapter: input.adapter ?? createFakeContactImportPreviewAdapter(),
    fuzzyMatcher: createFakeContactImportFuzzyMatcher(),
    isProviderCapabilityConnected: async (ref) => {
      const [connection] = await db
        .select({ id: providerConnections.id })
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.ownerUserId, ref.ownerUserId),
            eq(providerConnections.providerKey, ref.providerKey),
            eq(providerConnections.capabilityKey, ref.capabilityKey),
            eq(providerConnections.status, "connected"),
          ),
        )
        .limit(1);

      return Boolean(connection);
    },
    ...createDrizzlePeopleDeps(),
    ...createDrizzleContactMethodDeps(),
    createProviderReference: async (ref) => {
      await db
        .insert(contactImportProviderRefs)
        .values(ref)
        .onConflictDoNothing({
          target: [
            contactImportProviderRefs.ownerUserId,
            contactImportProviderRefs.providerKey,
            contactImportProviderRefs.providerContactId,
          ],
        });
    },
    createAuditLogEntry: async (entry) => {
      await db.insert(auditLog).values(entry);
    },
  } satisfies ContactImportApplyDeps);
}

/**
 * Contact import reuses the canonical people and contact-method stores rather
 * than re-deriving their Drizzle queries. Each helper picks only the operations
 * the apply path is allowed to perform, so the narrower capability surface is
 * enforced by what is handed to `ContactImportApplyDeps` — import can create and
 * update people, never delete them or read profiles.
 */
function createDrizzlePeopleDeps() {
  const peopleQueries = createPeopleQueries(createDrizzlePeopleStore());
  return {
    createPerson: peopleQueries.createPerson,
    updatePerson: peopleQueries.updatePerson,
    searchPeople: peopleQueries.searchPeople,
    getPerson: peopleQueries.getPerson,
  };
}

function createDrizzleContactMethodDeps(): Pick<
  ContactImportApplyDeps,
  "findOwnerContactMethodDuplicates" | "createContactMethod"
> {
  const contactMethodStore = createDrizzleContactMethodStore();
  return {
    findOwnerContactMethodDuplicates: contactMethodStore.findOwnerContactMethodDuplicates,
    createContactMethod: contactMethodStore.createContactMethod,
  };
}
