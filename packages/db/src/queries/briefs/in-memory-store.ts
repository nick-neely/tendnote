import { randomUUID } from "node:crypto";
import {
  type Brief,
  type BriefItem,
  type BriefWithItems,
  briefItemSchema,
  briefSchema,
  createBriefItemSchema,
  createBriefSchema,
} from "@tendnote/domain";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { BriefStore, InMemoryBriefLifecycleStore } from "./types";

/**
 * Minimal brief persistence over two maps. It enforces the same current-brief
 * uniqueness the Postgres partial unique index does (one non-superseded brief per
 * owner/local date/cadence), so idempotency is exercised in tests without a
 * database. It carries only brief methods so it can be spread into the composed
 * lifecycle store without shadowing person/source/audit methods.
 */
export function createInMemoryBriefStore(): BriefStore {
  const briefs = new Map<string, Brief>();
  const items = new Map<string, BriefItem>();

  function itemsForBrief(briefId: string): BriefItem[] {
    return [...items.values()]
      .filter((item) => item.briefId === briefId)
      .sort((a, b) => a.rank - b.rank);
  }

  function withItems(brief: Brief): BriefWithItems {
    return { ...brief, items: itemsForBrief(brief.id) };
  }

  function currentBrief(input: {
    ownerUserId: string;
    localDate: string;
    cadence: Brief["cadence"];
  }): Brief | null {
    return (
      [...briefs.values()].find(
        (brief) =>
          brief.ownerUserId === input.ownerUserId &&
          brief.localDate === input.localDate &&
          brief.cadence === input.cadence &&
          brief.supersededAt === null,
      ) ?? null
    );
  }

  return {
    async createBrief(input) {
      const { items: itemInputs, ...header } = createBriefSchema.parse(input);

      if (currentBrief({ ...header })) {
        throw new Error("A current brief already exists for this owner, local date, and cadence.");
      }

      const now = new Date();
      const brief: Brief = briefSchema.parse({
        ...header,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      briefs.set(brief.id, brief);

      for (const itemInput of itemInputs) {
        const parsed = createBriefItemSchema.parse(itemInput);
        const item: BriefItem = briefItemSchema.parse({
          ...parsed,
          id: randomUUID(),
          briefId: brief.id,
          createdAt: now,
          updatedAt: now,
        });
        items.set(item.id, item);
      }

      return withItems(brief);
    },
    async getBrief(input) {
      const brief = briefs.get(input.briefId);

      if (!brief || brief.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return withItems(brief);
    },
    async findCurrentBrief(input) {
      const brief = currentBrief(input);

      return brief ? withItems(brief) : null;
    },
    async supersedeCurrentBrief(input) {
      const brief = currentBrief(input);

      if (!brief) {
        return null;
      }

      const updated: Brief = { ...brief, supersededAt: input.supersededAt, updatedAt: new Date() };
      briefs.set(updated.id, updated);

      return updated;
    },
    async getBriefItem(input) {
      const item = items.get(input.briefItemId);

      if (!item || item.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return item;
    },
    async updateBriefItem(input) {
      const item = items.get(input.briefItemId);

      if (!item || item.ownerUserId !== input.ownerUserId) {
        throw new Error("Brief item not found.");
      }

      const updated = briefItemSchema.parse({
        ...item,
        ...input.patch,
        updatedAt: new Date(),
      });
      items.set(updated.id, updated);

      return updated;
    },
    async listBriefItemsForOwner(input) {
      const briefIds = new Set(
        [...briefs.values()]
          .filter(
            (brief) =>
              brief.ownerUserId === input.ownerUserId &&
              (input.cadence === undefined || brief.cadence === input.cadence),
          )
          .map((brief) => brief.id),
      );

      return [...items.values()]
        .filter(
          (item) =>
            item.ownerUserId === input.ownerUserId &&
            briefIds.has(item.briefId) &&
            (input.statuses === undefined || input.statuses.includes(item.status)) &&
            (input.kinds === undefined || input.kinds.includes(item.kind)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async listBriefsForOwner(input) {
      return [...briefs.values()]
        .filter(
          (brief) =>
            brief.ownerUserId === input.ownerUserId &&
            (input.cadence === undefined || brief.cadence === input.cadence) &&
            (input.includeSuperseded === true || brief.supersededAt === null),
        )
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
    },
  };
}

/**
 * Brief lifecycle store for tests and composition: the brief persistence store
 * plus a source-record base for person resolution, source-record grounding, and
 * audit logging. Mirrors the follow-up lifecycle store composition (PRD #42).
 */
export function createInMemoryBriefLifecycleStore(): InMemoryBriefLifecycleStore {
  return {
    ...createInMemorySourceRecordStore(),
    ...createInMemoryBriefStore(),
  };
}
