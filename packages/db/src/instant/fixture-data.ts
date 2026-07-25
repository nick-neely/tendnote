/**
 * The deterministic fixture for the Instant Interaction matrix (ADR 0210).
 *
 * One bounded primary owner with representative records, plus a second owner
 * that exists only to prove isolation. Every identifier is a literal, every
 * timestamp derives from one frozen instant, and every count is fixed — so an
 * assertion means the same thing on any machine, on any day, in any order. No
 * production data, provider credentials, Eve model calls, or outbound network
 * participate.
 *
 * ## Reads and writes do not share a record
 *
 * The matrix runs fully parallel, and the mutation scenario runs once per
 * browser project. If the record it completes were also a marker some navigation
 * row asserts, the suite would be racing itself: one worker's Action leaves the
 * list while another worker is measuring a destination that expects it. So the
 * fixture separates them by construction — {@link NAVIGATION_ACTION} is asserted
 * and never written, and each worker slot mutates a private Action of its own
 * via {@link mutationActionFor}. Those are deliberately unscheduled, which keeps
 * them out of the Today shortlist and therefore out of every navigation marker.
 */

/**
 * The frozen clock. Fixture records sit safely in the past relative to any run,
 * so what the product derives from the real request clock (overdue, "today")
 * cannot change the counts a test asserts.
 */
export const FIXTURE_NOW = new Date("2026-06-24T12:00:00.000Z");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A fixed instant expressed as an offset from {@link FIXTURE_NOW}. */
function at(offsetDays: number): Date {
  return new Date(FIXTURE_NOW.getTime() + offsetDays * DAY);
}

export type FixturePerson = {
  id: string;
  displayName: string;
  relationshipType: "family" | "friend" | "professional" | "other";
  closenessLevel: number;
  profileBlurb: string;
};

export type FixtureAction = {
  id: string;
  title: string;
  notes: string;
  status: "open" | "completed";
  dueAt: Date | null;
  completedAt: Date | null;
};

/**
 * One captured note plus the memory it proposes. Review is an empty composition
 * without it, and an empty destination cannot prove that streamed content
 * reached authoritative state.
 */
export type FixtureReviewItem = {
  sourceRecordId: string;
  sourceContent: string;
  memoryId: string;
  memoryContent: string;
  /** The person the proposed memory is about. */
  personId: string;
};

export type FixtureOwner = {
  userId: string;
  email: string;
  name: string;
  people: FixturePerson[];
  actions: FixtureAction[];
  review: FixtureReviewItem;
};

/**
 * One private Action per concurrent worker slot.
 *
 * Keyed on Playwright's `parallelIndex` rather than on the project, because a
 * project is not the unit of concurrency: `--repeat-each`, retries, and multiple
 * projects all share the same worker pool. What Playwright does guarantee is
 * that every *simultaneously running* worker has a distinct `parallelIndex`, so
 * indexing on it makes the complete-and-reopen scenario exclusive on its record
 * under any parallelism — including a worker that reuses a slot after the
 * previous test in it finished and restored the record.
 *
 * Unscheduled on purpose: an Action with no due date never enters the Today
 * shortlist, so none of these can reach a navigation marker.
 */
const MUTATION_ACTIONS: FixtureAction[] = [
  {
    id: "2c2e5b4f-0000-4000-8000-000000000101",
    title: "Replace the water filter",
    notes: "Cartridge is under the sink.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
  {
    id: "2c2e5b4f-0000-4000-8000-000000000102",
    title: "Replace the furnace filter",
    notes: "Sized for the hall unit.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
  {
    id: "2c2e5b4f-0000-4000-8000-000000000103",
    title: "Replace the vacuum bag",
    notes: "Spare pack is in the cupboard.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
  {
    id: "2c2e5b4f-0000-4000-8000-000000000104",
    title: "Descale the kettle",
    notes: "Half a cup of vinegar is enough.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
  {
    id: "2c2e5b4f-0000-4000-8000-000000000105",
    title: "Rotate the mattress",
    notes: "End to end, then flip.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
  {
    id: "2c2e5b4f-0000-4000-8000-000000000106",
    title: "Clean the gutter guard",
    notes: "Ladder is in the shed.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
  {
    id: "2c2e5b4f-0000-4000-8000-000000000107",
    title: "Service the smoke alarms",
    notes: "Test button, then new batteries.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
  {
    id: "2c2e5b4f-0000-4000-8000-000000000108",
    title: "Sharpen the kitchen knives",
    notes: "Whetstone lives in the drawer.",
    status: "open",
    dueAt: null,
    completedAt: null,
  },
];

/**
 * The private Action this worker slot completes and reopens.
 *
 * Throws rather than wrapping around: sharing a record between two live workers
 * is the exact failure this indexing exists to prevent, and a suite that quietly
 * did it would fail somewhere else entirely.
 */
export function mutationActionFor(parallelIndex: number): FixtureAction {
  const action = MUTATION_ACTIONS[parallelIndex];
  if (!action) {
    throw new Error(
      `The Instant fixture seeds ${MUTATION_ACTIONS.length} private Actions but Playwright is running worker slot ${parallelIndex}. ` +
        "Add another entry to MUTATION_ACTIONS or lower --workers — sharing one would make the suite race itself.",
    );
  }
  return action;
}

/**
 * The owner every navigation and mutation scenario runs as. Bounded on purpose:
 * four people and four actions are enough to render a real list, a real detail
 * page, and a real Resolved disclosure, and few enough that the whole fixture
 * seeds in one round trip.
 */
export const PRIMARY_OWNER: FixtureOwner = {
  userId: "instant-primary-owner",
  email: "primary@instant.tendnote.test",
  name: "Instant Primary",
  people: [
    {
      id: "1b1d4a3e-0000-4000-8000-000000000001",
      displayName: "Alex Morgan",
      relationshipType: "friend",
      closenessLevel: 2,
      profileBlurb: "Runs the Tuesday climbing group.",
    },
    {
      id: "1b1d4a3e-0000-4000-8000-000000000002",
      displayName: "Brooke Nakamura",
      relationshipType: "professional",
      closenessLevel: 3,
      profileBlurb: "Former teammate, now at a design studio.",
    },
    {
      id: "1b1d4a3e-0000-4000-8000-000000000003",
      displayName: "Casey Lindqvist",
      relationshipType: "family",
      closenessLevel: 1,
      profileBlurb: "Cousin on the coast.",
    },
    {
      id: "1b1d4a3e-0000-4000-8000-000000000004",
      displayName: "Devon Okafor",
      relationshipType: "other",
      closenessLevel: 4,
      profileBlurb: "Met at the neighbourhood repair café.",
    },
  ],
  actions: [
    // Read-only. The most overdue Action, so its place at the head of the Today
    // shortlist is fixed rather than dependent on what else is open.
    {
      id: "2c2e5b4f-0000-4000-8000-000000000002",
      title: "Renew the library card",
      notes: "Expires at the end of the quarter.",
      status: "open",
      dueAt: at(-5),
      completedAt: null,
    },
    {
      id: "2c2e5b4f-0000-4000-8000-000000000003",
      title: "Book the annual service",
      notes: "Same garage as last year.",
      status: "open",
      dueAt: null,
      completedAt: null,
    },
    // Gives the Resolved disclosure something to hold before any scenario runs.
    {
      id: "2c2e5b4f-0000-4000-8000-000000000004",
      title: "File the warranty paperwork",
      notes: "Scanned copy is in the drawer.",
      status: "completed",
      dueAt: at(-9),
      completedAt: at(-8),
    },
    ...MUTATION_ACTIONS,
  ],
  review: {
    sourceRecordId: "5f51806a-0000-4000-8000-000000000001",
    sourceContent: "Alex mentioned the climbing group moved to Tuesday evenings.",
    memoryId: "6062917b-0000-4000-8000-000000000001",
    memoryContent: "Climbing group meets Tuesday evenings.",
    personId: "1b1d4a3e-0000-4000-8000-000000000001",
  },
};

/**
 * The isolation owner. It exists to prove that a warm cache keyed by verified
 * identity cannot hand one owner another owner's records, so its data is
 * deliberately disjoint from — and recognisably different to — the primary
 * owner's.
 */
export const ISOLATION_OWNER: FixtureOwner = {
  userId: "instant-isolation-owner",
  email: "isolation@instant.tendnote.test",
  name: "Instant Isolation",
  people: [
    {
      id: "3d3f6c50-0000-4000-8000-000000000001",
      displayName: "Rowan Petrov",
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: "Belongs to the second owner only.",
    },
  ],
  actions: [
    {
      id: "4e407d61-0000-4000-8000-000000000001",
      title: "Return the borrowed ladder",
      notes: "Belongs to the second owner only.",
      status: "open",
      dueAt: at(-1),
      completedAt: null,
    },
  ],
  review: {
    sourceRecordId: "7173a28c-0000-4000-8000-000000000001",
    sourceContent: "Rowan is planning a move in the autumn.",
    memoryId: "8284b39d-0000-4000-8000-000000000001",
    memoryContent: "Planning a move in the autumn.",
    personId: "3d3f6c50-0000-4000-8000-000000000001",
  },
};

export const FIXTURE_OWNERS = [PRIMARY_OWNER, ISOLATION_OWNER];

/**
 * The one record each scenario is written against. Resolved by identity rather
 * than by index so a later fixture edit that reorders the arrays fails loudly
 * here instead of quietly retargeting the whole matrix.
 */
function requirePerson(owner: FixtureOwner, displayName: string): FixturePerson {
  const person = owner.people.find((candidate) => candidate.displayName === displayName);
  if (!person) throw new Error(`Instant fixture is missing the person "${displayName}".`);
  return person;
}

function requireAction(owner: FixtureOwner, title: string): FixtureAction {
  const action = owner.actions.find((candidate) => candidate.title === title);
  if (!action) throw new Error(`Instant fixture is missing the action "${title}".`);
  return action;
}

/** The person whose detail page the matrix navigates to. */
export const PRIMARY_PERSON = requirePerson(PRIMARY_OWNER, "Alex Morgan");

/**
 * The Action navigation markers assert. Never written by any scenario — see the
 * module comment.
 */
export const NAVIGATION_ACTION = requireAction(PRIMARY_OWNER, "Renew the library card");

/** The isolation owner's person, which the primary owner must never see. */
export const ISOLATION_PERSON = requirePerson(ISOLATION_OWNER, "Rowan Petrov");

/**
 * A route whose owner data must vanish when the instant-navigation lock is on,
 * and the owner text that proves it, used by the harness's lock proof.
 */
export const LOCK_PROOF_PATH = "/people";
export const LOCK_PROOF_OWNER_TEXT = PRIMARY_PERSON.displayName;

/**
 * Where the fixture lives, resolved identically by the seeder and by the rig
 * that launches the measured server.
 *
 * One resolver rather than two: if the server read a different database than was
 * seeded, the failure would look like missing owner data rather than a
 * misconfigured URL, and the two derivations had already started to drift.
 */

const DEFAULT_ADMIN_URL = "postgres://tendnote:tendnote@localhost:55432/tendnote";
const DEFAULT_DATABASE_NAME = "tendnote_instant";

/**
 * The fixture database name must be recognisably the rig's own. The seed deletes
 * rows, and a mistyped `DATABASE_URL` must not be able to point that at a
 * developer's working data.
 */
export const INSTANT_DATABASE_NAME_PATTERN = /^tendnote_instant[a-z0-9_-]*$/;

export function instantDatabaseName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.TENDNOTE_INSTANT_DATABASE_NAME ?? DEFAULT_DATABASE_NAME;
  if (!INSTANT_DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Refusing to use "${name}" as the Instant matrix fixture database. Use a name beginning with tendnote_instant.`,
    );
  }
  return name;
}

function withPath(url: string, path: string): string {
  const parsed = new URL(url);
  parsed.pathname = path;
  return parsed.toString();
}

/**
 * The maintenance connection used to create the fixture database. A database
 * cannot create itself, and a runner may already point `DATABASE_URL` at the
 * fixture, so this always normalises back to `postgres`.
 */
export function instantAdminDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.TENDNOTE_INSTANT_ADMIN_DATABASE_URL;
  if (explicit) return explicit;
  return withPath(env.DATABASE_URL ?? DEFAULT_ADMIN_URL, "/postgres");
}

export function instantDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.TENDNOTE_INSTANT_DATABASE_URL;
  if (explicit) return explicit;
  return withPath(instantAdminDatabaseUrl(env), `/${instantDatabaseName(env)}`);
}
