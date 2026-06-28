import {
  type Brief,
  type BriefItem,
  type BriefWithItems,
  briefItemSchema,
  createBriefItemSchema,
  createBriefSchema,
} from "@tendnote/domain";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../client";
import { briefItems, briefs } from "../../schema";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { BriefLifecycleStore, BriefStore } from "./types";

async function loadItems(briefId: string): Promise<BriefItem[]> {
  const rows = await getDb()
    .select()
    .from(briefItems)
    .where(eq(briefItems.briefId, briefId))
    .orderBy(asc(briefItems.rank));

  return rows.map((row) => briefItemSchema.parse(row));
}

async function withItems(brief: Brief): Promise<BriefWithItems> {
  return { ...brief, items: await loadItems(brief.id) };
}

/**
 * Drizzle-backed brief persistence store. Carries only brief methods so it can be
 * spread into the composed lifecycle store without shadowing person/source/audit
 * methods (mirrors the follow-up store, PRD #11/#42). Current-brief uniqueness is
 * enforced by the `briefs_owner_date_cadence_current_idx` partial unique index.
 */
export function createDrizzleBriefStore(): BriefStore {
  return {
    async createBrief(input) {
      const { items, ...header } = createBriefSchema.parse(input);

      // Pre-check the current-brief uniqueness so callers get the same friendly
      // error the in-memory store raises rather than a raw constraint violation;
      // the partial unique index remains the backstop against races.
      const existing = await this.findCurrentBrief({
        ownerUserId: header.ownerUserId,
        localDate: header.localDate,
        cadence: header.cadence,
      });

      if (existing) {
        throw new Error("A current brief already exists for this owner, local date, and cadence.");
      }

      // Header is inserted first so item rows always reference a real brief. There
      // is no surrounding transaction (the neon-http driver used in production does
      // not support multi-statement transactions, matching the rest of this layer).
      const [brief] = await getDb().insert(briefs).values(briefSchemaToInsert(header)).returning();

      if (!brief) {
        throw new Error("Failed to create brief.");
      }

      if (items.length > 0) {
        await getDb()
          .insert(briefItems)
          .values(
            items.map((item) => ({
              ...createBriefItemSchema.parse(item),
              briefId: brief.id,
            })),
          );
      }

      return withItems(briefSchemaToBrief(brief));
    },
    async getBrief(input) {
      const [brief] = await getDb()
        .select()
        .from(briefs)
        .where(and(eq(briefs.id, input.briefId), eq(briefs.ownerUserId, input.ownerUserId)))
        .limit(1);

      return brief ? withItems(briefSchemaToBrief(brief)) : null;
    },
    async findCurrentBrief(input) {
      const [brief] = await getDb()
        .select()
        .from(briefs)
        .where(
          and(
            eq(briefs.ownerUserId, input.ownerUserId),
            eq(briefs.localDate, input.localDate),
            eq(briefs.cadence, input.cadence),
            isNull(briefs.supersededAt),
          ),
        )
        .limit(1);

      return brief ? withItems(briefSchemaToBrief(brief)) : null;
    },
    async supersedeCurrentBrief(input) {
      const [brief] = await getDb()
        .update(briefs)
        .set({ supersededAt: input.supersededAt, updatedAt: new Date() })
        .where(
          and(
            eq(briefs.ownerUserId, input.ownerUserId),
            eq(briefs.localDate, input.localDate),
            eq(briefs.cadence, input.cadence),
            isNull(briefs.supersededAt),
          ),
        )
        .returning();

      return brief ? briefSchemaToBrief(brief) : null;
    },
    async getBriefItem(input) {
      const [item] = await getDb()
        .select()
        .from(briefItems)
        .where(
          and(eq(briefItems.id, input.briefItemId), eq(briefItems.ownerUserId, input.ownerUserId)),
        )
        .limit(1);

      return item ? briefItemSchema.parse(item) : null;
    },
    async updateBriefItem(input) {
      const [item] = await getDb()
        .update(briefItems)
        .set({ ...input.patch, updatedAt: new Date() })
        .where(
          and(eq(briefItems.id, input.briefItemId), eq(briefItems.ownerUserId, input.ownerUserId)),
        )
        .returning();

      if (!item) {
        throw new Error("Brief item not found.");
      }

      return briefItemSchema.parse(item);
    },
    async listBriefItemsForOwner(input) {
      const rows = await getDb()
        .select()
        .from(briefItems)
        .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
        .where(
          and(
            eq(briefItems.ownerUserId, input.ownerUserId),
            ...(input.cadence ? [eq(briefs.cadence, input.cadence)] : []),
            ...(input.statuses ? [inArray(briefItems.status, input.statuses)] : []),
            ...(input.kinds ? [inArray(briefItems.kind, input.kinds)] : []),
          ),
        )
        .orderBy(desc(briefItems.createdAt));

      return rows.map((row) => briefItemSchema.parse(row.brief_items));
    },
    async listBriefsForOwner(input) {
      const rows = await getDb()
        .select()
        .from(briefs)
        .where(
          and(
            eq(briefs.ownerUserId, input.ownerUserId),
            ...(input.cadence ? [eq(briefs.cadence, input.cadence)] : []),
            ...(input.includeSuperseded === true ? [] : [isNull(briefs.supersededAt)]),
          ),
        )
        .orderBy(desc(briefs.generatedAt));

      return rows.map((row) => briefSchemaToBrief(row));
    },
  };
}

/**
 * Brief lifecycle store: the brief persistence store plus the source-record store
 * for person resolution, source-record grounding, and audit logging. Mirrors the
 * follow-up lifecycle store composition (PRD #42).
 */
export function createDrizzleBriefLifecycleStore(): BriefLifecycleStore {
  return {
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleBriefStore(),
  };
}

type BriefRow = typeof briefs.$inferSelect;

function briefSchemaToBrief(row: BriefRow): Brief {
  // Drizzle returns nullable columns as `null`; the domain schema defaults align,
  // and parsing keeps Date coercion and provenance typing consistent with reads.
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    cadence: row.cadence,
    localDate: row.localDate,
    generationReason: row.generationReason,
    generatedAt: row.generatedAt,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    summary: row.summary ?? null,
    summaryProvenance: row.summaryProvenance ?? null,
    supersededAt: row.supersededAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function briefSchemaToInsert(header: Omit<Brief, "id" | "createdAt" | "updatedAt">) {
  return {
    ownerUserId: header.ownerUserId,
    cadence: header.cadence,
    localDate: header.localDate,
    generationReason: header.generationReason,
    generatedAt: header.generatedAt,
    windowStart: header.windowStart,
    windowEnd: header.windowEnd,
    summary: header.summary ?? null,
    summaryProvenance: header.summaryProvenance ?? null,
    supersededAt: header.supersededAt ?? null,
  };
}
