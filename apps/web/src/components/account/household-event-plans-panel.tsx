"use client";

import { useEffect, useState } from "react";
import { createHouseholdEventPlanAction as defaultCreateAction } from "@/app/actions/household-event-plans";
import { NotebookPenIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type {
  HouseholdEventPlanRecord,
  HouseholdEventPlanView,
} from "@/lib/household/household-event-plan-view";
import { HouseholdEventPlanCard } from "./household-event-plan-card";
import { NewHouseholdEventPlanForm } from "./household-event-plan-new-form";
import type {
  HouseholdEventPlanActions,
  HouseholdEventPlansPanelProps,
  PendingHouseholdCalendarEvent,
} from "./household-event-plan-types";

export type {
  HouseholdCalendarEventAddress,
  HouseholdEventPlanActions,
  HouseholdEventPlanDraftInput,
  PendingHouseholdCalendarEvent,
} from "./household-event-plan-types";

type OpenForm = { key: string; attachment: PendingHouseholdCalendarEvent | null };

type PlanCollectionProps = {
  ariaLabelledBy?: string;
  plans: readonly HouseholdEventPlanView[];
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  linkCandidates: HouseholdEventPlansPanelProps["linkCandidates"];
  actions: HouseholdEventPlanActions;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onPlanRefreshed: HouseholdEventPlansPanelProps["onPlanRefreshed"];
  onAnnounce: (message: string) => void;
};

function PanelHeader({ unavailable, onNew }: { unavailable: boolean; onNew: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
          id="household-event-plans-heading"
        >
          <NotebookPenIcon aria-hidden className="size-4 shrink-0" />
          Event plans
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Your household&rsquo;s own notes for an occasion. Anyone here can start one, change it, or
          archive it.
        </p>
      </div>
      {unavailable ? null : (
        <Button
          className="min-h-11 shrink-0 sm:min-h-8"
          onClick={onNew}
          size="sm"
          type="button"
          variant="outline"
        >
          New plan
        </Button>
      )}
    </div>
  );
}

function PlanCollection(props: PlanCollectionProps) {
  if (props.plans.length === 0) return null;
  return (
    <ul aria-labelledby={props.ariaLabelledBy} className="flex flex-col gap-3">
      {props.plans.map((plan) => (
        <HouseholdEventPlanCard
          actions={props.actions}
          key={plan.id}
          linkCandidates={props.linkCandidates}
          memberNames={props.memberNames}
          onAnnounce={props.onAnnounce}
          onPlanRefreshed={props.onPlanRefreshed}
          onPlansChange={props.onPlansChange}
          plan={plan}
          viewerUserId={props.viewerUserId}
        />
      ))}
    </ul>
  );
}

function ArchivedPlanCollection(props: PlanCollectionProps) {
  if (props.plans.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
        id="household-archived-plans-heading"
      >
        Archived
      </h3>
      <PlanCollection ariaLabelledBy="household-archived-plans-heading" {...props} />
    </div>
  );
}

function AvailablePlans({
  openForm,
  props,
  onCloseForm,
}: {
  openForm: OpenForm | null;
  props: HouseholdEventPlansPanelProps & { actions: HouseholdEventPlanActions };
  onCloseForm: () => void;
}) {
  const empty = props.groups.active.length === 0 && props.groups.archived.length === 0;
  const collectionProps = {
    viewerUserId: props.viewerUserId,
    memberNames: props.memberNames,
    linkCandidates: props.linkCandidates,
    actions: props.actions,
    onPlansChange: props.onPlansChange,
    onPlanRefreshed: props.onPlanRefreshed,
    onAnnounce: props.onAnnounce,
  };
  return (
    <>
      {openForm ? (
        <NewHouseholdEventPlanForm
          attachment={openForm.attachment}
          create={props.actions.create ?? defaultCreateAction}
          key={openForm.key}
          onAnnounce={props.onAnnounce}
          onClose={onCloseForm}
          onPlansChange={props.onPlansChange}
        />
      ) : null}
      {empty && !openForm ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Nothing planned here yet. Start one for the next birthday, school night, or visit, and
          everyone here can add to it.
        </p>
      ) : null}
      <PlanCollection {...collectionProps} plans={props.groups.active} />
      <ArchivedPlanCollection {...collectionProps} plans={props.groups.archived} />
    </>
  );
}

/**
 * The household's own planning records (issue #387).
 *
 * Authority is symmetric: every active member gets the same controls on every
 * Plan, whoever started it and whatever their household role. Calendar data is
 * provider truth; these records remain Tendnote-native household prose.
 */
export function HouseholdEventPlansPanel({
  actions = {},
  ...props
}: HouseholdEventPlansPanelProps) {
  const [openForm, setOpenForm] = useState<OpenForm | null>(null);

  useEffect(() => {
    if (!props.pendingCalendarEvent) return;
    setOpenForm({
      key: `event-${props.pendingCalendarEvent.nonce}`,
      attachment: props.pendingCalendarEvent,
    });
  }, [props.pendingCalendarEvent]);

  return (
    <section aria-labelledby="household-event-plans-heading" className="flex flex-col gap-3">
      <PanelHeader
        onNew={() => setOpenForm({ key: `new-${Date.now()}`, attachment: null })}
        unavailable={props.unavailable}
      />
      {props.unavailable ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Plans can&rsquo;t be read right now. Nothing has changed, and this will come back on its
          own.
        </p>
      ) : (
        <AvailablePlans
          onCloseForm={() => setOpenForm(null)}
          openForm={openForm}
          props={{ ...props, actions }}
        />
      )}
    </section>
  );
}
