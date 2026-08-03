import { randomUUID } from "node:crypto";
import {
  type ContextFact,
  contextFactSchema,
  contextFactSubjectId,
  normalizeContextFactContent,
  type PersistContextFact,
  persistContextFactSchema,
} from "@tendnote/domain";
import { isPersistedContextFactId } from "./id";
import type { ContextFactAuditLogEntry, ContextFactAuditLogInput, ContextFactStore } from "./types";

function isAllowedByFilter(
  fact: ContextFact,
  input: Parameters<ContextFactStore["listContextFacts"]>[0],
) {
  if (input.subjectUserId && fact.subject.kind === "self") {
    return fact.subject.userId === input.subjectUserId;
  }

  if (input.householdIds && fact.subject.kind === "household") {
    return input.householdIds.includes(fact.subject.householdId);
  }

  return false;
}

export type InMemoryContextFactStore = ContextFactStore & {
  records: Map<string, ContextFact>;
};

export function createInMemoryContextFactStore(seed: ContextFact[] = []): InMemoryContextFactStore {
  const records = new Map(seed.map((fact) => [fact.id, contextFactSchema.parse(fact)]));
  const auditLogEntries: ContextFactAuditLogEntry[] = [];

  return {
    records,
    async createContextFact(input: PersistContextFact) {
      const parsed = persistContextFactSchema.parse(input);
      if (parsed.id && !isPersistedContextFactId(parsed.id)) {
        throw new Error("Context Fact id must be a UUID.");
      }
      const duplicate = [...records.values()].some(
        (current) =>
          current.lifecycle === "active" &&
          current.subject.kind === parsed.subject.kind &&
          contextFactSubjectId(current.subject) === contextFactSubjectId(parsed.subject) &&
          current.category === parsed.category &&
          current.sensitivity === parsed.sensitivity &&
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
        !isAllowedByFilter(current, input) ||
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
      if (!current || !isAllowedByFilter(current, input)) return false;
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
      return isAllowedByFilter(fact, input) ? fact : null;
    },
    async listContextFacts(input) {
      if (input.subjectUserId === undefined && input.householdIds === undefined) {
        return [];
      }
      return [...records.values()]
        .filter((fact) =>
          input.lifecycles
            ? input.lifecycles.includes(fact.lifecycle)
            : input.lifecycle === undefined || fact.lifecycle === input.lifecycle,
        )
        .filter((fact) => isAllowedByFilter(fact, input))
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
