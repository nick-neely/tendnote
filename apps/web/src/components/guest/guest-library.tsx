import type {
  GuestLibrary,
  GuestLibraryDomain,
  GuestLibraryRecord,
  GuestLibraryShelf,
} from "@tendnote/domain/guest-library";
import { TendnoteLogo } from "@tendnote/ui/tendnote-logo";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccountIdentity } from "@/components/account/account-identity";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ShelfStripScroller } from "@/components/guest/shelf-strip-scroller";
import {
  ArrowLeftIcon,
  BoxIcon,
  CalendarIcon,
  ClockIcon,
  EyeIcon,
  GiftIcon,
  HomeIcon,
  type Icon,
  ListTodoIcon,
  StickyNoteIcon,
  UsersRoundIcon,
} from "@/components/icons";
import { ServiceNotice } from "@/components/service-notice-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { GUEST_PATH, type SessionUser } from "@/lib/access/access-state";
import {
  formatGuestDate,
  GUEST_SHELF_COPY,
  guestLibraryHref,
  guestOwnerLabel,
  guestReasonCopy,
  orderedRecords,
} from "@/lib/household/guest-library-view";
import { cn } from "@/lib/utils";

const SHELF_ICON: Record<GuestLibraryDomain, Icon> = {
  people: UsersRoundIcon,
  memories: StickyNoteIcon,
  followUps: ClockIcon,
  generalActions: ListTodoIcon,
  assets: BoxIcon,
  giftPlans: GiftIcon,
  householdContext: HomeIcon,
  calendarEvents: CalendarIcon,
};

const SMALL = "text-[length:var(--text-small)] leading-[var(--text-small-line)]";
const TITLE = "text-[length:var(--text-title)] leading-[var(--text-title-line)]";

/** The persistent read-only band: whose household this is, and the only way to subscribe. */
function GuestBand({
  householdName,
  canSubscribe,
}: {
  householdName: string;
  canSubscribe: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-gutter py-3 sm:px-6 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex items-center justify-between gap-3 lg:contents">
          <TendnoteLogo size="header" className="lg:order-1" />
          <div className="flex items-center gap-1 lg:order-3 lg:ml-auto">
            {canSubscribe ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`${GUEST_PATH}/subscribe`}>Subscribe</Link>
              </Button>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
        <p
          className={cn(
            SMALL,
            "flex min-w-0 items-start gap-2 text-muted-foreground text-pretty lg:order-2 lg:items-center",
          )}
        >
          <EyeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary lg:mt-0" />
          <span>
            <span className="font-medium text-foreground">Read-only.</span> You're a guest of{" "}
            <span className="font-medium text-foreground">{householdName}</span>. These records
            belong to its members.
          </span>
        </p>
      </div>
    </header>
  );
}

function shelfCount(shelf: GuestLibraryShelf): string {
  return shelf.unavailable ? "–" : String(shelf.records.length);
}

/** One link per read-set domain, each with its count. A domain with nothing in it says zero. */
function ShelfNav({
  shelves,
  current,
}: {
  shelves: GuestLibraryShelf[];
  current: GuestLibraryDomain;
}) {
  return (
    <nav aria-label="Household records" className="lg:col-start-1 lg:row-start-1">
      <ShelfStripScroller current={current}>
        <ul className="mx-bleed flex gap-1 overflow-x-auto px-gutter pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
          {shelves.map((shelf) => {
            const ShelfIcon = SHELF_ICON[shelf.domain];
            const selected = shelf.domain === current;
            return (
              <li key={shelf.domain} className="shrink-0">
                <Link
                  href={guestLibraryHref(shelf.domain)}
                  data-shelf={shelf.domain}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    SMALL,
                    "flex items-center gap-2 rounded-md border px-3 py-1.5 whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 lg:border-transparent lg:px-2.5",
                    selected
                      ? "border-primary/30 bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <ShelfIcon
                    aria-hidden
                    className={cn("size-4 shrink-0", selected ? "text-primary" : undefined)}
                  />
                  <span className="lg:flex-1">{GUEST_SHELF_COPY[shelf.domain].label}</span>
                  <span className="font-mono text-[length:var(--text-caption)] tabular-nums">
                    <span className="sr-only">, </span>
                    {shelfCount(shelf)}
                    {shelf.unavailable ? <span className="sr-only"> (unavailable)</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </ShelfStripScroller>
    </nav>
  );
}

function recordMeta(domain: GuestLibraryDomain, record: GuestLibraryRecord): string {
  const parts = [record.context];
  if (domain !== "people" && domain !== "calendarEvents") parts.push(guestOwnerLabel(record));
  if (record.date && domain !== "calendarEvents") parts.push(formatGuestDate(record.date));
  return parts.filter(Boolean).join(" · ");
}

function ShelfList({
  shelf,
  selectedId,
  hiddenOnPhone,
}: {
  shelf: GuestLibraryShelf;
  selectedId: string | null;
  hiddenOnPhone: boolean;
}) {
  const copy = GUEST_SHELF_COPY[shelf.domain];
  const records = orderedRecords(shelf);
  return (
    <section
      aria-labelledby="guest-shelf-heading"
      className={cn(
        "mt-5 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0",
        hiddenOnPhone && "hidden lg:block",
      )}
    >
      <h2
        id="guest-shelf-heading"
        className="flex items-baseline gap-2 text-[length:var(--text-h2)] leading-[var(--text-h2-line)] font-semibold"
      >
        {copy.label}
        <span className="font-mono text-[length:var(--text-small)] font-normal text-muted-foreground tabular-nums">
          {shelfCount(shelf)}
        </span>
      </h2>
      {shelf.unavailable ? (
        <p className={cn(SMALL, "mt-3 text-muted-foreground")} role="status">
          This couldn't be read just now. Try again in a moment.
        </p>
      ) : records.length === 0 ? (
        <p className={cn(SMALL, "mt-3 text-muted-foreground")}>{copy.empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col border-t">
          {records.map((record) => {
            const selected = record.id === selectedId;
            return (
              <li key={record.id} className="border-b">
                <Link
                  href={guestLibraryHref(shelf.domain, record.id)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "-mx-2 my-1 flex flex-col gap-0.5 rounded-md px-2 py-2 outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected ? "bg-primary/10" : "hover:bg-muted",
                  )}
                >
                  <span className={cn(TITLE, "line-clamp-2 font-medium text-pretty")}>
                    {record.title}
                  </span>
                  <span className={cn(SMALL, "line-clamp-1 text-muted-foreground")}>
                    {recordMeta(shelf.domain, record)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LedgerRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-t py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className={cn(SMALL, "text-muted-foreground")}>{term}</dt>
      <dd className={cn(SMALL, "text-foreground")}>{children}</dd>
    </div>
  );
}

/** One record, with its provenance: whose it is, why the guest can see it, its date, and the right. */
function RecordDetail({
  domain,
  record,
}: {
  domain: GuestLibraryDomain;
  record: GuestLibraryRecord;
}) {
  const copy = GUEST_SHELF_COPY[domain];
  return (
    <article aria-labelledby="guest-record-heading" className="flex flex-col">
      <Link
        href={guestLibraryHref(domain)}
        className={cn(
          SMALL,
          "-ml-1 mb-4 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden",
        )}
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        All {copy.label.toLowerCase()}
      </Link>
      <h2
        id="guest-record-heading"
        className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold text-balance"
      >
        {record.title}
      </h2>
      {record.context ? (
        <p className={cn(SMALL, "mt-1 text-muted-foreground")}>{record.context}</p>
      ) : null}
      {record.body ? (
        <p className="mt-4 max-w-prose text-[length:var(--text-body)] leading-[var(--text-body-line)] whitespace-pre-line text-pretty">
          {record.body}
        </p>
      ) : null}
      <dl className="mt-6 border-b">
        {/* A member is a person in the household, not something it owns. */}
        {domain === "people" ? null : (
          <LedgerRow term="Belongs to">{guestOwnerLabel(record)}</LedgerRow>
        )}
        <LedgerRow term="Why you can see it">{guestReasonCopy(domain, record)}</LedgerRow>
        {copy.dateLabel ? (
          <LedgerRow term={copy.dateLabel}>
            {record.date ? (
              <time dateTime={record.date.toISOString()}>{formatGuestDate(record.date)}</time>
            ) : (
              "No date"
            )}
          </LedgerRow>
        ) : null}
        <LedgerRow term="Your access">
          <span className="inline-flex items-center gap-1.5">
            <EyeIcon aria-hidden className="size-4 text-primary" />
            Read only
          </span>
        </LedgerRow>
      </dl>
    </article>
  );
}

function DetailPane({
  shelf,
  record,
}: {
  shelf: GuestLibraryShelf;
  record: GuestLibraryRecord | null;
}) {
  const copy = GUEST_SHELF_COPY[shelf.domain];
  return (
    <section
      aria-label="Record"
      className={cn(
        "mt-5 min-w-0 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:border-l lg:pl-8",
        !record && "hidden lg:block",
      )}
    >
      {record ? (
        <RecordDetail domain={shelf.domain} record={record} />
      ) : (
        <div className="flex flex-col gap-1 pt-1">
          <p className={cn(TITLE, "font-medium")}>{copy.about}</p>
          {shelf.records.length > 0 ? (
            <p className={cn(SMALL, "text-muted-foreground")}>Choose one to read it.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** The guest's own exits: who is signed in, sign out, and delete. Never blocked. */
function AccountExits({ user }: { user: SessionUser }) {
  return (
    <section
      aria-label="Your account"
      className="mt-10 flex flex-col gap-3 border-t pt-6 lg:col-start-1 lg:row-start-2 lg:mt-8 lg:self-end"
    >
      <AccountIdentity user={user} />
      <div className="flex flex-col gap-1 sm:max-w-xs lg:max-w-none">
        <SignOutButton className="w-full" />
        <DeleteAccountButton email={user.email} />
      </div>
    </section>
  );
}

/**
 * The Household Guest's read-only library (#636): its own chrome, never the
 * app shell. A shelf per read-set domain with its count, a list, and a detail
 * that states provenance. Selection lives in the URL, so the library works as
 * plain links on every device and the back button moves through it.
 *
 * Nothing here can change a record, and no paid feature is shown, locked or
 * otherwise. The one way into the rest of Tendnote is the band's Subscribe.
 */
export function GuestLibraryView({
  library,
  shelf,
  record,
  user,
  canSubscribe,
}: {
  library: GuestLibrary;
  shelf: GuestLibraryShelf;
  record: GuestLibraryRecord | null;
  user: SessionUser;
  canSubscribe: boolean;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <ServiceNotice />
      <GuestBand householdName={library.householdName} canSubscribe={canSubscribe} />
      <main className="mx-auto w-full max-w-6xl px-gutter py-5 sm:px-6 lg:grid lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[13rem_minmax(0,22rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:py-8">
        <ShelfNav shelves={library.shelves} current={shelf.domain} />
        <ShelfList shelf={shelf} selectedId={record?.id ?? null} hiddenOnPhone={record !== null} />
        <DetailPane shelf={shelf} record={record} />
        <AccountExits user={user} />
      </main>
    </div>
  );
}
