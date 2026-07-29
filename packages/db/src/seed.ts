import { generateDeterministicAssetSnapshot } from "@tendnote/domain";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  DEMO_STALE_FRIDGE_SNAPSHOT,
  demoAssetEvidence,
  demoAssetGeneralActions,
  demoAssetLinks,
  demoAssetMemories,
  demoAssets,
  demoFridgeAssetId,
  demoGeneralActionAssets,
  demoHouseholdMemberships,
  demoHouseholdWorkspaces,
  demoMemberUserId,
} from "./demo-assets";
import {
  demoContactMethods,
  demoExtractionJobs,
  demoFollowups,
  demoInteractions,
  demoMemories,
  demoMessageDrafts,
  demoPeople,
  demoRelationshipContextEmbeddingJobs,
  demoRelationshipContextEmbeddings,
  demoSourceRecordPeople,
  demoSourceRecords,
  demoUnresolvedPersonMentions,
} from "./demo-data";
import { createAssetSnapshot } from "./queries/asset-snapshots/builder";
import { createDrizzleAssetSnapshotStore } from "./queries/asset-snapshots/drizzle-store";
import { createDrizzleAssetLinkStore } from "./queries/assets/drizzle-link-store";
import { createDrizzleAssetReviewLifecycleStore } from "./queries/assets/drizzle-store";
import { createDrizzleGeneralActionStore } from "./queries/general-actions/drizzle-store";
import { createDrizzleSourceRecordStore } from "./queries/source-records/drizzle-store";
import {
  assetEvidence,
  assetLinks,
  assetMemories,
  assetSnapshots,
  assets,
  contactMethods,
  extractionJobs,
  followups,
  generalActionAssets,
  generalActions,
  householdMemberships,
  householdWorkspaces,
  interactions,
  memories,
  messageDrafts,
  people,
  relationshipContextEmbeddingJobs,
  relationshipContextEmbeddings,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
  user,
} from "./schema";

const ownerUserId = "demo-user";

const demoUsers = [
  { id: ownerUserId, name: "Demo User", email: "demo@tendnote.local" },
  // The household co-member. Present so the demo world can hold records the owner is
  // not allowed to see — the only way a visibility boundary can be demonstrated at all.
  { id: demoMemberUserId, name: "Riley Chen", email: "riley@tendnote.local" },
];

type Db = ReturnType<typeof getDb>;

/**
 * The household a demo record belongs to, as a value the update path can always write.
 *
 * Scope and household travel together: re-seeding a row that names a shared scope must carry
 * its household across, or the update leaves it visible to nobody. Private fixtures simply
 * omit the field, and an `undefined` in an `onConflictDoUpdate` set is a no-op rather than a
 * clear - so absence is resolved to an explicit `null` here, once, instead of putting the
 * same branch inside every seeder that re-seeds a scoped row.
 */
function demoHouseholdId(record: { householdId?: string | null }): string | null {
  return record.householdId ?? null;
}

/**
 * Seeds the demo world, one bounded slice at a time.
 *
 * The slices are separate functions on purpose: a single seed() touching twenty tables was
 * one long function nobody could read, and each slice here can be read, reasoned about, and
 * grown on its own.
 */
async function seed() {
  const db = getDb();

  await seedUsers(db);
  // The household comes before every record that anchors to it: a `shared` or `household`
  // row without its household is visible to nobody, its own owner included.
  await seedHousehold(db);
  await seedPeopleWorld(db);
  await seedSourceRecordWorld(db);
  await seedExtractionWorld(db);
  await seedEngagementWorld(db);
  await seedEmbeddingWorld(db);
  await seedAssetRecords(db);
  await seedAssetActions(db);
  await seedStaleAssetSnapshot(db);
}

/**
 * Builds the fridge's snapshot cache for real, then rewrites its prose to a version that has
 * fallen behind the records (it names the filter cartridge the fridge used to take).
 *
 * The order is the whole trick. Freshness is a fingerprint of the *records*, so a snapshot row
 * invented from nothing would simply be rebuilt on the next read and the lie would evaporate
 * before anyone could be misled by it. Built first and overwritten second, the row keeps a
 * fingerprint that still matches — which is precisely the state a genuinely stale cache is in,
 * and the only state in which the question can be asked at all: when the summary and the records
 * disagree, which one does the answer come from? Snapshots are a rebuildable cache, never source
 * truth (#196), and this is the fixture that makes that claim falsifiable.
 *
 * Generation is pinned to the deterministic generator rather than the default: seeding must not
 * depend on a gateway credential, a network round trip, or a model's mood.
 */
async function seedStaleAssetSnapshot(db: Db) {
  const snapshots = createAssetSnapshot(
    {
      ...createDrizzleAssetReviewLifecycleStore(),
      ...createDrizzleAssetLinkStore(),
      getPerson: createDrizzleSourceRecordStore().getPerson,
      getGeneralAction: createDrizzleGeneralActionStore().getGeneralAction,
      getVisibleGeneralAction: createDrizzleGeneralActionStore().getVisibleGeneralAction,
      ...createDrizzleAssetSnapshotStore(),
    },
    { generator: generateDeterministicAssetSnapshot },
  );

  await snapshots.getAssetSnapshot({ callerUserId: ownerUserId, assetId: demoFridgeAssetId });

  await db
    .update(assetSnapshots)
    .set({ summary: DEMO_STALE_FRIDGE_SNAPSHOT, updatedAt: new Date() })
    .where(eq(assetSnapshots.assetId, demoFridgeAssetId));
}

/** The demo owner and the household co-member. */
async function seedUsers(db: Db) {
  for (const demoUser of demoUsers) {
    await db
      .insert(user)
      .values({ ...demoUser, emailVerified: true })
      .onConflictDoUpdate({
        target: user.id,
        set: {
          name: demoUser.name,
          email: demoUser.email,
          emailVerified: true,
          updatedAt: new Date(),
        },
      });
  }
}

/** The people the demo world knows, with their contact methods. */
async function seedPeopleWorld(db: Db) {
  for (const person of demoPeople) {
    await db
      .insert(people)
      .values(person)
      .onConflictDoUpdate({
        target: people.id,
        set: {
          displayName: person.displayName,
          firstName: person.firstName,
          lastName: person.lastName,
          birthday: person.birthday,
          relationshipType: person.relationshipType,
          closenessLevel: person.closenessLevel,
          profileBlurb: person.profileBlurb,
          source: person.source,
          updatedAt: new Date(),
        },
      });
  }

  for (const contactMethod of demoContactMethods) {
    await db
      .insert(contactMethods)
      .values(contactMethod)
      .onConflictDoUpdate({
        target: contactMethods.id,
        set: {
          personId: contactMethod.personId,
          type: contactMethod.type,
          value: contactMethod.value,
          isPrimary: contactMethod.isPrimary,
          source: contactMethod.source,
          updatedAt: new Date(),
        },
      });
  }
}

/** Logged context: source records, who they mention, and what is still unresolved. */
async function seedSourceRecordWorld(db: Db) {
  for (const sourceRecord of demoSourceRecords) {
    await db
      .insert(sourceRecords)
      .values(sourceRecord)
      .onConflictDoUpdate({
        target: sourceRecords.id,
        set: {
          ownerUserId: sourceRecord.ownerUserId,
          sourceType: sourceRecord.sourceType,
          content: sourceRecord.content,
          rawContent: sourceRecord.rawContent,
          retentionPolicy: sourceRecord.retentionPolicy,
          status: sourceRecord.status,
          confidence: sourceRecord.confidence,
          sensitivity: sourceRecord.sensitivity,
          scope: sourceRecord.scope,
          householdId: demoHouseholdId(sourceRecord),
          importance: sourceRecord.importance,
          metadataJson: sourceRecord.metadataJson,
          updatedAt: new Date(),
        },
      });
  }

  for (const sourceRecordPerson of demoSourceRecordPeople) {
    await db
      .insert(sourceRecordPeople)
      .values(sourceRecordPerson)
      .onConflictDoUpdate({
        target: sourceRecordPeople.id,
        set: {
          sourceRecordId: sourceRecordPerson.sourceRecordId,
          personId: sourceRecordPerson.personId,
          role: sourceRecordPerson.role,
        },
      });
  }

  for (const unresolvedPersonMention of demoUnresolvedPersonMentions) {
    await db
      .insert(unresolvedPersonMentions)
      .values(unresolvedPersonMention)
      .onConflictDoUpdate({
        target: unresolvedPersonMentions.id,
        set: {
          sourceRecordId: unresolvedPersonMention.sourceRecordId,
          mentionText: unresolvedPersonMention.mentionText,
          candidatePersonIds: unresolvedPersonMention.candidatePersonIds,
          status: unresolvedPersonMention.status,
          resolvedPersonId: unresolvedPersonMention.resolvedPersonId,
          resolvedAt: unresolvedPersonMention.resolvedAt,
        },
      });
  }
}

/** The extraction queue and the memories it produced. */
async function seedExtractionWorld(db: Db) {
  for (const extractionJob of demoExtractionJobs) {
    await db
      .insert(extractionJobs)
      .values(extractionJob)
      .onConflictDoUpdate({
        target: extractionJobs.id,
        set: {
          sourceRecordId: extractionJob.sourceRecordId,
          status: extractionJob.status,
          attempts: extractionJob.attempts,
          lastError: extractionJob.lastError,
          idempotencyKey: extractionJob.idempotencyKey,
          runAfter: extractionJob.runAfter,
          claimedAt: extractionJob.claimedAt,
          completedAt: extractionJob.completedAt,
          updatedAt: new Date(),
        },
      });
  }

  for (const memory of demoMemories) {
    await db
      .insert(memories)
      .values(memory)
      .onConflictDoUpdate({
        target: memories.id,
        set: {
          personId: memory.personId,
          ownerUserId: memory.ownerUserId,
          sourceRecordId: memory.sourceRecordId,
          memoryType: memory.memoryType,
          content: memory.content,
          status: memory.status,
          importance: memory.importance,
          sensitivity: memory.sensitivity,
          confidence: memory.confidence,
          scope: memory.scope,
          householdId: demoHouseholdId(memory),
          approvedAt: memory.approvedAt,
          dismissedAt: memory.dismissedAt,
          updatedAt: new Date(),
        },
      });
  }
}

/** Interactions, follow-ups, and drafts — the relationship engagement layer. */
async function seedEngagementWorld(db: Db) {
  for (const interaction of demoInteractions) {
    await db
      .insert(interactions)
      .values(interaction)
      .onConflictDoUpdate({
        target: interactions.id,
        set: {
          personId: interaction.personId,
          ownerUserId: interaction.ownerUserId,
          interactionType: interaction.interactionType,
          occurredAt: interaction.occurredAt,
          summary: interaction.summary,
          source: interaction.source,
          confidence: interaction.confidence,
          updatedAt: new Date(),
        },
      });
  }

  for (const followup of demoFollowups) {
    await db
      .insert(followups)
      .values(followup)
      .onConflictDoUpdate({
        target: followups.id,
        set: {
          personId: followup.personId,
          ownerUserId: followup.ownerUserId,
          reason: followup.reason,
          dueAt: followup.dueAt,
          status: followup.status,
          cadence: followup.cadence,
          lastPromptedAt: followup.lastPromptedAt,
          updatedAt: new Date(),
        },
      });
  }

  for (const messageDraft of demoMessageDrafts) {
    await db
      .insert(messageDrafts)
      .values(messageDraft)
      .onConflictDoUpdate({
        target: messageDrafts.id,
        set: {
          personId: messageDraft.personId,
          ownerUserId: messageDraft.ownerUserId,
          channel: messageDraft.channel,
          purpose: messageDraft.purpose,
          body: messageDraft.body,
          status: messageDraft.status,
          updatedAt: new Date(),
        },
      });
  }
}

/** Semantic retrieval: the embeddings and the jobs that wrote them. */
async function seedEmbeddingWorld(db: Db) {
  for (const embedding of demoRelationshipContextEmbeddings) {
    await db
      .insert(relationshipContextEmbeddings)
      .values(embedding)
      .onConflictDoUpdate({
        target: relationshipContextEmbeddings.id,
        set: {
          ownerUserId: embedding.ownerUserId,
          personId: embedding.personId,
          recordKind: embedding.recordKind,
          recordId: embedding.recordId,
          embedding: embedding.embedding,
          embeddingModel: embedding.embeddingModel,
          embeddingVersion: embedding.embeddingVersion,
          embeddingDimensions: embedding.embeddingDimensions,
          embeddedText: embedding.embeddedText,
          contentFingerprint: embedding.contentFingerprint,
          trustLevel: embedding.trustLevel,
          sensitivity: embedding.sensitivity,
          sourceUpdatedAt: embedding.sourceUpdatedAt,
          updatedAt: new Date(),
        },
      });
  }

  for (const embeddingJob of demoRelationshipContextEmbeddingJobs) {
    await db
      .insert(relationshipContextEmbeddingJobs)
      .values(embeddingJob)
      .onConflictDoUpdate({
        target: relationshipContextEmbeddingJobs.id,
        set: {
          ownerUserId: embeddingJob.ownerUserId,
          recordKind: embeddingJob.recordKind,
          recordId: embeddingJob.recordId,
          status: embeddingJob.status,
          attempts: embeddingJob.attempts,
          lastError: embeddingJob.lastError,
          idempotencyKey: embeddingJob.idempotencyKey,
          runAfter: embeddingJob.runAfter,
          claimedAt: embeddingJob.claimedAt,
          completedAt: embeddingJob.completedAt,
          updatedAt: new Date(),
        },
      });
  }
}

/**
 * The one household the demo world has, and its co-member. Defined alongside the Phase 6
 * Asset world (`demo-assets.ts`) because that is where it first earned its keep, but it
 * anchors every non-private record in the demo - the shared Dana contact note and memory
 * as much as the fridge - so it is seeded ahead of all of them.
 */
async function seedHousehold(db: Db) {
  for (const household of demoHouseholdWorkspaces) {
    await db
      .insert(householdWorkspaces)
      .values(household)
      .onConflictDoUpdate({
        target: householdWorkspaces.id,
        set: { ...household, updatedAt: new Date() },
      });
  }

  for (const membership of demoHouseholdMemberships) {
    await db
      .insert(householdMemberships)
      .values(membership)
      .onConflictDoUpdate({
        target: householdMemberships.id,
        set: { ...membership, updatedAt: new Date() },
      });
  }
}

/** The Assets themselves, and the child records that hang under them. */
async function seedAssetRecords(db: Db) {
  for (const asset of demoAssets) {
    await db
      .insert(assets)
      .values(asset)
      .onConflictDoUpdate({ target: assets.id, set: { ...asset, updatedAt: new Date() } });
  }

  for (const memory of demoAssetMemories) {
    await db
      .insert(assetMemories)
      .values(memory)
      .onConflictDoUpdate({
        target: assetMemories.id,
        set: { ...memory, updatedAt: new Date() },
      });
  }

  for (const evidence of demoAssetEvidence) {
    await db
      .insert(assetEvidence)
      .values(evidence)
      .onConflictDoUpdate({
        target: assetEvidence.id,
        set: { ...evidence, updatedAt: new Date() },
      });
  }
}

/** Related Asset Links, and the General Actions an Asset's details produced. */
async function seedAssetActions(db: Db) {
  for (const link of demoAssetLinks) {
    await db
      .insert(assetLinks)
      .values(link)
      .onConflictDoUpdate({ target: assetLinks.id, set: { ...link, updatedAt: new Date() } });
  }

  for (const action of demoAssetGeneralActions) {
    await db
      .insert(generalActions)
      .values(action)
      .onConflictDoUpdate({
        target: generalActions.id,
        set: { ...action, updatedAt: new Date() },
      });
  }

  for (const link of demoGeneralActionAssets) {
    await db
      .insert(generalActionAssets)
      .values(link)
      .onConflictDoUpdate({ target: generalActionAssets.id, set: link });
  }
}

seed()
  .then(async () => {
    await closeDb();
    console.log("Seeded Tendnote demo data.");
  })
  .catch(async (error) => {
    await closeDb();
    console.error(error);
    process.exit(1);
  });
