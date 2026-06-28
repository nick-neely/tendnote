import { getPersonContextSnapshot } from "@tendnote/db/queries/context-snapshots";
import { listDraftsForPerson } from "@tendnote/db/queries/drafts";
import { listSuggestedFollowupReviews } from "@tendnote/db/queries/followups";
import { listSuggestedMemoryReviews } from "@tendnote/db/queries/memories";
import { getPersonProfile } from "@tendnote/db/queries/people";
import {
  canUseMemoryProactively,
  canUseSourceRecordProactively,
  isActiveFollowupStatus,
  type Memory,
  type SourceRecord,
} from "@tendnote/domain";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PersonCapture } from "@/components/person-capture";
import { PersonDrafts } from "@/components/person-drafts";
import { PersonFollowups } from "@/components/person-followups";
import { PersonHeader } from "@/components/person-header";
import {
  LedgerSection,
  LoggedContextSection,
  MemoriesSection,
  PersonDetailsCard,
} from "@/components/person-ledger";
import { RelationshipSnapshotCard } from "@/components/relationship-snapshot-card";
import { SuggestedFollowupReviewSection } from "@/components/suggested-followup-review";
import { SuggestedMemoryReviewSection } from "@/components/suggested-memory-review";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import { shortName } from "@/lib/dashboard-brief";
import { type DraftView, toDraftView } from "@/lib/draft-view";
import { toDateInputValue, toFollowupView } from "@/lib/followup-view";
import {
  type RelationshipSnapshotView,
  toRelationshipSnapshotView,
} from "@/lib/relationship-snapshot-view";
import {
  type SuggestedFollowupReviewView,
  toSuggestedFollowupReviewView,
} from "@/lib/suggested-followup-review-view";
import {
  type SuggestedMemoryReviewView,
  toSuggestedMemoryReviewView,
} from "@/lib/suggested-memory-review-view";

export const dynamic = "force-dynamic";

type PersonProfile = NonNullable<Awaited<ReturnType<typeof getPersonProfile>>>;

type TrustAwareContext = {
  approvedMemories: Memory[];
  sourceRecords: SourceRecord[];
};

async function loadSuggestedReviews(
  ownerUserId: string,
  personId: string,
): Promise<SuggestedMemoryReviewView[]> {
  try {
    const reviews = await listSuggestedMemoryReviews({ ownerUserId, personId });

    return reviews.map(toSuggestedMemoryReviewView);
  } catch {
    // Review is in-context enrichment; if the store is unavailable the rest of
    // the profile should still render.
    return [];
  }
}

async function loadSuggestedFollowupReviews(
  ownerUserId: string,
  personId: string,
): Promise<SuggestedFollowupReviewView[]> {
  try {
    const reviews = await listSuggestedFollowupReviews({ ownerUserId, personId });

    return reviews.map((review) => toSuggestedFollowupReviewView(review));
  } catch {
    // Tentative proposals are enrichment; never block the profile if unavailable.
    return [];
  }
}

async function loadDrafts(ownerUserId: string, personId: string): Promise<DraftView[]> {
  try {
    // Dismissed drafts stay out of the focused review surface; the user is shown
    // their active, approved, and sent-manually drafts (PRD user story #34/#35).
    const drafts = await listDraftsForPerson({
      ownerUserId,
      personId,
      statuses: ["draft", "approved", "sent_manually"],
    });

    return drafts.map(toDraftView);
  } catch {
    // Drafts are in-context enrichment; never block the profile if unavailable.
    return [];
  }
}

type ProfileContext = TrustAwareContext & {
  snapshot: RelationshipSnapshotView | null;
};

function fallbackContext(profile: PersonProfile): ProfileContext {
  return {
    snapshot: null,
    approvedMemories: profile.memories.filter((memory) => canUseMemoryProactively(memory)),
    sourceRecords: profile.sourceRecords.filter((sourceRecord) =>
      canUseSourceRecordProactively(sourceRecord),
    ),
  };
}

/**
 * Loads the profile's relationship snapshot and trust-aware context through the
 * single shared snapshot-backed read path (PRD #11), so the card and the
 * Memories/Logged-context sections agree and apply the same trust rules. If the
 * store is unavailable, it falls back to the profile data filtered
 * through the same domain policy helpers, and the card steps aside (ADR 0009).
 */
async function loadProfileContext(
  ownerUserId: string,
  personId: string,
  profile: PersonProfile,
): Promise<ProfileContext> {
  try {
    const result = await getPersonContextSnapshot({ ownerUserId, personId });

    if (result.context.person) {
      return {
        snapshot: toRelationshipSnapshotView(result),
        approvedMemories: result.context.approvedMemories,
        sourceRecords: result.context.sourceRecords,
      };
    }
  } catch {
    // Fall through to the policy-filtered profile data below.
  }

  return fallbackContext(profile);
}

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const ownerUserId = await getCurrentOwnerUserId();
  const [profile, suggestedReviews, suggestedFollowupReviews, drafts] = await Promise.all([
    getPersonProfile({ ownerUserId, personId }),
    loadSuggestedReviews(ownerUserId, personId),
    loadSuggestedFollowupReviews(ownerUserId, personId),
    loadDrafts(ownerUserId, personId),
  ]);

  if (!profile) {
    notFound();
  }

  const { snapshot, approvedMemories, sourceRecords } = await loadProfileContext(
    ownerUserId,
    personId,
    profile,
  );
  const { person } = profile;
  const firstName = shortName(person);

  // Active reminders (open/snoozed) lead the section; recently resolved ones stay
  // reachable for reopen. Suggested follow-ups are never shown as active here —
  // they live in review surfaces until accepted (#47/#48).
  const now = new Date();
  const activeFollowups = profile.followups
    .filter((followup) => isActiveFollowupStatus(followup.status))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((followup) => toFollowupView(followup, now));
  const resolvedFollowups = profile.followups
    .filter((followup) => followup.status === "completed" || followup.status === "dismissed")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((followup) => toFollowupView(followup, now));

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PersonHeader person={person} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
          <div className="flex min-w-0 flex-col gap-8">
            {snapshot ? (
              <RelationshipSnapshotCard personName={person.displayName} view={snapshot} />
            ) : null}

            {suggestedReviews.length ? (
              <LedgerSection
                description="Suggestions drawn from your notes. Save what's right, edit the wording, or dismiss the rest — nothing becomes a memory until you say so."
                id="needs-review"
                title="Needs review"
              >
                <SuggestedMemoryReviewSection initialReviews={suggestedReviews} />
              </LedgerSection>
            ) : null}

            <MemoriesSection memories={approvedMemories} />
            <LoggedContextSection sourceRecords={sourceRecords} />
            <LedgerSection
              description={`Reminders tied to ${firstName}.`}
              id="follow-ups"
              title="Follow-ups"
            >
              <SuggestedFollowupReviewSection initialReviews={suggestedFollowupReviews} />
              <PersonFollowups
                active={activeFollowups}
                defaultDueDate={toDateInputValue(now)}
                firstName={firstName}
                personId={person.id}
                resolved={resolvedFollowups}
              />
            </LedgerSection>

            <LedgerSection
              description={`Tendnote-only message drafts for ${firstName}. Review, edit, copy, or mark them sent — nothing leaves Tendnote.`}
              id="message-drafts"
              title="Message drafts"
            >
              <PersonDrafts initialDrafts={drafts} />
            </LedgerSection>
          </div>

          <aside className="flex flex-col gap-6 lg:sticky lg:top-20 lg:self-start">
            <PersonCapture
              firstName={firstName}
              personId={person.id}
              personName={person.displayName}
            />
            <PersonDetailsCard person={person} />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
