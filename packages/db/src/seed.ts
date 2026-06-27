import { closeDb, getDb } from "./client";
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
import {
  contactMethods,
  extractionJobs,
  followups,
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

async function seed() {
  const db = getDb();

  await db
    .insert(user)
    .values({
      id: ownerUserId,
      name: "Demo User",
      email: "demo@tendnote.local",
      emailVerified: true,
    })
    .onConflictDoUpdate({
      target: user.id,
      set: {
        name: "Demo User",
        email: "demo@tendnote.local",
        emailVerified: true,
        updatedAt: new Date(),
      },
    });

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
          approvedAt: memory.approvedAt,
          dismissedAt: memory.dismissedAt,
          updatedAt: new Date(),
        },
      });
  }

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
