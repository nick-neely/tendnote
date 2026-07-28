import { listPersonEmailContactMethods } from "@tendnote/db/queries/contact-methods";
import { getPersonContextSnapshot } from "@tendnote/db/queries/context-snapshots";
import { listDraftsForPerson } from "@tendnote/db/queries/drafts";
import {
  listFollowupsForPerson,
  listSuggestedFollowupReviews,
} from "@tendnote/db/queries/followups";
import { listGmailDraftActionsForDraft } from "@tendnote/db/queries/gmail-drafts";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { listPersonMemoryContext, listSuggestedMemoryReviews } from "@tendnote/db/queries/memories";
import { getPerson, getPersonProfile } from "@tendnote/db/queries/people";
import { isProviderCapabilityConnected } from "@tendnote/db/queries/provider-connections";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import { listSourceRecordsForPersonContext } from "@tendnote/db/queries/source-records";
import {
  canUseMemoryProactively,
  canUseSourceRecordProactively,
  GMAIL_CAPABILITY_KEY,
  GMAIL_PROVIDER_KEY,
  isActiveFollowupStatus,
} from "@tendnote/domain";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdmittedRoute } from "@/components/admitted-route";
import { BirthdayFollowupOffer } from "@/components/birthday-followup-offer";
import { PersonCapture } from "@/components/person-capture";
import { PersonDetailTabs, type PersonTab } from "@/components/person-detail-tabs";
import { type GmailDraftContext, PersonDrafts } from "@/components/person-drafts";
import { PersonFollowups } from "@/components/person-followups";
import { PersonHeader } from "@/components/person-header";
import {
  LedgerEmpty,
  LoggedContextSection,
  MemoriesSection,
  PersonDetailsCard,
} from "@/components/person-ledger";
import { PersonRemove } from "@/components/person-remove";
import { RelationshipSnapshotCard } from "@/components/relationship-snapshot-card";
import { SuggestedFollowupReviewSection } from "@/components/suggested-followup-review";
import { SuggestedMemoryReviewSection } from "@/components/suggested-memory-review";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { appReturnTo } from "@/lib/auth/return-to";
import { getCachedPersonDetailCore } from "@/lib/cache/people-views";
import { shortName } from "@/lib/dashboard-brief";
import { type DraftView, toDraftView } from "@/lib/draft-view";
import { toDateInputValue, toFollowupView } from "@/lib/followup-view";
import { latestGmailDraftView } from "@/lib/gmail-draft-view";
import {
  type RelationshipSnapshotView,
  toRelationshipSnapshotView,
} from "@/lib/relationship-snapshot-view";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";
import {
  type SuggestedFollowupReviewView,
  toSuggestedFollowupReviewView,
} from "@/lib/suggested-followup-review-view";
import {
  type SuggestedMemoryReviewView,
  toSuggestedMemoryReviewView,
} from "@/lib/suggested-memory-review-view";

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

/**
 * Load the inline Gmail externalization context for the drafts tab (Phase 2D,
 * ADR-0096): whether Gmail is connected, the person's saved email addresses for the
 * recipient picker, and each approved draft's last known Gmail state. Best-effort —
 * Gmail is enrichment on the draft card, so a failure never blocks the profile.
 */
async function loadGmailDraftContext(
  ownerUserId: string,
  personId: string,
  personName: string,
  drafts: DraftView[],
): Promise<GmailDraftContext> {
  const empty: GmailDraftContext = {
    connected: false,
    personName,
    personEmails: [],
    byDraftId: {},
  };
  try {
    // Only approved drafts can be externalized, so only they need Gmail state.
    const approved = drafts.filter((draft) => draft.status === "approved");
    const [connected, personEmails, actionLists] = await Promise.all([
      isProviderCapabilityConnected({
        ownerUserId,
        providerKey: GMAIL_PROVIDER_KEY,
        capabilityKey: GMAIL_CAPABILITY_KEY,
      }),
      listPersonEmailContactMethods({ ownerUserId, personId }),
      Promise.all(
        approved.map((draft) =>
          listGmailDraftActionsForDraft({ ownerUserId, messageDraftId: draft.id }),
        ),
      ),
    ]);
    const byDraftId: GmailDraftContext["byDraftId"] = {};
    approved.forEach((draft, index) => {
      byDraftId[draft.id] = latestGmailDraftView(actionLists[index] ?? []);
    });
    return { connected, personName, personEmails, byDraftId };
  } catch {
    return empty;
  }
}

/**
 * Loads the profile's relationship snapshot and trust-aware context through the
 * single shared snapshot-backed read path (PRD #11). If the optional store is
 * unavailable, the card steps aside without delaying the selected pane.
 */
async function loadProfileContext(
  ownerUserId: string,
  personId: string,
): Promise<RelationshipSnapshotView | null> {
  try {
    const result = await getPersonContextSnapshot({ ownerUserId, personId });

    if (result.context.person) {
      return toRelationshipSnapshotView(result);
    }
  } catch {
    // Fall through to the policy-filtered profile data below.
  }

  return null;
}

// fallow-ignore-next-line complexity -- The server page composes the complete owner-scoped profile read model.
type PersonDetailPageProps = {
  params: Promise<{ personId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type AdmittedPersonRequest = {
  ownerUserId: string;
  personId: string;
};

function selectedPersonTab(query: Record<string, string | string[] | undefined>): PersonTab {
  const tab = query.tab;
  return typeof tab === "string" &&
    ["snapshot", "review", "memory", "followups", "drafts"].includes(tab)
    ? (tab as PersonTab)
    : "memory";
}

export default function PersonDetailPage(props: PersonDetailPageProps) {
  return (
    <AdmittedRoute destination="person">
      <PersonDetailContent {...props} />
    </AdmittedRoute>
  );
}

async function PersonDetailContent({ params, searchParams }: PersonDetailPageProps) {
  if (process.env.NODE_ENV !== "test") await connection();
  const [{ personId }, query] = await Promise.all([params, searchParams]);
  const ownerUserId = await requireAdmittedOwner({
    returnTo: appReturnTo(`/people/${encodeURIComponent(personId)}`, query),
  });
  const selectedTab = selectedPersonTab(query ?? {});
  const core = await getCachedPersonDetailCore({ ownerUserId, personId });
  if (!core) notFound();

  return (
    <>
      <div className="flex flex-col gap-4">
        <PersonHeader person={core.person} />
        <dl className="grid grid-cols-3 gap-3 rounded-xl border bg-surface p-4 text-center text-sm">
          <div>
            <dt className="text-muted-foreground">Memories</dt>
            <dd className="mt-1 font-medium">{core.counts.memories}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Follow-ups</dt>
            <dd className="mt-1 font-medium">{core.counts.followups}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Context</dt>
            <dd className="mt-1 font-medium">{core.counts.sourceRecords}</dd>
          </div>
        </dl>
      </div>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-xl border bg-muted/40" />}>
        <PersonDetailEnrichment request={{ ownerUserId, personId }} selectedTab={selectedTab} />
      </Suspense>
    </>
  );
}

async function PersonDetailEnrichment({
  request,
  selectedTab,
}: {
  request: AdmittedPersonRequest;
  selectedTab: PersonTab;
}) {
  const { ownerUserId, personId } = request;
  let person = await getPerson({ ownerUserId, personId });
  // Shared follow-ups can reveal the minimal person detail to a household
  // viewer. That exceptional visibility branch stays request-bound; owner
  // pages use the focused pane reads below.
  if (!person) {
    person = (await getPersonProfile({ ownerUserId, personId }))?.person ?? null;
  }
  if (!person) {
    notFound();
  }

  const [
    memoryContext,
    sourceRecords,
    snapshot,
    suggestedReviews,
    suggestedFollowupReviews,
    drafts,
    shareableMembers,
    reminderSchedules,
    followups,
  ] = await Promise.all([
    selectedTab === "memory" ? listPersonMemoryContext({ ownerUserId, personId }) : null,
    selectedTab === "memory" ? listSourceRecordsForPersonContext({ ownerUserId, personId }) : [],
    selectedTab === "snapshot" ? loadProfileContext(ownerUserId, personId) : null,
    selectedTab === "review" ? loadSuggestedReviews(ownerUserId, personId) : [],
    selectedTab === "followups" ? loadSuggestedFollowupReviews(ownerUserId, personId) : [],
    selectedTab === "drafts" ? loadDrafts(ownerUserId, personId) : [],
    selectedTab === "followups"
      ? listShareableHouseholdMembersForUser({ userId: ownerUserId })
      : [],
    selectedTab === "followups" ? listReminderSchedulesForOwner({ ownerUserId }) : [],
    selectedTab === "followups" ? listFollowupsForPerson({ ownerUserId, personId }) : [],
  ]);

  const approvedMemories = (memoryContext?.memories ?? []).filter((memory) =>
    canUseMemoryProactively(memory),
  );
  const trustedSourceRecords = sourceRecords.filter((sourceRecord) =>
    canUseSourceRecordProactively(sourceRecord),
  );
  const firstName = shortName(person);
  // Active reminders (open/snoozed) lead the section; recently resolved ones stay
  // reachable for reopen. Suggested follow-ups are never shown as active here —
  // they live in review surfaces until accepted (#47/#48).
  const now = new Date();
  const activeFollowups = followups
    .filter((followup) => isActiveFollowupStatus(followup.status))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((followup) => {
      const schedule = reminderSchedules.find(
        (candidate) => candidate.recordKind === "follow_up" && candidate.recordId === followup.id,
      );
      return toFollowupView(
        followup,
        now,
        schedule ? toReminderScheduleView(schedule) : null,
        ownerUserId,
      );
    });
  const resolvedFollowups = followups
    .filter((followup) => followup.status === "completed" || followup.status === "dismissed")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((followup) => toFollowupView(followup, now, null, ownerUserId));

  // Tab counts are server-derived and stay live because every section calls
  // router.refresh() on mutation: pending suggestions to review, things to act on
  // under follow-ups (active reminders + tentative proposals), and drafts not yet
  // marked sent. Confirmed memories and the snapshot don't carry a count.
  const reviewCount = suggestedReviews.length;
  const followupCount = activeFollowups.length + suggestedFollowupReviews.length;
  const draftsCount = drafts.filter((draft) => draft.status !== "sent_manually").length;
  return (
    <PersonDetailTabs
      aside={
        <>
          <PersonCapture
            firstName={firstName}
            personId={person.id}
            personName={person.displayName}
          />
          <PersonDetailsCard person={person} />
          <PersonRemove personId={person.id} personName={person.displayName} />
        </>
      }
      draftsCount={selectedTab === "drafts" ? draftsCount : 0}
      draftsPanel={
        selectedTab === "drafts" ? (
          <div className="flex flex-col gap-3">
            <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              Drafts for {firstName}. Nothing is sent until you send it yourself.
            </p>
            <Suspense
              fallback={<div className="h-28 animate-pulse rounded-xl border bg-muted/40" />}
            >
              <PersonDraftsPanel
                drafts={drafts}
                ownerUserId={ownerUserId}
                personId={person.id}
                personName={person.displayName}
              />
            </Suspense>
          </div>
        ) : null
      }
      followupCount={selectedTab === "followups" ? followupCount : 0}
      followupsPanel={
        selectedTab === "followups" ? (
          <div className="flex flex-col gap-3">
            <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              Reminders tied to {firstName}.
            </p>
            <SuggestedFollowupReviewSection initialReviews={suggestedFollowupReviews} />
            {person.birthday ? (
              <BirthdayFollowupOffer personId={person.id} personName={firstName} />
            ) : null}
            <PersonFollowups
              active={activeFollowups}
              defaultDueDate={toDateInputValue(now)}
              firstName={firstName}
              personId={person.id}
              resolved={resolvedFollowups}
              shareableMembers={shareableMembers}
            />
          </div>
        ) : null
      }
      hasSnapshot
      header={null}
      initialTab={selectedTab}
      memoryPanel={
        selectedTab === "memory" ? (
          <div className="flex flex-col gap-8">
            <MemoriesSection memories={approvedMemories} />
            <LoggedContextSection sourceRecords={trustedSourceRecords} />
          </div>
        ) : null
      }
      reviewCount={selectedTab === "review" ? reviewCount : 0}
      reviewPanel={
        selectedTab === "review" ? (
          <div className="flex flex-col gap-3">
            <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              Suggestions drawn from your notes. Nothing becomes a memory until you save it.
            </p>
            {suggestedReviews.length ? (
              <SuggestedMemoryReviewSection initialReviews={suggestedReviews} />
            ) : (
              <LedgerEmpty>Nothing waiting to review.</LedgerEmpty>
            )}
          </div>
        ) : null
      }
      snapshotPanel={
        selectedTab === "snapshot" && snapshot ? (
          <RelationshipSnapshotCard personName={person.displayName} view={snapshot} />
        ) : selectedTab === "snapshot" ? (
          <LedgerEmpty>No relationship snapshot yet.</LedgerEmpty>
        ) : null
      }
    />
  );
}

async function PersonDraftsPanel({
  drafts,
  ownerUserId,
  personId,
  personName,
}: {
  drafts: DraftView[];
  ownerUserId: string;
  personId: string;
  personName: string;
}) {
  const gmail = await loadGmailDraftContext(ownerUserId, personId, personName, drafts);
  return <PersonDrafts gmail={gmail} initialDrafts={drafts} personId={personId} />;
}
