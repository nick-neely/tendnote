"use client";

/**
 * PROTOTYPE — throwaway Phase Eight UI, never production behavior.
 *
 * Three variants of Account > Household, switchable with `?variant=`, mounted
 * inside the existing Account route with `?prototype=household`.
 *
 * THESIS: Household management should feel like tending a small shared circle,
 * not administering an organization. OWN-WORLD: Tendnote's restrained Field
 * Notebook tokens, flat rows, hairlines, sage action, and plain IBM Plex type.
 * STORY: See who belongs, understand the current moment, and take one safe next
 * action. FIRST VIEWPORT: the household name and people lead; governance appears
 * beside the action it constrains. FORM: three deliberately different Operate
 * structures grounded in the local concept seed (478a8c39), led by the assigned
 * household-table composition.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  LockIcon,
  MailIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersRoundIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const variants = [
  { key: "A", name: "Household table" },
  { key: "B", name: "Account ledger" },
  { key: "C", name: "Guided moments" },
  { key: "D", name: "Selected hybrid" },
] as const;

const moments = [
  { key: "create", label: "Create" },
  { key: "overview", label: "Overview" },
  { key: "invite", label: "Invite" },
  { key: "accept", label: "Accept" },
  { key: "manage", label: "Manage" },
  { key: "settings", label: "Settings" },
  { key: "departure", label: "Leave" },
  { key: "recovery", label: "Recovery" },
] as const;

type VariantKey = (typeof variants)[number]["key"];
type MomentKey = (typeof moments)[number]["key"];
type ScenarioKey = "couple" | "roommates";

type Member = {
  name: string;
  email: string;
  role: "Owner" | "Member";
  initials: string;
  current?: boolean;
};

type HouseholdFixture = {
  name: string;
  members: Member[];
  invitations: { email: string; expires: string }[];
};

const fixtures: Record<ScenarioKey, HouseholdFixture> = {
  couple: {
    name: "Nick & Mara",
    members: [
      {
        name: "Nick Neely",
        email: "nick@example.com",
        role: "Owner",
        initials: "NN",
        current: true,
      },
      { name: "Mara Neely", email: "mara@example.com", role: "Member", initials: "MN" },
    ],
    invitations: [],
  },
  roommates: {
    name: "Juniper House",
    members: [
      {
        name: "Alex Chen",
        email: "alex@example.com",
        role: "Owner",
        initials: "AC",
        current: true,
      },
      { name: "Priya Shah", email: "priya@example.com", role: "Owner", initials: "PS" },
      { name: "Mateo Ruiz", email: "mateo@example.com", role: "Member", initials: "MR" },
      { name: "Sam Okafor", email: "sam@example.com", role: "Member", initials: "SO" },
      { name: "Leah Kim", email: "leah@example.com", role: "Member", initials: "LK" },
      { name: "Dev Patel", email: "dev@example.com", role: "Member", initials: "DP" },
    ],
    invitations: [{ email: "riley@example.com", expires: "13 days" }],
  },
};

export function HouseholdSetupPrototype() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const variant = parseVariant(searchParams.get("variant"));
  const moment = parseMoment(searchParams.get("moment"));
  const scenario = parseScenario(searchParams.get("scenario"));
  const household = fixtures[scenario];

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("prototype", "household");
      next.set(key, value);
      router.replace(`/account?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const cycleVariant = useCallback(
    (delta: -1 | 1) => {
      const index = variants.findIndex((item) => item.key === variant);
      const next = variants[(index + delta + variants.length) % variants.length];
      if (next) setParam("variant", next.key);
    },
    [setParam, variant],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") cycleVariant(-1);
      if (event.key === "ArrowRight") cycleVariant(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cycleVariant]);

  const state = useMemo(
    () => ({
      variant,
      scenario,
      moment,
      occupiedSeats: household.members.length + household.invitations.length,
      capacity: 8,
      currentRole: household.members.find((member) => member.current)?.role ?? "Member",
    }),
    [household, moment, scenario, variant],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-24">
      <PrototypeToolbar
        moment={moment}
        onMomentChange={(value) => setParam("moment", value)}
        onScenarioChange={(value) => setParam("scenario", value)}
        scenario={scenario}
        state={state}
      />

      {variant === "A" ? (
        <HouseholdTable
          household={household}
          moment={moment}
          onMomentChange={(value) => setParam("moment", value)}
        />
      ) : null}
      {variant === "B" ? (
        <AccountLedger
          household={household}
          moment={moment}
          onMomentChange={(value) => setParam("moment", value)}
        />
      ) : null}
      {variant === "C" ? (
        <GuidedMoments
          household={household}
          moment={moment}
          onMomentChange={(value) => setParam("moment", value)}
        />
      ) : null}
      {variant === "D" ? (
        <SelectedHybrid
          household={household}
          moment={moment}
          onMomentChange={(value) => setParam("moment", value)}
        />
      ) : null}

      <PrototypeSwitcher
        current={variant}
        onCycle={cycleVariant}
        onSelect={(value) => setParam("variant", value)}
      />
    </div>
  );
}

function PrototypeToolbar({
  moment,
  onMomentChange,
  onScenarioChange,
  scenario,
  state,
}: {
  moment: MomentKey;
  onMomentChange: (value: MomentKey) => void;
  onScenarioChange: (value: ScenarioKey) => void;
  scenario: ScenarioKey;
  state: Record<string, string | number>;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-panel/50 p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Phase Eight throwaway prototype
          </p>
          <p className="text-sm">Switch the household and moment to stress-test each structure.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Household
            <select
              className="h-8 rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
              onChange={(event) => onScenarioChange(parseScenario(event.target.value))}
              value={scenario}
            >
              <option value="couple">Reference couple</option>
              <option value="roommates">Larger household</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Moment
            <select
              className="h-8 rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
              onChange={(event) => onMomentChange(parseMoment(event.target.value))}
              value={moment}
            >
              {moments.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Relevant prototype state</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-2 font-mono leading-5">
          {JSON.stringify(state, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function HouseholdTable({ household, moment, onMomentChange }: SurfaceProps) {
  return (
    <main className="overflow-hidden rounded-2xl border bg-background">
      <header className="flex flex-col gap-5 border-b px-gutter py-6 sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <div className="flex flex-col gap-1">
          <Button className="-ml-2.5 w-fit" size="sm" variant="ghost">
            Account <ChevronRightIcon aria-hidden />
          </Button>
          <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold">
            {moment === "create" ? "Create a household" : household.name}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {moment === "create"
              ? "A private shared place for the people you trust."
              : `${household.members.length} people share this household.`}
          </p>
        </div>
        {moment !== "create" ? (
          <Button onClick={() => onMomentChange("invite")}>
            <UserPlusIcon /> Invite someone
          </Button>
        ) : null}
      </header>

      {moment === "create" ? <CreateMoment onContinue={() => onMomentChange("invite")} /> : null}
      {moment === "accept" ? (
        <AcceptMoment
          householdName={household.name}
          onContinue={() => onMomentChange("overview")}
        />
      ) : null}
      {moment === "recovery" ? <RecoveryMoment /> : null}
      {moment !== "create" && moment !== "accept" && moment !== "recovery" ? (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="px-gutter py-6 sm:px-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">People</h2>
              <SeatCount household={household} />
            </div>
            <div className="divide-y border-y">
              {household.members.map((member) => (
                <MemberRow key={member.email} member={member} showActions={moment === "manage"} />
              ))}
              {household.invitations.map((invitation) => (
                <InvitationRow invitation={invitation} key={invitation.email} />
              ))}
            </div>
          </section>
          <aside className="flex flex-col gap-5 border-t bg-surface px-gutter py-6 lg:border-t-0 lg:border-l lg:px-6">
            {moment === "invite" ? <InviteMoment household={household} /> : null}
            {moment === "departure" ? <DepartureMoment household={household} /> : null}
            {moment !== "invite" && moment !== "departure" ? (
              <>
                <ContextPrompt />
                <div className="border-t pt-4">
                  <p className="text-sm font-medium">Household settings</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Rename, manage roles, leave, or review recovery options.
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() => onMomentChange("manage")}
                    size="sm"
                    variant="outline"
                  >
                    Manage household
                  </Button>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function AccountLedger({ household, moment, onMomentChange }: SurfaceProps) {
  return (
    <main className="mx-auto w-full max-w-2xl">
      <header className="mb-7 flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Account / Household</p>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold">
              {moment === "create" ? "Household" : household.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Private to the people listed here.</p>
          </div>
          {moment !== "create" ? <Badge variant="outline">Owner</Badge> : null}
        </div>
      </header>

      {moment === "create" ? <CreateMoment onContinue={() => onMomentChange("invite")} /> : null}
      {moment === "accept" ? (
        <AcceptMoment
          householdName={household.name}
          onContinue={() => onMomentChange("overview")}
        />
      ) : null}
      {moment === "recovery" ? <RecoveryMoment /> : null}
      {moment !== "create" && moment !== "accept" && moment !== "recovery" ? (
        <div className="flex flex-col gap-8">
          <section>
            <LedgerHeading action={<SeatCount household={household} />} title="People" />
            <div className="divide-y border-t border-b">
              {household.members.map((member) => (
                <MemberRow key={member.email} member={member} showActions={moment === "manage"} />
              ))}
              {household.invitations.map((invitation) => (
                <InvitationRow invitation={invitation} key={invitation.email} />
              ))}
            </div>
            <Button
              className="mt-3"
              onClick={() => onMomentChange("invite")}
              size="sm"
              variant="outline"
            >
              <UserPlusIcon /> Invite someone
            </Button>
          </section>

          {moment === "invite" ? <InviteMoment household={household} /> : null}
          {moment === "departure" ? <DepartureMoment household={household} /> : null}
          {moment === "overview" ? <ContextPrompt /> : null}

          <section>
            <LedgerHeading title="Household settings" />
            <div className="divide-y border-t border-b">
              <LedgerAction label="Name" value={household.name} />
              <LedgerAction
                label="Roles and access"
                onClick={() => onMomentChange("manage")}
                value={`${household.members.filter((member) => member.role === "Owner").length} owners`}
              />
              <LedgerAction
                label="Leaving this household"
                onClick={() => onMomentChange("departure")}
                value="Your private records stay yours"
              />
              <LedgerAction
                label="Recovery and dissolution"
                onClick={() => onMomentChange("recovery")}
                value="Owner confirmation required"
              />
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function GuidedMoments({ household, moment, onMomentChange }: SurfaceProps) {
  return (
    <main className="grid overflow-hidden rounded-2xl border bg-background md:grid-cols-[13rem_minmax(0,1fr)]">
      <nav
        aria-label="Prototype moments"
        className="min-w-0 border-b bg-panel/70 p-4 md:border-r md:border-b-0"
      >
        <p className="text-sm font-semibold">Household moments</p>
        <p className="mt-1 mb-3 text-xs leading-5 text-muted-foreground">
          Separate views, not one person’s sequence.
        </p>
        <ol className="grid grid-cols-2 gap-1 md:flex md:flex-col">
          {moments.map((item) => (
            <li key={item.key}>
              <button
                className={cn(
                  "flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/35",
                  item.key === moment
                    ? "bg-background font-medium text-foreground"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
                onClick={() => onMomentChange(item.key)}
                type="button"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    item.key === moment ? "bg-primary" : "bg-border",
                  )}
                />
                {item.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="min-w-0 px-gutter py-7 sm:px-8">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Account / Household</p>
            <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold">
              {moment === "create" ? "Start a household" : household.name}
            </h1>
          </div>
          {moment !== "create" ? <SeatCount household={household} /> : null}
        </div>
        {moment === "create" ? <CreateMoment onContinue={() => onMomentChange("invite")} /> : null}
        {moment === "overview" ? (
          <GuidedOverview household={household} onMomentChange={onMomentChange} />
        ) : null}
        {moment === "invite" ? <InviteMoment household={household} /> : null}
        {moment === "accept" ? (
          <AcceptMoment
            householdName={household.name}
            onContinue={() => onMomentChange("overview")}
          />
        ) : null}
        {moment === "manage" ? <GuidedManage household={household} /> : null}
        {moment === "departure" ? <DepartureMoment household={household} /> : null}
        {moment === "recovery" ? <RecoveryMoment /> : null}
      </div>
    </main>
  );
}

const householdDestinations = [
  { key: "overview", label: "Overview", moment: "overview" },
  { key: "people", label: "People & invitations", moment: "manage" },
  { key: "settings", label: "Settings", moment: "departure" },
] as const;

type HouseholdDestination = (typeof householdDestinations)[number]["key"];

function SelectedHybrid({ household, moment, onMomentChange }: SurfaceProps) {
  if (moment === "create") {
    return (
      <main className="overflow-hidden rounded-2xl border bg-background">
        <HybridHeader household={household} title="Create a household" />
        <CreateMoment onContinue={() => onMomentChange("invite")} />
      </main>
    );
  }

  if (moment === "accept") {
    return (
      <main className="overflow-hidden rounded-2xl border bg-background">
        <HybridHeader household={household} title="Household invitation" />
        <div className="px-gutter py-8 sm:px-8">
          <AcceptMoment
            householdName={household.name}
            onContinue={() => onMomentChange("overview")}
          />
        </div>
      </main>
    );
  }

  const destination = destinationForMoment(moment);

  return (
    <main className="overflow-hidden rounded-2xl border bg-background">
      <HybridHeader household={household} />
      <div className="grid md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Household sections" className="hidden border-r bg-panel/60 p-4 md:block">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Household</p>
          <div className="flex flex-col gap-1">
            {householdDestinations.map((item) => (
              <button
                className={cn(
                  "min-h-10 rounded-lg px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/35",
                  destination === item.key
                    ? "bg-background font-medium text-foreground"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
                key={item.key}
                onClick={() => onMomentChange(item.moment)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="min-w-0 px-gutter py-6 sm:px-8">
          <label className="mb-6 flex flex-col gap-1 text-xs text-muted-foreground md:hidden">
            Household section
            <select
              className="h-10 rounded-lg border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
              onChange={(event) => {
                const selected = householdDestinations.find(
                  (item) => item.key === event.target.value,
                );
                if (selected) onMomentChange(selected.moment);
              }}
              value={destination}
            >
              {householdDestinations.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {destination === "overview" ? (
            <HybridOverview household={household} onMomentChange={onMomentChange} />
          ) : null}
          {destination === "people" ? (
            <HybridPeople household={household} moment={moment} onMomentChange={onMomentChange} />
          ) : null}
          {destination === "settings" ? (
            <HybridSettings household={household} moment={moment} onMomentChange={onMomentChange} />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function HybridHeader({ household, title }: { household: HouseholdFixture; title?: string }) {
  return (
    <header className="flex flex-col gap-4 border-b px-gutter py-5 sm:flex-row sm:items-end sm:justify-between sm:px-8">
      <div>
        <p className="text-sm text-muted-foreground">Account / Household</p>
        <h1 className="mt-1 text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold">
          {title ?? household.name}
        </h1>
      </div>
      {!title ? <SeatCount household={household} /> : null}
    </header>
  );
}

function HybridOverview({
  household,
  onMomentChange,
}: {
  household: HouseholdFixture;
  onMomentChange: (value: MomentKey) => void;
}) {
  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">People</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {household.members.length} people share this household.
            </p>
          </div>
          <Button onClick={() => onMomentChange("invite")} size="sm">
            <UserPlusIcon /> Invite
          </Button>
        </div>
        <div className="divide-y border-y">
          {household.members.map((member) => (
            <MemberRow key={member.email} member={member} />
          ))}
          {household.invitations.map((invitation) => (
            <InvitationRow invitation={invitation} key={invitation.email} />
          ))}
        </div>
      </section>
      <aside>
        <ContextPrompt />
      </aside>
    </div>
  );
}

function HybridPeople({ household, moment, onMomentChange }: SurfaceProps) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">People & invitations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Roles and invitation state stay visible beside each person.
          </p>
        </div>
        {moment !== "invite" ? (
          <Button onClick={() => onMomentChange("invite")}>
            <UserPlusIcon /> Invite someone
          </Button>
        ) : null}
      </div>
      {moment === "invite" ? <InviteMoment household={household} /> : null}
      <div className="divide-y border-y">
        {household.members.map((member) => (
          <MemberRow key={member.email} member={member} showActions />
        ))}
        {household.invitations.map((invitation) => (
          <InvitationRow invitation={invitation} key={invitation.email} />
        ))}
      </div>
    </section>
  );
}

function HybridSettings({ household, moment, onMomentChange }: SurfaceProps) {
  if (moment === "departure") {
    return (
      <div className="flex flex-col gap-5">
        <Button
          className="-ml-2.5 w-fit"
          onClick={() => onMomentChange("settings")}
          size="sm"
          variant="ghost"
        >
          <ArrowLeftIcon /> Settings
        </Button>
        <DepartureMoment household={household} />
      </div>
    );
  }

  if (moment === "recovery") {
    return (
      <div className="flex flex-col gap-5">
        <Button
          className="-ml-2.5 w-fit"
          onClick={() => onMomentChange("settings")}
          size="sm"
          variant="ghost"
        >
          <ArrowLeftIcon /> Settings
        </Button>
        <RecoveryMoment />
      </div>
    );
  }

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Household identity, membership boundaries, and protected lifecycle actions.
        </p>
      </div>
      <div className="divide-y border-y">
        <LedgerAction label="Name" value={household.name} />
        <LedgerAction
          label="Roles and access"
          onClick={() => onMomentChange("manage")}
          value={`${household.members.filter((member) => member.role === "Owner").length} owners`}
        />
        <LedgerAction
          label="Leave this household"
          onClick={() => onMomentChange("departure")}
          value="Private records stay yours"
        />
        <LedgerAction
          label="Recovery and dissolution"
          onClick={() => onMomentChange("recovery")}
          value="Owner confirmation required"
        />
      </div>
    </section>
  );
}

function destinationForMoment(moment: MomentKey): HouseholdDestination {
  if (moment === "invite" || moment === "manage") return "people";
  if (moment === "settings" || moment === "departure" || moment === "recovery") {
    return "settings";
  }
  return "overview";
}

type SurfaceProps = {
  household: HouseholdFixture;
  moment: MomentKey;
  onMomentChange: (value: MomentKey) => void;
};

function CreateMoment({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="mx-auto flex max-w-lg flex-col gap-6 px-gutter py-9 sm:px-8">
      <div className="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <UsersRoundIcon className="size-5" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">A shared layer for the people you trust</h2>
        <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
          Your private Tendnote stays private. A household adds shared context without giving anyone
          access to your personal records.
        </p>
      </div>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Household name
        <input
          className="h-10 rounded-lg border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
          defaultValue="Nick & Mara"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onContinue}>Create household</Button>
        <Button variant="ghost">Cancel</Button>
      </div>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" /> You become the first Owner. You can invite
        someone now or later.
      </p>
    </section>
  );
}

function InviteMoment({ household }: { household: HouseholdFixture }) {
  const occupied = household.members.length + household.invitations.length;
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Invite someone</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          They’ll need to sign in with this verified email and choose to join.
        </p>
      </div>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Email address
        <input
          className="h-10 rounded-lg border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
          placeholder="name@example.com"
          type="email"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button>
          <MailIcon /> Send invitation
        </Button>
        <Button variant="ghost">Not now</Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {8 - occupied} of 8 seats available. Invitations reserve a seat for 14 days.
      </p>
    </section>
  );
}

function AcceptMoment({
  householdName,
  onContinue,
}: {
  householdName: string;
  onContinue: () => void;
}) {
  return (
    <section className="mx-auto flex max-w-lg flex-col gap-6 py-4">
      <div className="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <MailIcon className="size-5" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Invitation for sam@example.com</p>
        <h2 className="mt-1 text-xl font-semibold">Join {householdName}?</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          You’ll share household information with its members. Your private notes and personal
          context remain yours.
        </p>
      </div>
      <div className="rounded-xl border bg-surface p-4">
        <p className="text-sm font-medium">What joining changes</p>
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <CheckIcon className="mt-1 size-3.5 shrink-0 text-primary" /> See household context and
            shared records
          </li>
          <li className="flex gap-2">
            <LockIcon className="mt-1 size-3.5 shrink-0" /> No access to anyone’s private records
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onContinue}>Join household</Button>
        <Button variant="outline">Decline</Button>
      </div>
    </section>
  );
}

function ContextPrompt() {
  return (
    <section className="rounded-xl border bg-background p-4">
      <div className="flex size-8 items-center justify-center rounded-full bg-secondary">
        <ShieldCheckIcon className="size-4" />
      </div>
      <h2 className="mt-3 text-sm font-semibold">Add one thing everyone should know</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        A shared location or durable preference can help Eve orient to your household.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm">Add shared context</Button>
        <Button size="sm" variant="ghost">
          Not now
        </Button>
      </div>
    </section>
  );
}

function DepartureMoment({ household }: { household: HouseholdFixture }) {
  const current = household.members.find((member) => member.current);
  const otherOwners = household.members.filter(
    (member) => member.role === "Owner" && !member.current,
  );
  return (
    <section className="flex max-w-xl flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold">Leave {household.name}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Household access and anything you shared into it end immediately. Your private and
          member-owned records stay with you.
        </p>
      </div>
      <div className="rounded-xl border bg-surface p-4 text-sm">
        <p className="font-medium">Before you leave</p>
        <p className="mt-1 text-muted-foreground">
          {current?.role === "Owner" && otherOwners.length === 0
            ? "You’re the only Owner. Promote another member and have them accept before you can leave."
            : "You can only return with a fresh invitation."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={current?.role === "Owner" && otherOwners.length === 0}
          variant="destructive"
        >
          Leave household
        </Button>
        <Button variant="ghost">Keep my membership</Button>
      </div>
    </section>
  );
}

function RecoveryMoment() {
  return (
    <section className="flex max-w-xl flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold">Recovery and dissolution</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          These paths protect a household from one person taking control or deleting shared history.
        </p>
      </div>
      <div className="divide-y rounded-xl border bg-surface">
        <div className="p-4">
          <p className="text-sm font-medium">An Owner is inaccessible</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact support for an evidence-based recovery review. Other Owners cannot bypass
            consent.
          </p>
          <Button className="mt-3" size="sm" variant="outline">
            View recovery steps
          </Button>
        </div>
        <div className="p-4">
          <p className="text-sm font-medium">End this household</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every active Owner must confirm. Shared household records can be recovered for 30 days.
          </p>
          <Button className="mt-3" size="sm" variant="destructive">
            Start dissolution
          </Button>
        </div>
      </div>
    </section>
  );
}

function GuidedOverview({
  household,
  onMomentChange,
}: {
  household: HouseholdFixture;
  onMomentChange: (value: MomentKey) => void;
}) {
  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section>
        <h2 className="mb-3 text-base font-semibold">The people here</h2>
        <div className="divide-y border-y">
          {household.members.map((member) => (
            <MemberRow key={member.email} member={member} />
          ))}
        </div>
        <Button className="mt-4" onClick={() => onMomentChange("invite")}>
          <UserPlusIcon /> Invite someone
        </Button>
      </section>
      <ContextPrompt />
    </div>
  );
}

function GuidedManage({ household }: { household: HouseholdFixture }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Roles and membership</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Authority appears beside each person, not as a separate admin dashboard.
        </p>
      </div>
      <div className="divide-y border-y">
        {household.members.map((member) => (
          <MemberRow key={member.email} member={member} showActions />
        ))}
        {household.invitations.map((invitation) => (
          <InvitationRow invitation={invitation} key={invitation.email} />
        ))}
      </div>
    </section>
  );
}

function MemberRow({ member, showActions = false }: { member: Member; showActions?: boolean }) {
  return (
    <div
      className={cn(
        "min-h-16 gap-3 py-3",
        showActions
          ? "flex flex-col items-stretch sm:flex-row sm:items-center sm:justify-between"
          : "flex items-center justify-between",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground"
        >
          {member.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {member.name}
            {member.current ? " (you)" : ""}
          </p>
          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
        </div>
      </div>
      <div
        className={cn("flex shrink-0 items-center gap-2", showActions && "self-end sm:self-auto")}
      >
        <Badge variant={member.role === "Owner" ? "secondary" : "outline"}>{member.role}</Badge>
        {showActions && !member.current ? (
          <Button size="sm" variant="ghost">
            Manage
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function InvitationRow({ invitation }: { invitation: HouseholdFixture["invitations"][number] }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed">
          <ClockIcon className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{invitation.email}</p>
          <p className="text-xs text-muted-foreground">
            Invitation expires in {invitation.expires}
          </p>
        </div>
      </div>
      <Badge variant="outline">Pending</Badge>
    </div>
  );
}

function SeatCount({ household }: { household: HouseholdFixture }) {
  const occupied = household.members.length + household.invitations.length;
  return <span className="text-xs text-muted-foreground">{occupied} of 8 seats occupied</span>;
}

function LedgerHeading({ action, title }: { action?: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {action}
    </div>
  );
}

function LedgerAction({
  label,
  onClick,
  value,
}: {
  label: string;
  onClick?: () => void;
  value: string;
}) {
  return (
    <button
      className="flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
      onClick={onClick}
      type="button"
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {value}
        {onClick ? <ChevronRightIcon className="size-3.5" /> : null}
      </span>
    </button>
  );
}

function PrototypeSwitcher({
  current,
  onCycle,
  onSelect,
}: {
  current: VariantKey;
  onCycle: (delta: -1 | 1) => void;
  onSelect: (value: VariantKey) => void;
}) {
  const active = variants.find((item) => item.key === current) ?? variants[0];
  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground p-1.5 text-background shadow-[0_8px_24px_rgb(0_0_0/0.22)] md:bottom-5">
      <button
        aria-label="Previous variant"
        className="flex size-8 items-center justify-center rounded-full outline-none hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-background"
        onClick={() => onCycle(-1)}
        type="button"
      >
        <ArrowLeftIcon className="size-4" />
      </button>
      <label className="sr-only" htmlFor="prototype-variant">
        Prototype variant
      </label>
      <select
        className="h-8 min-w-44 appearance-none bg-transparent px-2 text-center text-sm font-medium outline-none"
        id="prototype-variant"
        onChange={(event) => onSelect(parseVariant(event.target.value))}
        value={active.key}
      >
        {variants.map((item) => (
          <option className="bg-foreground text-background" key={item.key} value={item.key}>
            {item.key} — {item.name}
          </option>
        ))}
      </select>
      <button
        aria-label="Next variant"
        className="flex size-8 items-center justify-center rounded-full outline-none hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-background"
        onClick={() => onCycle(1)}
        type="button"
      >
        <ArrowRightIcon className="size-4" />
      </button>
    </div>
  );
}

function parseVariant(value: string | null): VariantKey {
  return variants.some((item) => item.key === value) ? (value as VariantKey) : "A";
}

function parseMoment(value: string | null): MomentKey {
  return moments.some((item) => item.key === value) ? (value as MomentKey) : "overview";
}

function parseScenario(value: string | null): ScenarioKey {
  return value === "roommates" ? "roommates" : "couple";
}
