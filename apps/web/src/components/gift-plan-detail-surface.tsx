"use client";

import type { GiftPlanStatus } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { visibilityChoiceForScope } from "@tendnote/domain/privacy";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addGiftIdeaAction,
  claimGiftIdeaAction,
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
import {
  GIFT_PLAN_GENERIC_ERROR,
  GiftPlanAudienceChip,
  GiftPlanSurpriseChip,
  GiftPlanSurpriseNote,
  GiftPlanTimingChip,
} from "@/components/gift-plan-shared";
import { CheckIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import type { GiftIdeaView, GiftPlanDetailView } from "@/lib/gift-plan-view";
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
   * Every mutation re-reads from the server rather than patching state from the
   * response. A Gift Plan's contents depend on who is asking, and the authority
   * on that is the seam — reconciling locally would be a second, thinner copy of
   * the same decision.
   */
  function refresh() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
          {plan.subjectName}
        </h1>
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
          {plan.occasion}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.timingLabel ? <GiftPlanTimingChip label={plan.timingLabel} /> : null}
          <GiftPlanAudienceChip plan={plan} />
          {plan.surprise ? <GiftPlanSurpriseChip /> : null}
        </div>
        {plan.surprise ? <GiftPlanSurpriseNote name={null} /> : null}
      </header>

      {error ? <ErrorText message={error} /> : null}

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
            size="compact"
            title="Nothing here yet"
            description={
              plan.coPlannerCount > 0
                ? "Add the first idea. Everyone planning with you can add their own and say which one they'll handle."
                : "Add the first idea you want to remember."
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {ideas.map((idea) => (
              <GiftIdeaRow
                idea={idea}
                key={idea.id}
                onChanged={(next) =>
                  setIdeas((current) =>
                    current.map((entry) => (entry.id === next.id ? next : entry)),
                  )
                }
                onError={setError}
                onRemoved={() =>
                  setIdeas((current) => current.filter((entry) => entry.id !== idea.id))
                }
              />
            ))}
          </ul>
        )}

        <AddGiftIdeaForm
          giftPlanId={plan.id}
          onAdded={(idea) => setIdeas((current) => [...current, idea])}
          onError={setError}
        />
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
 * One idea, its contributor, and its claim.
 *
 * The claim is the row's only prominent control because it is the only one that
 * affects anyone else. Editing and removing belong to whoever wrote the idea and
 * sit quietly beside it — attribution is a fact about the plan, not a permission
 * the owner grants.
 */
function GiftIdeaRow({
  idea,
  onChanged,
  onRemoved,
  onError,
}: {
  idea: GiftIdeaView;
  onChanged: (idea: GiftIdeaView) => void;
  onRemoved: () => void;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<Awaited<ReturnType<typeof claimGiftIdeaAction>>>) {
    onError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        onError(result.error || GIFT_PLAN_GENERIC_ERROR);
        return;
      }
      onChanged(result.view);
    });
  }

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
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

      <div className="flex shrink-0 items-center gap-1">
        {idea.claimedByMe ? (
          <Button
            disabled={pending}
            onClick={() => run(() => releaseGiftIdeaAction({ giftIdeaId: idea.id }))}
            size="sm"
            variant="ghost"
          >
            <RotateCcwIcon aria-hidden className="size-3.5" />
            Let it go
          </Button>
        ) : idea.claimedByLabel ? null : (
          <Button
            disabled={pending}
            onClick={() => run(() => claimGiftIdeaAction({ giftIdeaId: idea.id }))}
            size="sm"
            variant="outline"
          >
            <CheckIcon aria-hidden className="size-3.5" />
            I'll handle this
          </Button>
        )}
        {idea.mine ? (
          <Button
            aria-label={`Remove ${idea.title}`}
            disabled={pending}
            onClick={() => {
              onError(null);
              startTransition(async () => {
                const result = await removeGiftIdeaAction({ giftIdeaId: idea.id });
                if (!result.ok) {
                  onError(result.error || GIFT_PLAN_GENERIC_ERROR);
                  return;
                }
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
    </li>
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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", note: "", url: "" });
  const [pending, startTransition] = useTransition();

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger asChild>
        <Button className="w-fit" variant="outline">
          <PlusIcon aria-hidden className="size-4" />
          Add an idea
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form
          className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            onError(null);
            startTransition(async () => {
              const result = await addGiftIdeaAction({
                giftPlanId,
                title: draft.title,
                note: draft.note || undefined,
                url: draft.url || undefined,
              });
              if (!result.ok) {
                onError(result.error || GIFT_PLAN_GENERIC_ERROR);
                return;
              }
              setDraft({ title: "", note: "", url: "" });
              setOpen(false);
              onAdded(result.view);
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gift-idea-title">Idea</Label>
            <Input
              autoComplete="off"
              id="gift-idea-title"
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Wool blanket"
              value={draft.title}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gift-idea-note">Note (optional)</Label>
            <Textarea
              id="gift-idea-note"
              onChange={(event) =>
                setDraft((current) => ({ ...current, note: event.target.value }))
              }
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
          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? "Adding…" : "Add idea"}
            </Button>
            <Button onClick={() => setOpen(false)} type="button" variant="ghost">
              Cancel
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
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
  plan: GiftPlanDetailView["plan"];
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
          <Button
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
            Update who can see this
          </Button>
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
              Save
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
