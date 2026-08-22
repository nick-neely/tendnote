import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { ownerDataExportArtifacts, ownerDataExportJobs } from "../../schema";
import type {
  EnqueueOwnerDataExportJobInput,
  OwnerDataExportArtifactStore,
  OwnerDataExportJobStore,
} from "./types";

const DEFAULT_LEASE_DURATION_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

function scrubError(error: string) {
  return error.replace(/\s+/g, " ").trim().slice(0, 500);
}

/** A caller-supplied key makes the enqueue idempotent; otherwise it is unique. */
function enqueueIdempotencyKey(input: EnqueueOwnerDataExportJobInput) {
  return input.idempotencyKey ?? `owner-data-export:${input.ownerUserId}:${randomUUID()}`;
}

/** The insert lost the conflict race, so the winning row must already exist. */
async function requireExistingJob(ownerUserId: string, idempotencyKey: string) {
  const [existing] = await getDb()
    .select()
    .from(ownerDataExportJobs)
    .where(
      and(
        eq(ownerDataExportJobs.ownerUserId, ownerUserId),
        eq(ownerDataExportJobs.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Failed to create owner data export job.");
  return existing;
}

export function createDrizzleOwnerDataExportJobStore(): OwnerDataExportJobStore {
  return {
    async enqueue(input: EnqueueOwnerDataExportJobInput) {
      const idempotencyKey = enqueueIdempotencyKey(input);
      const [created] = await getDb()
        .insert(ownerDataExportJobs)
        .values({
          ownerUserId: input.ownerUserId,
          idempotencyKey,
          runAfter: input.now ?? new Date(),
        })
        .onConflictDoNothing({
          target: [ownerDataExportJobs.ownerUserId, ownerDataExportJobs.idempotencyKey],
        })
        .returning();
      if (created) return { job: created, created: true };
      return { job: await requireExistingJob(input.ownerUserId, idempotencyKey), created: false };
    },
    async get(input) {
      const filters = [eq(ownerDataExportJobs.id, input.jobId)];
      if (input.ownerUserId) filters.push(eq(ownerDataExportJobs.ownerUserId, input.ownerUserId));
      const [job] = await getDb()
        .select()
        .from(ownerDataExportJobs)
        .where(and(...filters))
        .limit(1);
      return job ?? null;
    },
    async getLatestForOwner(input) {
      const [job] = await getDb()
        .select()
        .from(ownerDataExportJobs)
        .where(eq(ownerDataExportJobs.ownerUserId, input.ownerUserId))
        .orderBy(desc(ownerDataExportJobs.createdAt), desc(ownerDataExportJobs.id))
        .limit(1);
      return job ?? null;
    },
    async claim(input) {
      const now = input.now ?? new Date();
      const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
      const staleBefore = new Date(now.getTime() - leaseDurationMs);
      const [job] = await getDb()
        .update(ownerDataExportJobs)
        .set({
          status: "running",
          attempts: sql`${ownerDataExportJobs.attempts} + 1`,
          claimedAt: now,
          claimToken: randomUUID(),
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(ownerDataExportJobs.id, input.jobId),
            or(
              and(
                or(
                  eq(ownerDataExportJobs.status, "pending"),
                  eq(ownerDataExportJobs.status, "failed"),
                ),
                lte(ownerDataExportJobs.runAfter, now),
              ),
              and(
                eq(ownerDataExportJobs.status, "running"),
                lte(ownerDataExportJobs.claimedAt, staleBefore),
              ),
            ),
          ),
        )
        .returning();
      return job ?? null;
    },
    async claimNext(input) {
      const now = input.now ?? new Date();
      const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
      const staleBefore = new Date(now.getTime() - leaseDurationMs);
      const [candidate] = await getDb()
        .select({ id: ownerDataExportJobs.id })
        .from(ownerDataExportJobs)
        .where(
          or(
            and(
              or(
                eq(ownerDataExportJobs.status, "pending"),
                eq(ownerDataExportJobs.status, "failed"),
              ),
              lte(ownerDataExportJobs.runAfter, now),
            ),
            and(
              eq(ownerDataExportJobs.status, "running"),
              lte(ownerDataExportJobs.claimedAt, staleBefore),
            ),
          ),
        )
        .orderBy(asc(ownerDataExportJobs.runAfter), asc(ownerDataExportJobs.createdAt))
        .limit(1);
      return candidate ? this.claim({ jobId: candidate.id, now, leaseDurationMs }) : null;
    },
    async markCompleted(input) {
      const completedAt = input.completedAt ?? new Date();
      const [job] = await getDb()
        .update(ownerDataExportJobs)
        .set({
          status: "completed",
          completedAt,
          artifactExpiresAt: input.artifactExpiresAt,
          claimedAt: null,
          claimToken: null,
          lastError: null,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(ownerDataExportJobs.id, input.jobId),
            eq(ownerDataExportJobs.status, "running"),
            eq(ownerDataExportJobs.claimToken, input.expectedClaimToken),
          ),
        )
        .returning();
      return job ?? null;
    },
    async markFailed(input) {
      const [job] = await getDb()
        .update(ownerDataExportJobs)
        .set({
          status: "failed",
          lastError: scrubError(input.error),
          runAfter: input.runAfter,
          claimedAt: null,
          claimToken: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ownerDataExportJobs.id, input.jobId),
            eq(ownerDataExportJobs.status, "running"),
            eq(ownerDataExportJobs.claimToken, input.expectedClaimToken),
          ),
        )
        .returning();
      return job ?? null;
    },
    async markExpired(input) {
      const now = input.now ?? new Date();
      const [job] = await getDb()
        .update(ownerDataExportJobs)
        // Retain the expiry cursor so a failed byte deletion stays recoverable.
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(ownerDataExportJobs.id, input.jobId),
            inArray(ownerDataExportJobs.status, ["completed", "expired"]),
            lte(ownerDataExportJobs.artifactExpiresAt, now),
          ),
        )
        .returning();
      return job ?? null;
    },
    async markArtifactDeleted(input) {
      const now = input.now ?? new Date();
      const [job] = await getDb()
        .update(ownerDataExportJobs)
        .set({ artifactExpiresAt: null, updatedAt: now })
        .where(
          and(eq(ownerDataExportJobs.id, input.jobId), eq(ownerDataExportJobs.status, "expired")),
        )
        .returning();
      return job ?? null;
    },
    async listExpired(input) {
      const now = input.now ?? new Date();
      return getDb()
        .select()
        .from(ownerDataExportJobs)
        .where(
          and(
            inArray(ownerDataExportJobs.status, ["completed", "expired"]),
            lte(ownerDataExportJobs.artifactExpiresAt, now),
          ),
        )
        .orderBy(asc(ownerDataExportJobs.artifactExpiresAt))
        .limit(input.limit);
    },
  };
}

export function createDrizzleOwnerDataExportArtifactStore(): OwnerDataExportArtifactStore {
  return {
    async put(input) {
      const now = new Date();
      // The row lock serializes claim replacement/completion with the upsert.
      // No bytes are written when this worker's claim is already stale.
      const written = await getDb().execute(sql<{ job_id: string }>`
        with active_claim as materialized (
          select ${ownerDataExportJobs.id}
          from ${ownerDataExportJobs}
          where
            ${ownerDataExportJobs.id} = ${input.jobId}
            and ${ownerDataExportJobs.ownerUserId} = ${input.ownerUserId}
            and ${ownerDataExportJobs.status} = 'running'
            and ${ownerDataExportJobs.claimToken} = ${input.expectedClaimToken}
          for update
        )
        insert into ${ownerDataExportArtifacts} (
          "job_id",
          "owner_user_id",
          "bytes",
          "expires_at"
        )
        select
          ${input.jobId},
          ${input.ownerUserId},
          ${Buffer.from(input.bytes)},
          ${input.expiresAt}
        from active_claim
        on conflict ("job_id") do update set
          "owner_user_id" = excluded."owner_user_id",
          "bytes" = excluded."bytes",
          "expires_at" = excluded."expires_at",
          "updated_at" = ${now}
        returning "job_id"
      `);
      if (written.length === 0) return null;
      return {
        jobId: input.jobId,
        ownerUserId: input.ownerUserId,
        bytes: new Uint8Array(input.bytes),
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
      };
    },
    async get(input) {
      const now = input.now ?? new Date();
      const [artifact] = await getDb()
        .select()
        .from(ownerDataExportArtifacts)
        .where(
          and(
            eq(ownerDataExportArtifacts.jobId, input.jobId),
            eq(ownerDataExportArtifacts.ownerUserId, input.ownerUserId),
            // Do not reveal whether a mismatched/unknown artifact exists.
            // The expiry predicate keeps the object store itself authoritative.
            sql`${ownerDataExportArtifacts.expiresAt} > ${now}`,
          ),
        )
        .limit(1);
      return artifact ?? null;
    },
    async delete(input) {
      await getDb()
        .delete(ownerDataExportArtifacts)
        .where(eq(ownerDataExportArtifacts.jobId, input.jobId));
    },
    async deleteExpired(input) {
      const now = input.now ?? new Date();
      if (input.limit <= 0) return 0;
      const expired = await getDb()
        .select({ jobId: ownerDataExportArtifacts.jobId })
        .from(ownerDataExportArtifacts)
        .where(lte(ownerDataExportArtifacts.expiresAt, now))
        .orderBy(asc(ownerDataExportArtifacts.expiresAt))
        .limit(input.limit);
      if (expired.length === 0) return 0;
      await getDb()
        .delete(ownerDataExportArtifacts)
        .where(
          sql`${ownerDataExportArtifacts.jobId} in (${sql.join(
            expired.map((item) => sql`${item.jobId}`),
            sql`, `,
          )})`,
        );
      return expired.length;
    },
  };
}

export { RETRY_DELAY_MS as OWNER_DATA_EXPORT_RETRY_DELAY_MS };
