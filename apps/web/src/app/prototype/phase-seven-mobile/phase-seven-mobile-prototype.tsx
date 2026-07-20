"use client";

// PROTOTYPE — throwaway Phase Seven mobile shell exploration.
// Three structural treatments plus the selected hybrid, switchable via ?variant=S|A|B|C.

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleUserRoundIcon,
  Clock3Icon,
  CornerDownLeftIcon,
  EllipsisIcon,
  HomeIcon,
  ListChecksIcon,
  MenuIcon,
  MessageCircleIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Variant = "S" | "A" | "B" | "C";

type TodayItem = {
  id: string;
  kind: string;
  title: string;
  context: string;
  reason: string;
  action: string;
  icon: typeof Clock3Icon;
};

const variants: Array<{ key: Variant; name: string }> = [
  { key: "S", name: "Selected hybrid" },
  { key: "A", name: "Open notebook" },
  { key: "B", name: "Quiet workbench" },
  { key: "C", name: "Personal ledger" },
];

const todayItems: TodayItem[] = [
  {
    id: "water-filter",
    kind: "Routine",
    title: "Replace the refrigerator water filter",
    context: "Home · every six months",
    reason: "Due today",
    action: "Complete",
    icon: RotateCwIcon,
  },
  {
    id: "maya",
    kind: "Follow-Up",
    title: "Check in with Maya about her new role",
    context: "Maya Chen · friend",
    reason: "You asked to be reminded today",
    action: "Done",
    icon: CircleUserRoundIcon,
  },
  {
    id: "washer-warranty",
    kind: "Review",
    title: "Confirm the washer warranty date",
    context: "Washer · captured from a receipt",
    reason: "Waiting for review for four days",
    action: "Review",
    icon: ListChecksIcon,
  },
];

export function PhaseSevenMobilePrototype({ initialVariant }: { initialVariant: Variant }) {
  const [variant, setVariant] = useState(initialVariant);
  const [activeOverlay, setActiveOverlay] = useState<"eve" | "search" | "capture" | null>(null);

  function selectVariant(next: Variant) {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState({}, "", url);
  }

  function cycle(direction: -1 | 1) {
    const current = variants.findIndex((candidate) => candidate.key === variant);
    const next = variants[(current + direction + variants.length) % variants.length];
    selectVariant(next?.key ?? "S");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) {
        return;
      }
      if (event.key === "ArrowLeft") {
        cycle(-1);
      }
      if (event.key === "ArrowRight") {
        cycle(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto min-h-dvh w-full max-w-md overflow-hidden bg-background sm:border-x">
        {variant === "S" ? <SelectedHybrid onOpen={setActiveOverlay} /> : null}
        {variant === "A" ? <OpenNotebook onOpen={setActiveOverlay} /> : null}
        {variant === "B" ? <QuietWorkbench onOpen={setActiveOverlay} /> : null}
        {variant === "C" ? <PersonalLedger onOpen={setActiveOverlay} /> : null}
      </div>

      <PrototypeSwitcher current={variant} onCycle={cycle} />
      <EveOverlay
        open={activeOverlay === "eve"}
        onOpenChange={(open) => setActiveOverlay(open ? "eve" : null)}
      />
      <SearchOverlay
        open={activeOverlay === "search"}
        onOpenChange={(open) => setActiveOverlay(open ? "search" : null)}
      />
      <CaptureOverlay
        open={activeOverlay === "capture"}
        onOpenChange={(open) => setActiveOverlay(open ? "capture" : null)}
      />
    </main>
  );
}

function SelectedHybrid({ onOpen }: { onOpen: (overlay: "eve" | "search" | "capture") => void }) {
  return (
    <MobileFrame onOpen={onOpen}>
      <div className="bg-panel px-5 pt-5 pb-6">
        <TodayHeader />
        <button
          className="mt-6 flex min-h-28 w-full flex-col justify-between gap-4 rounded-xl border bg-background p-4 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          data-testid="eve-composer"
          onClick={() => onOpen("eve")}
          type="button"
        >
          <span className="text-sm text-muted-foreground">Ask Eve anything…</span>
          <span className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">
              Questions stay conversational unless you ask to save.
            </span>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CornerDownLeftIcon aria-hidden className="size-4" />
            </span>
          </span>
        </button>
      </div>
      <section aria-labelledby="selected-hybrid-today" className="px-5 pt-6">
        <ShortlistHeading id="selected-hybrid-today" />
        <ol>
          {todayItems.map((item) => (
            <PersonalLedgerRow item={item} key={item.id} />
          ))}
        </ol>
      </section>
    </MobileFrame>
  );
}

function OpenNotebook({ onOpen }: { onOpen: (overlay: "eve" | "search" | "capture") => void }) {
  return (
    <MobileFrame onOpen={onOpen}>
      <div className="flex flex-col gap-7 px-5 pt-5">
        <TodayHeader />
        <button
          className="flex min-h-28 w-full flex-col justify-between gap-4 rounded-xl border bg-background p-4 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          data-testid="eve-composer"
          onClick={() => onOpen("eve")}
          type="button"
        >
          <span className="text-sm text-muted-foreground">Ask Eve anything…</span>
          <span className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">
              Questions stay conversational unless you ask to save.
            </span>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CornerDownLeftIcon aria-hidden className="size-4" />
            </span>
          </span>
        </button>
        <section aria-labelledby="open-notebook-today">
          <ShortlistHeading id="open-notebook-today" />
          <ul className="divide-y">
            {todayItems.map((item) => (
              <OpenNotebookRow item={item} key={item.id} />
            ))}
          </ul>
        </section>
      </div>
    </MobileFrame>
  );
}

function OpenNotebookRow({ item }: { item: TodayItem }) {
  const Icon = item.icon;
  return (
    <li className="flex gap-3 py-5 first:pt-3">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {item.kind} · {item.context}
          </span>
          <h2 className="text-[length:var(--text-title)] font-medium leading-[var(--text-title-line)]">
            {item.title}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock3Icon aria-hidden className="size-3.5" />
            {item.reason}
          </p>
        </div>
        <ItemActions item={item} />
      </div>
    </li>
  );
}

function QuietWorkbench({ onOpen }: { onOpen: (overlay: "eve" | "search" | "capture") => void }) {
  return (
    <MobileFrame onOpen={onOpen}>
      <div className="bg-panel px-5 pt-5 pb-6">
        <TodayHeader />
        <button
          className="mt-6 flex min-h-24 w-full items-end gap-3 rounded-xl bg-background p-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          data-testid="eve-composer"
          onClick={() => onOpen("eve")}
          type="button"
        >
          <span className="min-w-0 flex-1 self-center px-1 text-sm text-muted-foreground">
            Ask Eve anything…
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SendIcon aria-hidden className="size-4" />
          </span>
        </button>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          Conversational by default · say “remember” to save
        </p>
      </div>
      <section aria-labelledby="quiet-workbench-today" className="px-5 pt-6">
        <ShortlistHeading id="quiet-workbench-today" />
        <div className="overflow-hidden rounded-xl border bg-background">
          <ul className="divide-y">
            {todayItems.map((item) => (
              <QuietWorkbenchRow item={item} key={item.id} />
            ))}
          </ul>
        </div>
      </section>
    </MobileFrame>
  );
}

function QuietWorkbenchRow({ item }: { item: TodayItem }) {
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-primary">{item.reason}</span>
          <h2 className="text-base font-medium leading-6">{item.title}</h2>
          <p className="text-sm text-muted-foreground">{item.context}</p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">
          {item.kind}
        </span>
      </div>
      <ItemActions item={item} />
    </li>
  );
}

function PersonalLedger({ onOpen }: { onOpen: (overlay: "eve" | "search" | "capture") => void }) {
  return (
    <MobileFrame onOpen={onOpen}>
      <div className="px-5 pt-5">
        <TodayHeader />
        <button
          className="mt-5 flex min-h-14 w-full items-center gap-3 border-y py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          data-testid="eve-composer"
          onClick={() => onOpen("eve")}
          type="button"
        >
          <MessageCircleIcon aria-hidden className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Ask Eve</span>
            <span className="block truncate text-xs text-muted-foreground">
              Recall, plan, or ask to save something
            </span>
          </span>
          <ArrowRightIcon aria-hidden className="size-4 text-muted-foreground" />
        </button>
      </div>
      <section aria-labelledby="personal-ledger-today" className="px-5 pt-7">
        <ShortlistHeading id="personal-ledger-today" />
        <ol>
          {todayItems.map((item) => (
            <PersonalLedgerRow item={item} key={item.id} />
          ))}
        </ol>
      </section>
    </MobileFrame>
  );
}

function PersonalLedgerRow({ item }: { item: TodayItem }) {
  const Icon = item.icon;
  return (
    <li className="grid grid-cols-[5.25rem_minmax(0,1fr)] border-t py-5">
      <div className="flex flex-col items-start gap-2 pr-3 text-xs text-muted-foreground">
        <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon aria-hidden className="size-4" />
        </span>
        <span>{item.kind}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium leading-6">{item.title}</h2>
          <p className="text-sm text-muted-foreground">{item.context}</p>
          <p className="text-sm text-foreground">{item.reason}</p>
        </div>
        <ItemActions item={item} />
      </div>
    </li>
  );
}

function TodayHeader() {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)]">
          Today
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Monday, July 20</p>
      </div>
      <Button aria-label="Refresh Today" size="icon-lg" variant="ghost">
        <RotateCwIcon />
      </Button>
    </header>
  );
}

function ShortlistHeading({ id }: { id: string }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold" id={id}>
          Worth your attention
        </h2>
        <p className="text-xs text-muted-foreground">Three grounded reasons for today</p>
      </div>
      <button
        className="min-h-11 text-xs text-muted-foreground underline-offset-4 hover:underline"
        type="button"
      >
        Why these?
      </button>
    </div>
  );
}

function ItemActions({ item }: { item: TodayItem }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="lg" variant="secondary">
        {item.action}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`More actions for ${item.title}`}
            data-testid="today-item-more"
            size="icon-lg"
            variant="ghost"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem>Open record</DropdownMenuItem>
            <DropdownMenuItem>Later…</DropdownMenuItem>
            <DropdownMenuItem>Not today</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MobileFrame({
  children,
  onOpen,
}: {
  children: React.ReactNode;
  onOpen: (overlay: "eve" | "search" | "capture") => void;
}) {
  return (
    <div className="relative min-h-dvh pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomBar onOpen={onOpen} />
    </div>
  );
}

function BottomBar({ onOpen }: { onOpen: (overlay: "eve" | "search" | "capture") => void }) {
  return (
    <nav
      aria-label="Prototype primary navigation"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto grid w-full max-w-md grid-cols-5 border-t bg-background/98 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:border-x"
    >
      <NavButton active icon={HomeIcon} label="Today" />
      <NavButton
        icon={SearchIcon}
        label="Search"
        onClick={() => onOpen("search")}
        testId="nav-search"
      />
      <NavButton
        emphasized
        icon={PlusIcon}
        label="Capture"
        onClick={() => onOpen("capture")}
        testId="nav-capture"
      />
      <NavButton icon={ListChecksIcon} label="Review" />
      <NavButton icon={MenuIcon} label="Menu" />
    </nav>
  );
}

function NavButton({
  active = false,
  emphasized = false,
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  active?: boolean;
  emphasized?: boolean;
  icon: typeof HomeIcon;
  label: string;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-lg",
          emphasized && "bg-primary text-primary-foreground",
        )}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <span className={cn(emphasized && "font-medium text-foreground")}>{label}</span>
    </button>
  );
}

function PrototypeSwitcher({
  current,
  onCycle,
}: {
  current: Variant;
  onCycle: (direction: -1 | 1) => void;
}) {
  const currentVariant = variants.find((variant) => variant.key === current) ??
    variants[0] ?? {
      key: "S" as const,
      name: "Selected hybrid",
    };
  return (
    <div className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground p-1 text-background shadow-md">
      <button
        aria-label="Previous prototype variant"
        className="flex size-10 items-center justify-center rounded-full hover:bg-background/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
        onClick={() => onCycle(-1)}
        type="button"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
      </button>
      <span className="min-w-36 text-center text-xs font-medium">
        {currentVariant.key} — {currentVariant.name}
      </span>
      <button
        aria-label="Next prototype variant"
        className="flex size-10 items-center justify-center rounded-full hover:bg-background/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
        onClick={() => onCycle(1)}
        type="button"
      >
        <ArrowRightIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

function FullScreenDialog({
  children,
  description,
  open,
  onOpenChange,
  title,
}: {
  children: React.ReactNode;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="inset-0 top-0 left-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:inset-y-3 sm:left-1/2 sm:h-[calc(100dvh-1.5rem)] sm:max-w-md sm:-translate-x-1/2 sm:rounded-xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function OverlayHeader({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <header className="flex min-h-14 items-center gap-2 border-b px-3 pt-[env(safe-area-inset-top)]">
      <Button aria-label="Back to Today" onClick={onClose} size="icon-lg" variant="ghost">
        <ArrowLeftIcon />
      </Button>
      <h2 className="text-base font-semibold">{label}</h2>
    </header>
  );
}

function EveOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <FullScreenDialog
      description="A focused Eve conversation that returns to Today."
      open={open}
      onOpenChange={onOpenChange}
      title="Eve"
    >
      <OverlayHeader label="Eve" onClose={() => onOpenChange(false)} />
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-5 overflow-y-auto px-5 py-6">
        <div className="max-w-[85%] self-end rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground">
          What do I need to know about the washer warranty?
        </div>
        <div className="flex max-w-[90%] flex-col gap-3">
          <p className="text-sm leading-6">
            You captured a receipt for the washer four days ago, but its warranty date is still
            waiting for review.
          </p>
          <div className="rounded-xl border bg-surface p-4">
            <p className="text-sm font-medium">Washer warranty</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Receipt captured July 16 · date needs confirmation
            </p>
            <Button className="mt-3" size="lg" variant="secondary">
              Review receipt
            </Button>
          </div>
          <button
            className="w-fit text-xs text-muted-foreground underline-offset-4 hover:underline"
            type="button"
          >
            Why this answer?
          </button>
        </div>
      </div>
      <div className="border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex min-h-14 items-end gap-2 rounded-xl border bg-background p-2">
          <Button aria-label="Add attachment" size="icon-lg" variant="ghost">
            <PaperclipIcon />
          </Button>
          <textarea
            aria-label="Message Eve"
            className="min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Ask a follow-up…"
            rows={1}
          />
          <Button aria-label="Send message" size="icon-lg">
            <SendIcon />
          </Button>
        </div>
      </div>
    </FullScreenDialog>
  );
}

function SearchOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("Maya");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <FullScreenDialog
      description="Owner-scoped structured Global Recall results."
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
    >
      <OverlayHeader label="Search" onClose={() => onOpenChange(false)} />
      <div className="flex flex-col gap-5 px-5 py-5">
        <label className="sr-only" htmlFor={inputId}>
          Search Tendnote
        </label>
        <div className="flex min-h-12 items-center gap-2 rounded-xl border px-3 focus-within:ring-3 focus-within:ring-ring/35">
          <SearchIcon aria-hidden className="size-4 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            id={inputId}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people, actions, assets…"
            ref={inputRef}
            value={query}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="flex size-11 items-center justify-center text-muted-foreground"
              onClick={() => setQuery("")}
              type="button"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            className="min-h-11 shrink-0 rounded-full bg-foreground px-4 text-sm text-background"
            type="button"
          >
            All
          </button>
          <button className="min-h-11 shrink-0 rounded-full border px-4 text-sm" type="button">
            People
          </button>
          <button className="min-h-11 shrink-0 rounded-full border px-4 text-sm" type="button">
            Active
          </button>
          <button
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-4 text-sm"
            type="button"
          >
            More <ChevronDownIcon aria-hidden className="size-3.5" />
          </button>
        </div>
        {query ? (
          <SearchResults />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Search across the records visible to you.
          </p>
        )}
      </div>
    </FullScreenDialog>
  );
}

function SearchResults() {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Exact matches</h3>
        <button
          className="flex min-h-20 w-full flex-col justify-center border-y py-3 text-left"
          type="button"
        >
          <span className="text-sm font-medium">Maya Chen</span>
          <span className="text-sm text-muted-foreground">
            Friend · starts a new role next week
          </span>
          <span className="mt-1 text-xs text-muted-foreground">
            Person · from a note you captured July 12
          </span>
        </button>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Related matches</h3>
        <button
          className="flex min-h-20 w-full flex-col justify-center border-y py-3 text-left"
          type="button"
        >
          <span className="text-sm font-medium">Check in about the new role</span>
          <span className="text-sm text-muted-foreground">Follow-Up with Maya · due today</span>
          <span className="mt-1 text-xs text-muted-foreground">
            Related by meaning · grounded in Maya’s record
          </span>
        </button>
        <button
          className="mt-2 min-h-11 text-xs text-muted-foreground underline-offset-4 hover:underline"
          type="button"
        >
          Why this result?
        </button>
      </section>
    </div>
  );
}

function CaptureOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState("Remember to ask Maya how her first week went next Friday");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && !saved) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, saved]);

  return (
    <FullScreenDialog
      description="Explicit conversational capture with a compact routed confirmation."
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSaved(false);
        onOpenChange(nextOpen);
      }}
      title="Capture"
    >
      <OverlayHeader label="Capture" onClose={() => onOpenChange(false)} />
      <div className="flex min-h-0 flex-1 flex-col px-5 py-6">
        {saved ? (
          <div className="flex flex-1 flex-col justify-center gap-6">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <CheckIcon aria-hidden className="size-5" />
            </span>
            <div>
              <h3 className="text-xl font-semibold">Saved as a Follow-Up</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Check in with Maya about her first week · Friday, July 24
              </p>
            </div>
            <div className="rounded-xl border bg-surface p-4">
              <p className="text-xs text-muted-foreground">Grounded in this capture</p>
              <p className="mt-1 text-sm">“{value}”</p>
            </div>
            <div className="flex gap-2">
              <Button size="lg" variant="outline">
                Edit
              </Button>
              <Button size="lg" variant="ghost">
                Undo
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-1 flex-col gap-3">
              <label className="text-sm font-medium" htmlFor="capture-prototype-input">
                What should Tendnote keep?
              </label>
              <textarea
                className="min-h-40 resize-none rounded-xl border bg-background p-4 text-base leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
                id="capture-prototype-input"
                onChange={(event) => setValue(event.target.value)}
                placeholder="Capture a note, reminder, link, or open question…"
                ref={inputRef}
                value={value}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Capture means save. Eve will route clear intent directly and ask only when a
                consequential detail is missing.
              </p>
              <div className="flex gap-2">
                <Button size="lg" variant="ghost">
                  <MicIcon data-icon="inline-start" />
                  Dictate
                </Button>
                <Button size="lg" variant="ghost">
                  <PaperclipIcon data-icon="inline-start" />
                  Attach
                </Button>
              </div>
            </div>
            <Button
              className="min-h-12 w-full"
              disabled={!value.trim()}
              onClick={() => setSaved(true)}
              size="lg"
            >
              Save capture
            </Button>
          </>
        )}
      </div>
    </FullScreenDialog>
  );
}
