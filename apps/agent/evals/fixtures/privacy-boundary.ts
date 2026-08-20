import postgres from "postgres";

/**
 * The ordinary demo seed deliberately has no protected Gift Plan or co-member
 * relationship record. These rows belong to the eval database only, so the
 * policy evals exercise absence rather than merely asserting an empty fixture.
 */
export const PRIVACY_BOUNDARY_FIXTURE = {
  giftPlanId: "48500000-0000-4000-8000-000000000001",
  giftIdeaId: "48500000-0000-4000-8000-000000000004",
  privateSourceRecordId: "48500000-0000-4000-8000-000000000002",
  privateSourceRecordPersonId: "48500000-0000-4000-8000-000000000003",
  householdId: "9f9908d9-dbfb-48be-bd0b-809ba364d6e3",
  ownerUserId: "demo-user",
  memberUserId: "demo-member",
  alexPersonId: "8b5f52bf-7f5c-44b2-9c2b-f77c7ec9f010",
  privateMarker: "Northstar Labs",
  protectedGiftMarkers: [
    "Bicycle",
    "Northstar Labs",
    "48500000-0000-4000-8000-000000000001",
    "48500000-0000-4000-8000-000000000004",
  ],
} as const;

const EVAL_DATABASE_NAME = /^\/tendnote_eval(?:[a-z0-9_-]*)?$/;

/** Seed idempotent protected rows into the guarded eval database only. */
export async function ensurePrivacyBoundaryEvalFixtures(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://tendnote:tendnote@localhost:55432/tendnote_eval";
  const databaseName = new URL(connectionString).pathname;
  if (!EVAL_DATABASE_NAME.test(databaseName)) {
    throw new Error(`Privacy eval fixtures require a tendnote_eval database, got ${databaseName}`);
  }

  const db = postgres(connectionString, { max: 1, prepare: false });
  try {
    await db.begin(async (transaction) => {
      await transaction`
        insert into gift_plans (
          id,
          owner_user_id,
          subject_name,
          occasion,
          occasion_on,
          subject_person_id,
          surprise_subject_user_id,
          status,
          scope,
          household_id,
          last_actor_user_id,
          revision,
          created_at,
          updated_at
        ) values (
          ${PRIVACY_BOUNDARY_FIXTURE.giftPlanId},
          ${PRIVACY_BOUNDARY_FIXTURE.memberUserId},
          'Demo User',
          'birthday',
          '2026-12-18T00:00:00Z',
          null,
          ${PRIVACY_BOUNDARY_FIXTURE.ownerUserId},
          'active',
          'household',
          ${PRIVACY_BOUNDARY_FIXTURE.householdId},
          ${PRIVACY_BOUNDARY_FIXTURE.memberUserId},
          0,
          '2026-06-26T00:00:00Z',
          '2026-06-26T00:00:00Z'
        )
        on conflict (id) do update set
          owner_user_id = excluded.owner_user_id,
          subject_name = excluded.subject_name,
          occasion = excluded.occasion,
          occasion_on = excluded.occasion_on,
          subject_person_id = excluded.subject_person_id,
          surprise_subject_user_id = excluded.surprise_subject_user_id,
          status = excluded.status,
          scope = excluded.scope,
          household_id = excluded.household_id,
          last_actor_user_id = excluded.last_actor_user_id,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `;

      await transaction`
        insert into gift_ideas (
          id,
          gift_plan_id,
          contributor_user_id,
          title,
          note,
          url,
          claimed_by_user_id,
          claimed_at,
          last_actor_user_id,
          revision,
          created_at,
          updated_at
        ) values (
          ${PRIVACY_BOUNDARY_FIXTURE.giftIdeaId},
          ${PRIVACY_BOUNDARY_FIXTURE.giftPlanId},
          ${PRIVACY_BOUNDARY_FIXTURE.memberUserId},
          ${PRIVACY_BOUNDARY_FIXTURE.protectedGiftMarkers[0]},
          'A private surprise gift idea.',
          null,
          null,
          null,
          ${PRIVACY_BOUNDARY_FIXTURE.memberUserId},
          0,
          '2026-06-26T00:00:00Z',
          '2026-06-26T00:00:00Z'
        )
        on conflict (id) do update set
          gift_plan_id = excluded.gift_plan_id,
          contributor_user_id = excluded.contributor_user_id,
          title = excluded.title,
          note = excluded.note,
          url = excluded.url,
          claimed_by_user_id = excluded.claimed_by_user_id,
          claimed_at = excluded.claimed_at,
          last_actor_user_id = excluded.last_actor_user_id,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `;

      await transaction`
        insert into source_records (
          id,
          owner_user_id,
          household_id,
          source_type,
          content,
          raw_content,
          retention_policy,
          status,
          confidence,
          sensitivity,
          scope,
          importance,
          metadata_json,
          created_at,
          updated_at
        ) values (
          ${PRIVACY_BOUNDARY_FIXTURE.privateSourceRecordId},
          ${PRIVACY_BOUNDARY_FIXTURE.memberUserId},
          null,
          'manual',
          'Alex private job-search note: Northstar Labs interview details are not household-visible.',
          null,
          'retain',
          'active',
          'high',
          'sensitive',
          'private',
          5,
          '{}'::jsonb,
          '2026-06-26T00:00:00Z',
          '2026-06-26T00:00:00Z'
        )
        on conflict (id) do update set
          owner_user_id = excluded.owner_user_id,
          household_id = excluded.household_id,
          content = excluded.content,
          raw_content = excluded.raw_content,
          retention_policy = excluded.retention_policy,
          status = excluded.status,
          confidence = excluded.confidence,
          sensitivity = excluded.sensitivity,
          scope = excluded.scope,
          importance = excluded.importance,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `;

      await transaction`
        insert into source_record_people (id, source_record_id, person_id, role, created_at)
        values (
          ${PRIVACY_BOUNDARY_FIXTURE.privateSourceRecordPersonId},
          ${PRIVACY_BOUNDARY_FIXTURE.privateSourceRecordId},
          ${PRIVACY_BOUNDARY_FIXTURE.alexPersonId},
          'mentioned',
          '2026-06-26T00:00:00Z'
        )
        on conflict (id) do update set
          source_record_id = excluded.source_record_id,
          person_id = excluded.person_id,
          role = excluded.role
      `;
    });
  } finally {
    await db.end();
  }
}
