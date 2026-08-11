"use client";

import type { VisibilityChoice } from "@tendnote/domain/privacy";
import Link from "next/link";
import { useState } from "react";
import { createGiftPlanAction } from "@/app/actions/gift-plans";
import { ErrorText } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import { GiftPlanInlineForm } from "@/components/gift-plan-inline-form";
import {
  GIFT_PLAN_GENERIC_ERROR,
  GiftPlanAudienceChip,
  GiftPlanStatusChip,
  GiftPlanSurpriseChip,
  GiftPlanSurpriseNote,
  GiftPlanTimingChip,
} from "@/components/gift-plan-shared";
import { ChevronRightIcon } from "@/components/icons";
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
import type { GiftPlanView } from "@/lib/gift-plan-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

const NO_SURPRISE = "none";

const EMPTY_DRAFT = {
  subjectName: "",
  occasion: "",
  occasionOn: "",
  surpriseSubjectUserId: NO_SURPRISE,
  visibilityChoice: "only_me" as VisibilityChoice,
  selectedUserIds: [] as string[],
};

export function GiftPlansSurface({
  plans,
  shareableMembers = [],
}: {
  plans: GiftPlanView[];
  shareableMembers?: ShareableActionMember[];
}) {
  const [list, setList] = useServerSyncedList(plans, (plan) => plan.id);

  return (
    <div className="flex flex-col gap-6">
      <GiftPlanCreateForm
        members={shareableMembers}
        onCreated={(plan) => setList((current) => [plan, ...current])}
      />

      {list.length === 0 ? (
        <EmptyState
          title="No gift plans yet"
          description="Start one when a birthday or celebration is coming up. Plans stay private until you choose someone to plan with."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {list.map((plan) => (
            <GiftPlanRow key={plan.id} plan={plan} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One plan as a ledger row.
 *
 * The person leads, the occasion follows, and the metadata sits under both — the
 * Personal Ledger order, because a plan is about someone rather than about a
 * task. The whole row is the link; there are no per-row controls, so the list
 * stays scannable and every decision happens on the plan's own page.
 */
function GiftPlanRow({ plan }: { plan: GiftPlanView }) {
  return (
    <li>
      <Link
        className="flex items-center gap-3 py-3 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={`/gift-plans/${plan.id}`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[length:var(--text-title)] font-medium leading-[var(--text-title-line)] text-foreground">
              {plan.subjectName}
            </span>
            <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              {plan.occasion}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {plan.timingLabel ? <GiftPlanTimingChip label={plan.timingLabel} /> : null}
            <GiftPlanStatusChip label={plan.statusLabel} />
            <GiftPlanAudienceChip plan={plan} />
            {plan.surprise ? <GiftPlanSurpriseChip /> : null}
            <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              {plan.ideaCount === 0
                ? "No ideas yet"
                : `${plan.ideaCount} idea${plan.ideaCount === 1 ? "" : "s"}${
                    plan.claimedIdeaCount > 0 ? ` · ${plan.claimedIdeaCount} claimed` : ""
                  }`}
            </span>
          </span>
        </span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function GiftPlanCreateForm({
  members,
  onCreated,
}: {
  members: ShareableActionMember[];
  onCreated: (plan: GiftPlanView) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  /**
   * Surprise protection is offered only for "specific people": the subject would
   * be in the audience of a whole-household plan by definition, and a private
   * plan has no one to hide it from. Offering it anyway would be offering a
   * choice the seam then refuses.
   */
  const canProtect = draft.visibilityChoice === "selected_members" && members.length > 0;
  const eligibleSubjects = members.filter(
    (member) => !draft.selectedUserIds.includes(member.userId),
  );
  const surpriseName =
    members.find((member) => member.userId === draft.surpriseSubjectUserId)?.name ?? null;

  async function submit() {
    setError(null);
    const result = await createGiftPlanAction({
      subjectName: draft.subjectName,
      occasion: draft.occasion,
      occasionOn: draft.occasionOn || undefined,
      surpriseSubjectUserId:
        canProtect && draft.surpriseSubjectUserId !== NO_SURPRISE
          ? draft.surpriseSubjectUserId
          : undefined,
      visibilityChoice: draft.visibilityChoice,
      selectedUserIds: draft.selectedUserIds,
    });
    if (!result.ok) {
      setError(result.error || GIFT_PLAN_GENERIC_ERROR);
      return false;
    }
    setDraft(EMPTY_DRAFT);
    onCreated(result.view);
    return true;
  }

  return (
    <GiftPlanInlineForm
      onSubmit={submit}
      pendingLabel="Starting…"
      submitLabel="Start plan"
      triggerLabel="Start a plan"
    >
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gift-plan-subject">Who is it for?</Label>
            <Input
              autoComplete="off"
              id="gift-plan-subject"
              onChange={(event) =>
                setDraft((current) => ({ ...current, subjectName: event.target.value }))
              }
              placeholder="Rowan"
              value={draft.subjectName}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gift-plan-occasion">What's the occasion?</Label>
            <Input
              autoComplete="off"
              id="gift-plan-occasion"
              onChange={(event) =>
                setDraft((current) => ({ ...current, occasion: event.target.value }))
              }
              placeholder="Fortieth birthday"
              value={draft.occasion}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:max-w-56">
          <Label htmlFor="gift-plan-date">When is it? (optional)</Label>
          <Input
            id="gift-plan-date"
            onChange={(event) =>
              setDraft((current) => ({ ...current, occasionOn: event.target.value }))
            }
            type="date"
            value={draft.occasionOn}
          />
        </div>

        <ActionVisibilityField
          members={members}
          name="gift-plan-visibility"
          onChoiceChange={(choice) =>
            setDraft((current) => ({
              ...current,
              visibilityChoice: choice,
              // Protection only exists for a selected audience, so leaving that
              // choice must not leave a stale subject behind to be submitted.
              surpriseSubjectUserId:
                choice === "selected_members" ? current.surpriseSubjectUserId : NO_SURPRISE,
            }))
          }
          onSelectedChange={(userIds) =>
            setDraft((current) => ({
              ...current,
              selectedUserIds: userIds,
              surpriseSubjectUserId: userIds.includes(current.surpriseSubjectUserId)
                ? NO_SURPRISE
                : current.surpriseSubjectUserId,
            }))
          }
          selectedUserIds={draft.selectedUserIds}
          value={draft.visibilityChoice}
        />

        {canProtect ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Label htmlFor="gift-plan-surprise">Is this a surprise for someone here?</Label>
            <Select
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, surpriseSubjectUserId: value }))
              }
              value={draft.surpriseSubjectUserId}
            >
              <SelectTrigger className="sm:max-w-72" id="gift-plan-surprise">
                <SelectValue placeholder="No one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SURPRISE}>No one</SelectItem>
                {eligibleSubjects.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.surpriseSubjectUserId !== NO_SURPRISE ? (
              <GiftPlanSurpriseNote name={surpriseName} />
            ) : null}
          </div>
        ) : null}

        <AudiencePreview
          choice={draft.visibilityChoice}
          householdSize={members.length + 1}
          selectedCount={draft.selectedUserIds.length}
        />

        {error ? <ErrorText message={error} /> : null}
      </>
    </GiftPlanInlineForm>
  );
}
