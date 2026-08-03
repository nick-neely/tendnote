import { randomUUID } from "node:crypto";
import {
  type ContextFact,
  contextFactSchema,
  contextFactSubjectId,
  normalizeContextFactContent,
  persistContextFactSchema,
} from "@tendnote/domain";
import { isPersistedContextFactId } from "./id";
import type {
  ContextFactAuditLogEntry,
  ContextFactAuditLogInput,
  ContextFactHouseholdAccess,
  ContextFactStore,
} from "./types";

async function isAllowedByFilter(
  fact: ContextFact,
  input: Parameters<ContextFactStore["listContextFacts"]>[0],
  householdAccess?: ContextFactHouseholdAccess,
): Promise<boolean> {
  if (input.subjectUserId && fact.subject.kind === "self") {
    return fact.subject.userId === input.subjectUserId;
  }

  if (input.householdIds && fact.subject.kind === "household") {
    if (!input.householdIds.includes(fact.subject.householdId)) return false;
    if (input.activeHouseholdMemberUserId === undefined || !householdAccess) return false;
    const memberships = await householdAccess.listHouseholdMemberships({
      householdId: fact.subject.householdId,
      status: "active",
    });
    return memberships.some(
      (membership) => membership.userId === input.activeHouseholdMemberUserId,
    );
  }

  return false;
}

export type InMemoryContextFactStore = ContextFactStore & {
  records: Map<string, ContextFact>;
};

export function createInMemoryContextFactStore(
  seed: ContextFact[] = [],
  options: { householdAccess?: ContextFactHouseholdAccess } = {},
): InMemoryContextFactStore {
  const records = new Map(seed.map((fact) => [fact.id, contextFactSchema.parse(fact)]));
  const auditLogEntries: ContextFactAuditLogEntry[] = [];

  return {
    records,
    async createContextFact(input) {
      const { activeHouseholdMemberUserId, pendingSuggestionLimit, ...persistedInput } = input;
      const parsed = persistContextFactSchema.parse(persistedInput);
      if (parsed.subject.kind === "household") {
        if (activeHouseholdMemberUserId === undefined || !options.householdAccess) {
          throw new Error("Active household membership is required for Household Context.");
        }
        const memberships = await options.householdAccess.listHouseholdMemberships({
          householdId: parsed.subject.householdId,
          status: "active",
        });
        if (!memberships.some((membership) => membership.userId === activeHouseholdMemberUserId)) {
          throw new Error("Active household membership is required for Household Context.");
        }
      }
      if (parsed.id && !isPersistedContextFactId(parsed.id)) {
        throw new Error("Context Fact id must be a UUID.");
      }
      if (
        parsed.lifecycle === "suggested" &&
        pendingSuggestionLimit !== undefined &&
        [...records.values()].filter(
          (current) =>
            current.lifecycle === "suggested" &&
            current.subject.kind === parsed.subject.kind &&
            contextFactSubjectId(current.subject) === contextFactSubjectId(parsed.subject),
        ).length >= pendingSuggestionLimit
      ) {
        throw new Error("Pending Context Fact suggestion limit reached.");
      }
      const duplicate = [...records.values()].some(
        (current) =>
          (parsed.lifecycle === "active" || parsed.lifecycle === "suggested") &&
          current.lifecycle === parsed.lifecycle &&
          current.subject.kind === parsed.subject.kind &&
          contextFactSubjectId(current.subject) === contextFactSubjectId(parsed.subject) &&
          current.category === parsed.category &&
          (parsed.lifecycle !== "suggested" || current.sensitivity === parsed.sensitivity) &&
          normalizeContextFactContent(current.content) ===
            normalizeContextFactContent(parsed.content),
      );
      if (duplicate) {
        throw new Error("Context Fact already exists.");
      }
      const now = new Date();
      const fact = contextFactSchema.parse({
        ...parsed,
        id: parsed.id ?? randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      const existing = records.get(fact.id);
      if (existing) {
        throw new Error("Context Fact already exists.");
      }
      records.set(fact.id, fact);
      return fact;
    },
    async updateContextFact(input) {
      if (!isPersistedContextFactId(input.contextFactId)) return null;
      if (input.subjectUserId === undefined && input.householdIds === undefined) return null;
      const current = records.get(input.contextFactId);
      if (
        !current ||
        !(await isAllowedByFilter(current, input, options.householdAccess)) ||
        (input.lifecycle !== undefined && current.lifecycle !== input.lifecycle) ||
        (input.expectedUpdatedAt !== undefined &&
          current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) ||
        (input.expectedArchivedAt !== undefined &&
          (current.archivedAt === null ||
            current.archivedAt.getTime() !== input.expectedArchivedAt.getTime()))
      ) {
        return null;
      }
      const updated = contextFactSchema.parse({
        ...current,
        ...input.patch,
      });
      records.set(updated.id, updated);
      return updated;
    },
    async deleteContextFact(input) {
      if (!isPersistedContextFactId(input.contextFactId)) return false;
      if (input.subjectUserId === undefined && input.householdIds === undefined) return false;
      const current = records.get(input.contextFactId);
      if (
        !current ||
        !(await isAllowedByFilter(current, input, options.householdAccess)) ||
        (input.lifecycle !== undefined && current.lifecycle !== input.lifecycle) ||
        (input.expectedUpdatedAt !== undefined &&
          current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
      ) {
        return false;
      }
      records.delete(input.contextFactId);
      if (input.auditLogEntry) {
        auditLogEntries.push({
          ...input.auditLogEntry,
          id: randomUUID(),
          createdAt: new Date(),
        });
      }
      return true;
    },
    async getContextFact(input) {
      const fact = records.get(input.contextFactId);
      if (!fact) return null;
      if (input.subjectUserId === undefined && input.householdIds === undefined) {
        return null;
      }
      return (await isAllowedByFilter(fact, input, options.householdAccess)) ? fact : null;
    },
    async listContextFacts(input) {
      if (input.subjectUserId === undefined && input.householdIds === undefined) {
        return [];
      }
      const candidates = [...records.values()].filter((fact) =>
        input.lifecycles
          ? input.lifecycles.includes(fact.lifecycle)
          : input.lifecycle === undefined || fact.lifecycle === input.lifecycle,
      );
      const allowed = await Promise.all(
        candidates.map(async (fact) =>
          (await isAllowedByFilter(fact, input, options.householdAccess)) ? fact : null,
        ),
      );
      return allowed
        .filter((fact): fact is ContextFact => fact !== null)
        .sort(
          (left, right) =>
            right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
        );
    },
    async createAuditLogEntry(input: ContextFactAuditLogInput) {
      const entry: ContextFactAuditLogEntry = {
        ...input,
        id: randomUUID(),
        createdAt: new Date(),
      };
      auditLogEntries.push(entry);
      return entry;
    },
    async listAuditLogEntries(input) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
  };
}
