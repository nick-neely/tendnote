import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../schema";
import { accessProfiles, generalActions, memories, people, sourceRecords, user } from "../schema";
import {
  FIXTURE_NOW,
  FIXTURE_OWNERS,
  type FixtureOwner,
  instantAdminDatabaseUrl,
  instantDatabaseName,
  instantDatabaseUrl,
} from "./fixture-data";

/**
 * Seeds the deterministic fixture for the Instant Interaction browser matrix
 * (#310, ADR 0210) into a dedicated database.
 *
 * The rig is a real production build reading a real database, so the fixture has
 * to be real rows — but it must also be exactly the same rows every run. Both
 * owners are deleted first (every product table cascades from `user`), then
 * re-inserted from literals, so a previous run's mutations, or a half-finished
 * one, cannot leak into the next.
 */

async function ensureDatabaseExists() {
  const name = instantDatabaseName();
  const admin = postgres(instantAdminDatabaseUrl(), { max: 1, prepare: false });

  try {
    const existing = await admin`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) {
      await admin.unsafe(`create database "${name}"`);
    }
  } finally {
    await admin.end();
  }
}

function ownerRows(owner: FixtureOwner) {
  return {
    user: {
      id: owner.userId,
      name: owner.name,
      email: owner.email,
      emailVerified: true,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
    // Persisted admission is authoritative and short-circuits Private Beta
    // Access evaluation, so the rig never reaches the Vercel Flags adapter and
    // needs no network. `manual_grant` rather than either singleton bootstrap
    // source because both owners must be admitted.
    accessProfile: {
      userId: owner.userId,
      status: "granted" as const,
      source: "manual_grant" as const,
      grantedAt: FIXTURE_NOW,
      selfContextOnboardingStatus: "completed" as const,
      selfContextOnboardingReminderAt: null,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
    people: owner.people.map((person) => ({
      id: person.id,
      ownerUserId: owner.userId,
      displayName: person.displayName,
      relationshipType: person.relationshipType,
      closenessLevel: person.closenessLevel,
      profileBlurb: person.profileBlurb,
      source: "manual" as const,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    })),
    actions: owner.actions.map((action) => ({
      id: action.id,
      ownerUserId: owner.userId,
      title: action.title,
      notes: action.notes,
      status: action.status,
      dueAt: action.dueAt,
      completedAt: action.completedAt,
      createdByUserId: owner.userId,
      lastActorUserId: owner.userId,
      scope: "private" as const,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    })),
    sourceRecord: {
      id: owner.review.sourceRecordId,
      ownerUserId: owner.userId,
      sourceType: "manual" as const,
      content: owner.review.sourceContent,
      status: "active" as const,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
    memory: {
      id: owner.review.memoryId,
      ownerUserId: owner.userId,
      personId: owner.review.personId,
      sourceRecordId: owner.review.sourceRecordId,
      memoryType: "context" as const,
      content: owner.review.memoryContent,
      // Suggested, not approved: the Review destination exists to show proposals
      // awaiting the owner, and an approved memory would leave it empty again.
      status: "suggested" as const,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
  };
}

async function seedInstantFixture() {
  // `instantDatabaseName` is the guard: it refuses any name that is not
  // recognisably the rig's own, and the seed deletes rows.
  const databaseUrl = instantDatabaseUrl();
  await ensureDatabaseExists();

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });

  try {
    await migrate(db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });

    const ownerIds = FIXTURE_OWNERS.map((owner) => owner.userId);
    // Every owner-scoped product table references `user` with `on delete
    // cascade`, so one delete restores both owners to empty.
    await db.delete(user).where(inArray(user.id, ownerIds));

    for (const owner of FIXTURE_OWNERS) {
      const rows = ownerRows(owner);
      await db.insert(user).values(rows.user);
      await db.insert(accessProfiles).values(rows.accessProfile);
      await db.insert(people).values(rows.people);
      await db.insert(generalActions).values(rows.actions);
      await db.insert(sourceRecords).values(rows.sourceRecord);
      await db.insert(memories).values(rows.memory);
    }
  } finally {
    await client.end();
  }

  return { databaseUrl, owners: FIXTURE_OWNERS.length };
}

seedInstantFixture()
  .then((result) => {
    console.log(`Seeded ${result.owners} Instant matrix owners into ${result.databaseUrl}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
