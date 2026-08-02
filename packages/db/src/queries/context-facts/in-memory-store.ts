import { randomUUID } from "node:crypto";
import {
  type ContextFact,
  contextFactSchema,
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
        .filter((fact) => input.lifecycle === undefined || fact.lifecycle === input.lifecycle)
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
