/**
 * Embed-on-write for Assets and Asset Memories (#204).
 *
 * Assets join memories, source records, and General Actions on the shared semantic
 * embedding pipeline, so a fuzzy question ("anything for the kitchen fridge?") can
 * reach them. The trigger is wired here, once, and fired by both the lifecycle seam
 * and the review seam — so the two can never drift about *when* a record becomes
 * semantically retrievable.
 *
 * Two properties matter:
 *
 * - **Optional.** With no scheduler wired (the default for tests and stores that do
 *   not exercise retrieval), it does nothing. Asset writes never depend on the
 *   embedding pipeline being available.
 * - **Best-effort.** An embedding failure must never fail the write that caused it.
 *   Losing a vector costs a fuzzy hit; failing the write loses the user's fact. The
 *   embed job is durable and idempotent, so a dropped one is re-enqueued on the next
 *   write, and a manual re-index can always rebuild it.
 *
 * Eligibility — what is durable enough to be retrievable at all — is *not* decided
 * here. It lives in the domain (`decideAssetEmbedding` / `decideAssetMemoryEmbedding`)
 * and is re-checked by the processor when the job runs, so a record that has since
 * been dismissed or archived is skipped rather than embedded.
 */
export type AssetEmbeddingScheduler = (input: {
  ownerUserId: string;
  recordKind: "asset" | "asset_memory";
  recordId: string;
}) => Promise<unknown>;

export type AssetEmbeddingDeps = {
  scheduleAssetEmbedding?: AssetEmbeddingScheduler;
};

export type ScheduleAssetEmbedding = {
  asset: (asset: { id: string; ownerUserId: string }) => Promise<void>;
  memory: (memory: { id: string; ownerUserId: string }) => Promise<void>;
};

export function makeScheduleAssetEmbedding(deps: AssetEmbeddingDeps): ScheduleAssetEmbedding {
  const schedule = deps.scheduleAssetEmbedding;

  async function enqueue(
    recordKind: "asset" | "asset_memory",
    record: { id: string; ownerUserId: string },
  ) {
    if (!schedule) {
      return;
    }

    try {
      await schedule({ ownerUserId: record.ownerUserId, recordKind, recordId: record.id });
    } catch {
      // A lost vector costs a fuzzy hit; a failed write would cost the user's fact.
      // The job is idempotent, so the next write re-enqueues it.
    }
  }

  return {
    asset: (asset) => enqueue("asset", asset),
    memory: (memory) => enqueue("asset_memory", memory),
  };
}
