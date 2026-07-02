import { contactMethodDisplayValue } from "@tendnote/domain";
import { and, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import {
  auditLog,
  contactImportProviderRefs,
  contactMethods,
  people,
  providerConnections,
} from "../schema";
import {
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
} from "./contacts-import-preview/fake-adapter";
import { applyContactImportCandidates } from "./contacts-import-preview/service";
import type {
  ContactImportApplyDeps,
  ContactImportAuditEntry,
  ContactImportCandidateResolution,
  ContactImportProviderReferenceInput,
} from "./contacts-import-preview/types";
import { createPeopleQueries } from "./people/queries";
import type { PeopleStore } from "./people/types";

export {
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
} from "./contacts-import-preview/fake-adapter";
export {
  applyContactImportCandidates,
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
  candidateIds?: string[];
  mode?: "safe_bulk" | "explicit";
  resolutions?: ContactImportCandidateResolution[];
}) {
  return getDb().transaction(async (tx) =>
    applyContactImportCandidates(input, {
      adapter: createFakeContactImportPreviewAdapter(),
      fuzzyMatcher: createFakeContactImportFuzzyMatcher(),
      isProviderCapabilityConnected: async (ref) => {
        const [connection] = await tx
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
      ...createTransactionPeopleDeps(tx),
      ...createTransactionContactMethodDeps(tx),
      createProviderReference: async (ref) => {
        await tx
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
        await tx.insert(auditLog).values(entry);
      },
    } satisfies ContactImportApplyDeps),
  );
}

type DbClient = ReturnType<typeof getDb>;
type TransactionClient = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

function createTransactionPeopleDeps(tx: TransactionClient) {
  const peopleQueries = createPeopleQueries(createTransactionPeopleStore(tx));
  return {
    createPerson: peopleQueries.createPerson,
    updatePerson: peopleQueries.updatePerson,
    searchPeople: peopleQueries.searchPeople,
    getPerson: peopleQueries.getPerson,
  };
}

function createTransactionPeopleStore(tx: TransactionClient): PeopleStore {
  return {
    async createPerson(values) {
      const [person] = await tx.insert(people).values(values).returning();

      if (!person) {
        throw new Error("Failed to create person.");
      }

      return person;
    },

    async updatePerson({ ownerUserId, personId, patch }) {
      const [person] = await tx
        .update(people)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(people.id, personId), eq(people.ownerUserId, ownerUserId)))
        .returning();

      return person ?? null;
    },

    async deletePerson() {
      throw new Error("Contact import does not delete people.");
    },

    async createAuditLogEntry(values) {
      await tx.insert(auditLog).values(values);
    },

    async searchPeople(input) {
      const where: SQL[] = [eq(people.ownerUserId, input.ownerUserId)];
      const query = input.query?.trim();
      if (query) {
        const queryFilter = or(
          ilike(people.displayName, `%${query}%`),
          ilike(people.firstName, `%${query}%`),
          ilike(people.lastName, `%${query}%`),
        );

        if (queryFilter) {
          where.push(queryFilter);
        }
      }

      if (input.relationshipType) {
        where.push(eq(people.relationshipType, input.relationshipType));
      }

      return tx
        .select()
        .from(people)
        .where(and(...where))
        .limit(input.limit)
        .orderBy(people.displayName, people.id);
    },

    async getPerson(input) {
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, input.personId), eq(people.ownerUserId, input.ownerUserId)))
        .limit(1);

      return person ?? null;
    },

    async getPersonProfile() {
      throw new Error("Contact import does not read person profiles.");
    },
  };
}

function createTransactionContactMethodDeps(tx: TransactionClient) {
  return {
    async findOwnerContactMethodDuplicates(input) {
      const emailValues = input.methods
        .filter((method) => method.type === "email" && method.normalizedValue)
        .map((method) => method.normalizedValue as string);
      const phoneValues = input.methods
        .filter((method) => method.type === "phone" && method.normalizedValue)
        .map((method) => method.normalizedValue as string);
      const filters = [
        emailValues.length > 0
          ? and(
              eq(contactMethods.type, "email"),
              inArray(contactMethods.normalizedValue, emailValues),
            )
          : undefined,
        phoneValues.length > 0
          ? and(
              eq(contactMethods.type, "phone"),
              inArray(contactMethods.normalizedValue, phoneValues),
            )
          : undefined,
      ].filter(Boolean);

      if (filters.length === 0) {
        return [];
      }

      const rows = await tx
        .select({
          id: contactMethods.id,
          personId: contactMethods.personId,
          type: contactMethods.type,
          value: contactMethods.value,
          displayValue: contactMethods.displayValue,
          normalizedValue: contactMethods.normalizedValue,
        })
        .from(contactMethods)
        .innerJoin(people, eq(contactMethods.personId, people.id))
        .where(and(eq(people.ownerUserId, input.ownerUserId), or(...filters)));

      return rows
        .filter((row) => row.type === "email" || row.type === "phone")
        .map((row) => ({
          ...row,
          type: row.type as "email" | "phone",
          displayValue: contactMethodDisplayValue(row),
        }));
    },

    async createContactMethod(input) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, input.personId), eq(people.ownerUserId, input.ownerUserId)))
        .limit(1);

      if (!person) {
        throw new Error("Person not found for owner.");
      }

      const [created] = await tx
        .insert(contactMethods)
        .values({
          personId: input.personId,
          type: input.type,
          value: input.value,
          displayValue: input.displayValue,
          normalizedValue: input.normalizedValue,
          isPrimary: input.isPrimary ?? false,
          source: input.source ?? "contact_import",
        })
        .returning({
          id: contactMethods.id,
          personId: contactMethods.personId,
          type: contactMethods.type,
          value: contactMethods.value,
          displayValue: contactMethods.displayValue,
          normalizedValue: contactMethods.normalizedValue,
        });

      if (!created || (created.type !== "email" && created.type !== "phone")) {
        throw new Error("Failed to create contact method.");
      }

      return {
        ...created,
        type: created.type,
        displayValue: contactMethodDisplayValue(created),
      };
    },
  } satisfies Pick<
    ContactImportApplyDeps,
    "findOwnerContactMethodDuplicates" | "createContactMethod"
  >;
}
