"use client";

import type { GiftPlanStatus } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { visibilityChoiceForScope } from "@tendnote/domain/privacy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  addGiftIdeaAction,
  claimGiftIdeaAction,
  editGiftIdeaAction,
  editGiftPlanAction,
  releaseGiftIdeaAction,
  removeGiftIdeaAction,
  setGiftPlanAudienceAction,
  setGiftPlanStatusAction,
  setGiftPlanSurpriseSubjectAction,
} from "@/app/actions/gift-plans";
import { ErrorText } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import { GiftPlanInlineForm } from "@/components/gift-plan-inline-form";
import {
  GIFT_PLAN_GENERIC_ERROR,
  GiftPlanAudienceChip,
  GiftPlanClosedNote,
  GiftPlanStatusChip,
  GiftPlanSurpriseChip,
  GiftPlanSurpriseNote,
  GiftPlanTimingChip,
} from "@/components/gift-plan-shared";
import { CheckIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VisibilityControl } from "@/components/visibility-affordance";
import type { GiftIdeaView, GiftPlanDetailView, GiftPlanView } from "@/lib/gift-plan-view";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

const NO_SURPRISE = "none";

export function GiftPlanDetailSurface({
  detail,
  shareableMembers = [],
}: {
  detail: GiftPlanDetailView;
  shareableMembers?: ShareableActionMember[];
}) {
  const router = useRouter();
  const { plan } = detail;
  // The server's copy leads: `router.refresh()` after an owner change re-runs the
  // seam, and a locally patched list would quietly outlive an audience that has
  // narrowed underneath it.
  const [ideas, setIdeas] = useServerSyncedList(
    detail.ideas,
    (idea) => idea.id,
    undefined,
    (idea) => String(idea.revision).padStart(12, "0"),
  );
  const [error, setError] = useState<string | null>(null);
  /**
   * Claiming and releasing change a fact other people are relying on, and the
   * change is a button swapping places. Sighted users see it; this is how anyone
   * else hears it. Polite, because nothing is urgent — the claim already landed.
   */
  const [announcement, setAnnouncement] = useState("");

  function refresh() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <GiftPlanHeading plan={plan} />
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
          {plan.occasion}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.timingLabel ? <GiftPlanTimingChip label={plan.timingLabel} /> : null}
          <GiftPlanStatusChip label={plan.statusLabel} />
          <GiftPlanAudienceChip plan={plan} />
          {plan.surprise ? <GiftPlanSurpriseChip /> : null}
        </div>
        {plan.surprise ? <GiftPlanSurpriseNote name={null} /> : null}
        {plan.owned ? <GiftPlanEditForm onSaved={refresh} plan={plan} /> : null}
      </header>

      {error ? <ErrorText message={error} /> : null}

      {/* One region for the whole list: a per-row live region would be created at
          the same moment it changed, and a region born with content in it does not
          reliably announce. */}
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[length:var(--text-h2)] font-semibold leading-[var(--text-h2-line)]">
            Ideas
          </h2>
          {ideas.length > 0 ? (
            <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              {ideas.filter((idea) => idea.claimedByLabel).length} of {ideas.length} claimed
            </p>
          ) : null}
        </div>

        {ideas.length === 0 ? (
          <EmptyState
            description={
              plan.acceptsCommitments
                ? plan.coPlannerCount > 0
                  ? "Add the first idea. Everyone planning with you can add their own and say which one they'll handle."
                  : "Add the first idea you want to remember."
                : "Nothing was added before this plan was put away."
            }
            size="compact"
            title="Nothing here yet"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {ideas.map((idea) => (
              <GiftIdeaRow
                acceptsCommitments={plan.acceptsCommitments}
                idea={idea}
                key={idea.id}
                onAnnounce={setAnnouncement}
                onChanged={(next) =>
                  setIdeas((current) =>
                    current.map((entry) => (entry.id === next.id ? next : entry)),
                  )
                }
                onRemoved={() =>
                  setIdeas((current) => current.filter((entry) => entry.id !== idea.id))
                }
              />
            ))}
          </ul>
        )}

        {plan.acceptsCommitments ? (
          <AddGiftIdeaForm
            giftPlanId={plan.id}
            onAdded={(idea) => setIdeas((current) => [...current, idea])}
            onError={setError}
          />
        ) : (
          <GiftPlanClosedNote reason={plan.closedReason ?? ""} />
        )}
      </section>

      {plan.owned ? (
        <GiftPlanOwnerControls members={shareableMembers} onChanged={refresh} plan={plan} />
      ) : null}

      {detail.history.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[length:var(--text-h2)] font-semibold leading-[var(--text-h2-line)]">
            Recent activity
          </h2>
          <ol className="flex flex-col gap-2">
            {detail.history.slice(0, 8).map((event) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[length:var(--text-small)] leading-[var(--text-small-line)]"
                key={event.id}
              >
                <span className="text-foreground">{event.summary}</span>
                <time
                  className="font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground"
                  dateTime={event.at}
                >
                  {new Date(event.at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The subject's name, and — for the owner only — the way back to the person.
 *
 * "Relationships, not records" is the product's first principle, and this is the
 * one place a Gift Plan touches it: the plan is *about* someone the owner already
 * keeps. The link is the owner's alone because the plan's link to a Person grants
 * a co-planner nothing; they would land on a page they may not be allowed to see.
 */
function GiftPlanHeading({ plan }: { plan: GiftPlanView }) {
  const heading =
    "text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal";
  if (!plan.owned || !plan.subjectPersonId) {
    return <h1 className={heading}>{plan.subjectName}</h1>;
  }
  return (
    <h1 className={heading}>
      <Link
        className="rounded-sm underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/people/${plan.subjectPersonId}`}
      >
        {plan.subjectName}
      </Link>
    </h1>
  );
}

/**
 * The owner's correction path for what the plan is about.
 *
 * It exists because the alternative was delete-and-recreate: a typo in a name
 * used to cost the plan its ideas, its claims, and its history. Optimistic
 * concurrency rides along — the revision the form was opened at is submitted with
 * it, so a change from another tab is reported rather than overwritten.
 */
function GiftPlanEditForm({ plan, onSaved }: { plan: GiftPlanView; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    subjectName: plan.subjectName,
    occasion: plan.occasion,
    occasionOn: plan.occasionOn ? plan.occasionOn.slice(0, 10) : "",
  });
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cleared once the writer has seen the conflict, so their next submit is the
  // deliberate replace the message offered them.
  const [replace, setReplace] = useState(false);

  return (
    <div className="flex flex-col gap-2 pt-1">
      <GiftPlanInlineForm
        onSubmit={async () => {
          setError(null);
          const result = await editGiftPlanAction({
            giftPlanId: plan.id,
            subjectName: draft.subjectName,
            occasion: draft.occasion,
            occasionOn: draft.occasionOn || null,
            ...(replace ? {} : { expectedRevision: plan.revision }),
          });
          if (result.ok) {
            setConflict(null);
            setReplace(false);
            onSaved();
            return true;
          }
          if (result.conflict) {
            setConflict(
              `${result.conflict.actorName ?? "Someone"} changed this to “${result.conflict.currentValue}”. Save again to replace it with yours.`,
            );
            setReplace(true);
            return false;
          }
          setError(result.error || GIFT_PLAN_GENERIC_ERROR);
          return false;
        }}
        pendingLabel="Saving…"
        submitLabel="Save details"
        triggerIcon={PencilIcon}
        triggerLabel="Edit details"
        triggerSize="sm"
        triggerVariant="ghost"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gift-plan-edit-subject">Who is it for?</Label>
            <Input
              autoComplete="off"
              id="gift-plan-edit-subject"
              onChange={(event) =>
                setDraft((current) => ({ ...current, subjectName: event.target.value }))
              }
              value={draft.subjectName}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gift-plan-edit-occasion">What's the occasion?</Label>
            <Input
              autoComplete="off"
              id="gift-plan-edit-occasion"
              onChange={(event) =>
                setDraft((current) => ({ ...current, occasion: event.target.value }))
              }
              value={draft.occasion}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:max-w-56">
          <Label htmlFor="gift-plan-edit-date">When is it? (optional)</Label>
          <Input
            id="gift-plan-edit-date"
            onChange={(event) =>
              setDraft((current) => ({ ...current, occasionOn: event.target.value }))
            }
            type="date"
            value={draft.occasionOn}
          />
        </div>
        {conflict ? <ErrorText message={conflict} /> : null}
        {error ? <ErrorText message={error} /> : null}
      </GiftPlanInlineForm>
    </div>
  );
}

/**
 * One idea, its contributor, and its claim.
 *
 * The claim is the row's only prominent control because it is the only one that
 * affects anyone else. Editing and removing belong to whoever wrote the idea and
 * sit quietly beside it — attribution is a fact about the plan, not a permission
 * the owner grants.
 */
function GiftIdeaRow({
  idea,
  acceptsCommitments,
  onChanged,
  onRemoved,
  onAnnounce,
}: {
  idea: GiftIdeaView;
  acceptsCommitments: boolean;
  onChanged: (idea: GiftIdeaView) => void;
  onRemoved: () => void;
  onAnnounce: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  /**
   * Row-local rather than page-level. A failed claim is about *this* idea, and a
   * banner at the top of a list of ten leaves the reader to work out which one it
   * meant — which is exactly the moment the answer matters.
   */
  const [error, setError] = useState<string | null>(null);
  const claimSlot = useRef<HTMLDivElement>(null);
  // Set when a claim or release lands, so focus can follow the control that
  // replaced the one the user just pressed and disappeared with it.
  const [refocus, setRefocus] = useState(0);

  useEffect(() => {
    if (refocus === 0) return;
    claimSlot.current?.querySelector("button")?.focus();
  }, [refocus]);

  function runClaim(
    action: () => Promise<OwnerActionResult<GiftIdeaView>>,
    announce: (idea: GiftIdeaView) => string,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onChanged(result.view);
        onAnnounce(announce(result.view));
        setRefocus((count) => count + 1);
        return;
      }
      /**
       * The losing side of a claim race. The seam already knows who won, so the
       * row corrects itself in place — the stale "I'll handle this" button goes,
       * and the reader is told who holds it. Leaving the button there and
       * reporting the failure somewhere else would invite them to press it again.
       */
      if (result.conflict) {
        onChanged({
          ...idea,
          claimedByLabel: result.conflict.actorName ?? null,
          claimedByMe: result.conflict.actorName === "You",
        });
      }
      setError(result.error || GIFT_PLAN_GENERIC_ERROR);
    });
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[length:var(--text-title)] font-medium leading-[var(--text-title-line)] text-foreground">
            {idea.title}
          </span>
          {idea.note ? (
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              {idea.note}
            </p>
          ) : null}
          {idea.url ? (
            <a
              className="w-fit text-[length:var(--text-small)] leading-[var(--text-small-line)] text-primary underline underline-offset-2"
              href={idea.url}
              rel="noreferrer noopener"
              target="_blank"
            >
              {idea.url}
            </a>
          ) : null}
          <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
            {idea.contributorLabel === "You" ? "Added by you" : `Added by ${idea.contributorLabel}`}
            {idea.claimedByLabel
              ? ` · ${idea.claimedByLabel === "You" ? "You're handling this" : `${idea.claimedByLabel} is handling this`}`
              : ""}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1" ref={claimSlot}>
          {idea.claimedByMe ? (
            <Button
              disabled={pending}
              onClick={() =>
                runClaim(
                  () => releaseGiftIdeaAction({ giftIdeaId: idea.id }),
                  (next) => `You let ${next.title} go.`,
                )
              }
              size="sm"
              variant="ghost"
            >
              <RotateCcwIcon aria-hidden className="size-3.5" />
              {pending ? "Letting go…" : "Let it go"}
            </Button>
          ) : idea.claimedByLabel || !acceptsCommitments ? null : (
            <Button
              disabled={pending}
              onClick={() =>
                runClaim(
                  () => claimGiftIdeaAction({ giftIdeaId: idea.id }),
                  (next) => `You're handling ${next.title}.`,
                )
              }
              size="sm"
              variant="outline"
            >
              <CheckIcon aria-hidden className="size-3.5" />
              {pending ? "Claiming…" : "I'll handle this"}
            </Button>
          )}
          {idea.mine ? (
            <Button
              aria-label={`Remove ${idea.title}`}
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await removeGiftIdeaAction({ giftIdeaId: idea.id });
                  if (!result.ok) {
                    setError(result.error || GIFT_PLAN_GENERIC_ERROR);
                    return;
                  }
                  onAnnounce(`${idea.title} removed.`);
                  onRemoved();
                });
              }}
              size="sm"
              variant="ghost"
            >
              <Trash2Icon aria-hidden className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {idea.mine ? <GiftIdeaEditForm idea={idea} onSaved={onChanged} /> : null}

      {error ? <ErrorText message={error} /> : null}
    </li>
  );
}

/**
 * The contributor's own correction path, so fixing a word does not mean deleting
 * the idea and losing whoever had claimed it.
 */
function GiftIdeaEditForm({
  idea,
  onSaved,
}: {
  idea: GiftIdeaView;
  onSaved: (idea: GiftIdeaView) => void;
}) {
  const [draft, setDraft] = useState({
    title: idea.title,
    note: idea.note ?? "",
    url: idea.url ?? "",
  });
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);

  return (
    <GiftPlanInlineForm
      onSubmit={async () => {
        setError(null);
        const result = await editGiftIdeaAction({
          giftIdeaId: idea.id,
          title: draft.title,
          note: draft.note || null,
          url: draft.url || null,
          ...(replace ? {} : { expectedRevision: idea.revision }),
        });
        if (result.ok) {
          setConflict(null);
          setReplace(false);
          onSaved(result.view);
          return true;
        }
        if (result.conflict) {
          setConflict(
            `${result.conflict.actorName ?? "Someone"} changed this to “${result.conflict.currentValue}”. Save again to replace it with yours.`,
          );
          setReplace(true);
          return false;
        }
        setError(result.error || GIFT_PLAN_GENERIC_ERROR);
        return false;
      }}
      pendingLabel="Saving…"
      submitLabel="Save idea"
      triggerIcon={PencilIcon}
      triggerLabel="Edit"
      triggerSize="sm"
      triggerVariant="ghost"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`gift-idea-edit-title-${idea.id}`}>Idea</Label>
        <Input
          autoComplete="off"
          id={`gift-idea-edit-title-${idea.id}`}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          value={draft.title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`gift-idea-edit-note-${idea.id}`}>Note (optional)</Label>
        <Textarea
          id={`gift-idea-edit-note-${idea.id}`}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          rows={2}
          value={draft.note}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`gift-idea-edit-url-${idea.id}`}>Link (optional)</Label>
        <Input
          autoComplete="off"
          id={`gift-idea-edit-url-${idea.id}`}
          onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
          value={draft.url}
        />
      </div>
      {conflict ? <ErrorText message={conflict} /> : null}
      {error ? <ErrorText message={error} /> : null}
    </GiftPlanInlineForm>
  );
}

function AddGiftIdeaForm({
  giftPlanId,
  onAdded,
  onError,
}: {
  giftPlanId: string;
  onAdded: (idea: GiftIdeaView) => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState({ title: "", note: "", url: "" });

  return (
    <GiftPlanInlineForm
      onSubmit={async () => {
        onError(null);
        const result = await addGiftIdeaAction({
          giftPlanId,
          title: draft.title,
          note: draft.note || undefined,
          url: draft.url || undefined,
        });
        if (!result.ok) {
          onError(result.error || GIFT_PLAN_GENERIC_ERROR);
          return false;
        }
        setDraft({ title: "", note: "", url: "" });
        onAdded(result.view);
        return true;
      }}
      pendingLabel="Adding…"
      submitLabel="Add idea"
      triggerLabel="Add an idea"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gift-idea-title">Idea</Label>
        <Input
          autoComplete="off"
          id="gift-idea-title"
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder="Wool blanket"
          value={draft.title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gift-idea-note">Note (optional)</Label>
        <Textarea
          id="gift-idea-note"
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          placeholder="The grey one she pointed out in October."
          rows={2}
          value={draft.note}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gift-idea-url">Link (optional)</Label>
        <Input
          autoComplete="off"
          id="gift-idea-url"
          onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
          value={draft.url}
        />
      </div>
    </GiftPlanInlineForm>
  );
}

/**
 * The controls that belong to the plan's owner alone.
 *
 * They are gathered below the content rather than in a header toolbar because
 * none of them is the reason someone opened the page. Changing who can see a
 * plan, and whether it is a surprise, are deliberate acts that should cost a
 * scroll.
 */
function GiftPlanOwnerControls({
  plan,
  members,
  onChanged,
}: {
  plan: GiftPlanView;
  members: ShareableActionMember[];
  onChanged: () => void;
}) {
  const [choice, setChoice] = useState<VisibilityChoice>(visibilityChoiceForScope(plan.scope));
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [surprise, setSurprise] = useState(NO_SURPRISE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canProtect = choice === "selected_members" && members.length > 0;

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error || GIFT_PLAN_GENERIC_ERROR);
        return;
      }
      onChanged();
    });
  }

  const nextStatus: GiftPlanStatus = plan.status === "active" ? "celebrated" : "active";

  return (
    <section className="flex flex-col gap-5 border-t border-border pt-6">
      <h2 className="text-[length:var(--text-h2)] font-semibold leading-[var(--text-h2-line)]">
        Plan settings
      </h2>

      {members.length > 0 ? (
        <div className="flex flex-col gap-3">
          <ActionVisibilityField
            members={members}
            name="gift-plan-audience"
            onChoiceChange={setChoice}
            onSelectedChange={setSelectedUserIds}
            selectedUserIds={selectedUserIds}
            value={choice}
          />
          <VisibilityControl
            className="w-fit"
            disabled={pending}
            onClick={() =>
              run(() =>
                setGiftPlanAudienceAction({
                  giftPlanId: plan.id,
                  visibilityChoice: choice,
                  selectedUserIds,
                }),
              )
            }
            variant="outline"
          >
            {pending ? "Saving…" : "Save visibility"}
          </VisibilityControl>
        </div>
      ) : null}

      {canProtect || plan.surprise ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="gift-plan-surprise-subject">Surprise for</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select onValueChange={setSurprise} value={surprise}>
              <SelectTrigger className="sm:max-w-72" id="gift-plan-surprise-subject">
                <SelectValue placeholder="No one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SURPRISE}>No one</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={pending}
              onClick={() =>
                run(() =>
                  setGiftPlanSurpriseSubjectAction({
                    giftPlanId: plan.id,
                    surpriseSubjectUserId: surprise === NO_SURPRISE ? null : surprise,
                  }),
                )
              }
              variant="outline"
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
          {surprise !== NO_SURPRISE ? (
            <GiftPlanSurpriseNote
              name={members.find((member) => member.userId === surprise)?.name ?? null}
            />
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorText message={error} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            run(() => setGiftPlanStatusAction({ giftPlanId: plan.id, status: nextStatus }))
          }
          variant="outline"
        >
          {plan.status === "active" ? "Mark celebrated" : "Reopen plan"}
        </Button>
        {plan.status !== "archived" ? (
          <Button
            disabled={pending}
            onClick={() =>
              run(() => setGiftPlanStatusAction({ giftPlanId: plan.id, status: "archived" }))
            }
            variant="ghost"
          >
            Archive
          </Button>
        ) : null}
      </div>
    </section>
  );
}
