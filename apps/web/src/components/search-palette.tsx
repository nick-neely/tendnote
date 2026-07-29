"use client";

import type {
  GlobalRecallFamily,
  GlobalRecallFilter,
  GlobalRecallMatchKind,
  GlobalRecallResponse,
} from "@tendnote/domain/global-recall";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { appDestination, destinationsInGroup } from "@/components/app-destinations";
import {
  BellIcon,
  BookmarkIcon,
  BookUserIcon,
  BoxIcon,
  CalendarIcon,
  CircleDotIcon,
  type Icon,
  MonitorIcon,
  MoonIcon,
  NotebookPenIcon,
  PlusIcon,
  SearchIcon,
  StickyNoteIcon,
  SunIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recallResultLines } from "@/lib/recall-result-lines";
import { type GlobalRecallHandler, useGlobalRecall } from "@/lib/use-global-recall";
import { useWideViewport } from "@/lib/use-wide-viewport";

/**
 * The desktop command palette: one keyboard-first surface for recall and for the
 * handful of places and settings the owner reaches for by name.
 *
 * Search on desktop used to be nowhere - the phone owned it through the bottom
 * bar's full-screen flow, and a pointer-and-mouse session had no way in at all.
 * The answer is not a second search box in the header but the shape this product
 * already promises (PRODUCT.md: "keyboard-reachable, instant recall"): Cmd+K from
 * anywhere, a quiet header affordance for the people who have not learned the key
 * yet, and one list that answers both "where is that thing I saved" and "take me
 * to Assets".
 *
 * Two rules keep it a notebook's command menu rather than a launcher clone:
 *   - The default view *is* the teaching. With no query it shows Quick actions,
 *     Go to, and Appearance, so opening it explains itself without an empty state
 *     lecturing about what could be typed.
 *   - Nothing here leaves the app or destroys anything. No send, no draft-to-Gmail,
 *     no archive, no delete. Outbound and destructive work stays on the approval
 *     surfaces that can show what is about to happen (DESIGN.md §2).
 *
 * It is desktop-only on purpose: below `lg` the phone shell's Search flow owns
 * recall, so the palette never mounts there and the hotkey never binds.
 */

export function SearchPalette({ search }: { search: GlobalRecallHandler }) {
  const [open, setOpen] = useState(false);
  const wide = useWideViewport();
  usePaletteHotkey({ enabled: wide, setOpen });

  return (
    <>
      <SearchPaletteTrigger onOpen={() => setOpen(true)} />
      {wide ? <SearchPaletteDialog onOpenChange={setOpen} open={open} search={search} /> : null}
    </>
  );
}

/**
 * Cmd+K / Ctrl+K, bound once at the shell for admitted routes.
 *
 * Binding it per surface would mean every destination racing to register the same
 * key; binding it here means one listener for the whole admitted app. It toggles
 * rather than only opening, so the same keystroke that summoned the palette
 * dismisses it.
 */
function usePaletteHotkey({
  enabled,
  setOpen,
}: {
  enabled: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || event.altKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, setOpen]);
}

/**
 * The header affordance. Ghost weight and muted ink so it reads as a tool beside
 * the theme control rather than a seventh destination, with the shortcut shown as
 * a machine fact in mono (DESIGN.md §4). The key hint is `aria-hidden` because
 * `aria-keyshortcuts` already tells assistive tech the same thing without
 * lengthening the button's name.
 */
function SearchPaletteTrigger({ onOpen }: { onOpen: () => void }) {
  const shortcut = usePlatformShortcutLabel();
  return (
    <Button
      // The visible word is "Search"; the name says which search, so it is not
      // confused with the phone bar's Search control by anyone listening rather
      // than looking. Containing the visible label keeps WCAG 2.5.3 satisfied.
      aria-label="Search Tendnote"
      aria-keyshortcuts="Meta+K Control+K"
      className="text-muted-foreground hover:text-foreground"
      onClick={onOpen}
      variant="ghost"
    >
      <SearchIcon aria-hidden data-icon="inline-start" />
      Search
      <kbd
        aria-hidden
        className="rounded border bg-muted px-1 py-px font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground"
      >
        {shortcut}
      </kbd>
    </Button>
  );
}

/**
 * The glyph the owner's keyboard actually carries. Starts on the Mac form so the
 * server and first client render agree, then corrects itself after mount.
 */
function usePlatformShortcutLabel() {
  const [mac, setMac] = useState(true);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad|iPod/i.test(window.navigator.userAgent));
  }, []);
  return mac ? "⌘K" : "Ctrl K";
}

/**
 * Composed from the Dialog primitives rather than `CommandDialog`, which renders
 * its `DialogHeader` as a sibling of `DialogContent` - that leaves an sr-only
 * heading loose in the page whether or not the palette is open. Same shape,
 * accessible name kept inside the dialog where it belongs. `ui/command.tsx` stays
 * registry-verbatim.
 */
function SearchPaletteDialog({
  onOpenChange,
  open,
  search,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  search: GlobalRecallHandler;
}) {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const [query, setQuery] = useState("");
  const recall = useGlobalRecall({ query, search });

  function close() {
    // A closed palette is a fresh one: the command menu is the default view, and
    // reopening onto a stale query would hide it behind old results. The filters
    // are a deliberate setting, so those survive.
    setQuery("");
    onOpenChange(false);
  }

  const commandGroups = useMemo(
    () => paletteCommandGroups({ navigate: (href) => router.push(href), setTheme, theme }),
    [router, setTheme, theme],
  );
  const matchingGroups = useMemo(
    () =>
      commandGroups.flatMap((group) => {
        const matching = filterCommandGroup(group, query);
        return matching ? [matching] : [];
      }),
    [commandGroups, query],
  );

  const recallGroups = useMemo(() => groupResultsByFamily(recall.response), [recall.response]);
  const showRecall = query.trim().length > 0;
  const nothingToShow =
    matchingGroups.length === 0 &&
    recallGroups.length === 0 &&
    !recall.loading &&
    !recall.failed &&
    showRecall;

  return (
    <Dialog onOpenChange={(next) => (next ? onOpenChange(true) : close())} open={open}>
      <DialogContent
        className="top-[14vh] w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">
          Search everything you have saved, or jump to a place in Tendnote.
        </DialogDescription>
        <Command label="Search and commands" shouldFilter={false}>
          <CommandInput
            aria-label="Search and commands"
            onValueChange={setQuery}
            placeholder="Search your notebook, or jump to a place"
            value={query}
          />
          <CommandList className="max-h-[24rem]">
            {showRecall ? (
              <RecallSection
                groups={recallGroups}
                loading={recall.loading}
                onNavigate={(href) => {
                  close();
                  router.push(href);
                }}
              />
            ) : null}
            {matchingGroups.map((group) => (
              <CommandGroup heading={group.heading} key={group.heading}>
                {group.commands.map((command) => (
                  <CommandItem
                    data-checked={command.checked ? "true" : undefined}
                    key={command.id}
                    onSelect={() => {
                      close();
                      command.run();
                    }}
                    value={`command:${command.id}`}
                  >
                    <command.icon aria-hidden className="text-muted-foreground" />
                    {command.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {recall.failed ? (
              <EmptyState
                className="m-1"
                description={recall.failureMessage ?? "Try that search again in a moment."}
                size="compact"
                title="Search did not run."
                action={
                  <Button onClick={() => setQuery(`${query} `)} size="sm" variant="outline">
                    Try again
                  </Button>
                }
              />
            ) : null}
            {nothingToShow ? (
              <EmptyState
                className="m-1"
                description="Try different wording, or widen the filters below."
                size="compact"
                title="Nothing matched that search."
              />
            ) : null}
            <RecallFootnotes response={recall.response} showRecall={showRecall} />
          </CommandList>
        </Command>
        {showRecall ? <RecallFilterBar recall={recall} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Recall results, grouped by record family, ahead of the command menu. */
function RecallSection({
  groups,
  loading,
  onNavigate,
}: {
  groups: RecallGroup[];
  loading: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <>
      {loading && groups.length === 0 ? <RecallSkeleton /> : null}
      {groups.map((group) => (
        <CommandGroup heading={group.heading} key={group.family}>
          {group.results.map((result) => {
            const key = `${result.canonical.kind}:${result.canonical.id}`;
            const FamilyIcon = FAMILY_ICONS[result.family];
            const { primary, secondary } = recallResultLines(result);
            return (
              <CommandItem
                key={key}
                onSelect={() => onNavigate(result.href)}
                value={`recall:${key}`}
              >
                <FamilyIcon aria-hidden className="text-muted-foreground" />
                <span className="truncate font-medium">{primary}</span>
                {secondary ? (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{secondary}</span>
                ) : null}
                {result.match.kind === "related" ? (
                  <CommandShortcut className="tracking-normal">Related</CommandShortcut>
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </>
  );
}

/**
 * Three rows shaped like the results that are coming, not a spinner in the middle
 * of an empty box (DESIGN.md §6). The list keeps its height, so nothing jumps when
 * the answer lands.
 */
function RecallSkeleton() {
  return (
    <div aria-label="Searching records" className="flex flex-col gap-2 p-2" role="status">
      {[0, 1, 2].map((row) => (
        <span aria-hidden className="h-4 rounded bg-secondary" key={row} style={rowWidth(row)} />
      ))}
    </div>
  );
}

const ROW_WIDTHS = ["70%", "55%", "62%"];
function rowWidth(row: number) {
  return { width: ROW_WIDTHS[row % ROW_WIDTHS.length] };
}

/** What the search could not reach, and what it had to leave out. Honest, quiet. */
function RecallFootnotes({
  response,
  showRecall,
}: {
  response: GlobalRecallResponse | null;
  showRecall: boolean;
}) {
  if (!showRecall || !response) return null;
  return (
    <>
      {response.limitations.map((limitation) => (
        <p
          className="px-3 py-1.5 text-[length:var(--text-small)] text-muted-foreground"
          key={limitation.source}
        >
          {limitation.message}
        </p>
      ))}
      {response.hasMore ? (
        <p className="px-3 py-1.5 text-[length:var(--text-small)] text-muted-foreground">
          More matches than fit here. Narrow your search to see them.
        </p>
      ) : null}
    </>
  );
}

/**
 * The four narrowing controls as one quiet bar under the list, and only once a
 * query exists - with nothing to narrow they would be four controls asking to be
 * read before the owner has typed anything. Kept outside `<Command>` so cmdk's
 * arrow-key handling never competes with the selects for the same keystrokes.
 */
function RecallFilterBar({ recall }: { recall: ReturnType<typeof useGlobalRecall> }) {
  const { family, includeArchived, includeRestricted, matchKind } = recall.filters;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <Label
          className="text-[length:var(--text-caption)] text-muted-foreground"
          htmlFor="search-palette-family"
        >
          Record type
        </Label>
        <Select
          onValueChange={(value) => recall.setFamily(value as GlobalRecallFilter)}
          value={family}
        >
          <SelectTrigger className="bg-background" id="search-palette-family" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All records</SelectItem>
            <SelectItem value="people">People</SelectItem>
            <SelectItem value="follow_ups">Follow-Ups</SelectItem>
            <SelectItem value="actions">Actions</SelectItem>
            <SelectItem value="assets">Assets</SelectItem>
            <SelectItem value="saved_items">Saved Items</SelectItem>
            <SelectItem value="calendar">Calendar</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Label
          className="text-[length:var(--text-caption)] text-muted-foreground"
          htmlFor="search-palette-match"
        >
          Match
        </Label>
        <Select
          onValueChange={(value) => recall.setMatchKind(value as GlobalRecallMatchKind | "all")}
          value={matchKind}
        >
          <SelectTrigger className="bg-background" id="search-palette-match" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Exact + Related</SelectItem>
            <SelectItem value="exact">Exact only</SelectItem>
            <SelectItem value="related">Related only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={includeArchived}
          id="search-palette-archived"
          onCheckedChange={(checked) => recall.setIncludeArchived(checked === true)}
        />
        <Label
          className="font-normal text-[length:var(--text-caption)] text-muted-foreground"
          htmlFor="search-palette-archived"
        >
          Include archived
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          aria-describedby={recall.restrictedLocked ? "search-palette-restricted-hint" : undefined}
          checked={includeRestricted}
          disabled={recall.restrictedLocked}
          id="search-palette-restricted"
          onCheckedChange={(checked) => recall.setIncludeRestricted(checked === true)}
        />
        {/* The label names the control; what stands in the way is helper text. */}
        <Label
          className="font-normal text-[length:var(--text-caption)] text-muted-foreground"
          htmlFor="search-palette-restricted"
        >
          Reveal restricted matches
        </Label>
      </div>
      {recall.restrictedLocked ? (
        <p
          className="basis-full text-[length:var(--text-caption)] text-muted-foreground"
          id="search-palette-restricted-hint"
        >
          Pick a record type first.
        </p>
      ) : null}
    </div>
  );
}

type RecallGroup = {
  family: GlobalRecallFamily;
  heading: string;
  results: GlobalRecallResponse["results"];
};

const FAMILY_HEADINGS: Record<GlobalRecallFamily, string> = {
  person: "People",
  relationship_context: "Memories",
  follow_up: "Follow-Ups",
  general_action: "Actions",
  asset: "Assets",
  asset_memory: "Asset details",
  saved_item: "Saved Items",
  calendar_event: "Calendar",
};

const FAMILY_ICONS: Record<GlobalRecallFamily, Icon> = {
  person: BookUserIcon,
  relationship_context: StickyNoteIcon,
  follow_up: BellIcon,
  general_action: CircleDotIcon,
  asset: BoxIcon,
  asset_memory: BoxIcon,
  saved_item: BookmarkIcon,
  calendar_event: CalendarIcon,
};

/** Families in reading order: who first, then what was said, then what is owed. */
const FAMILY_ORDER: GlobalRecallFamily[] = [
  "person",
  "relationship_context",
  "follow_up",
  "general_action",
  "asset",
  "asset_memory",
  "saved_item",
  "calendar_event",
];

/**
 * One group per record family, exact matches ahead of related ones inside each.
 * The phone flow splits Exact from Related at the top level because it has a full
 * screen to spend; the palette has one short list, so family is the axis that
 * helps and match strength becomes ordering plus a quiet tag.
 */
function groupResultsByFamily(response: GlobalRecallResponse | null): RecallGroup[] {
  const results = response?.results ?? [];
  return FAMILY_ORDER.flatMap((family) => {
    const inFamily = results.filter((result) => result.family === family);
    if (inFamily.length === 0) return [];
    return [
      {
        family,
        heading: FAMILY_HEADINGS[family],
        results: [
          ...inFamily.filter((result) => result.match.kind === "exact"),
          ...inFamily.filter((result) => result.match.kind === "related"),
        ],
      },
    ];
  });
}

type PaletteCommand = {
  id: string;
  label: string;
  icon: Icon;
  /** Extra words that should find this command; never shown. */
  keywords: string[];
  /** Marks the active choice in a group that names a current setting. */
  checked?: boolean;
  run: () => void;
};

type PaletteCommandGroup = {
  heading: string;
  commands: PaletteCommand[];
};

/**
 * The command menu.
 *
 * Quick actions carry the owner to the surface that already owns each capture -
 * they never grow a second capture form inside the palette, where a half-built
 * record could be lost on Escape. People and Follow-Ups have no global create
 * form in this product (a person arrives through capture, a follow-up lives on a
 * person's ledger), so "Capture a note" answers for them and carries their words
 * as keywords.
 */
function paletteCommandGroups({
  navigate,
  setTheme,
  theme,
}: {
  navigate: (href: string) => void;
  setTheme: (theme: string) => void;
  theme: string | undefined;
}): PaletteCommandGroup[] {
  return [
    {
      heading: "Quick actions",
      commands: [
        {
          id: "capture-note",
          label: "Capture a note",
          icon: NotebookPenIcon,
          keywords: ["capture", "note", "memory", "remember", "person", "follow-up", "add"],
          run: () => navigate(appDestination("today").route),
        },
        {
          id: "add-action",
          label: "Add an action",
          icon: PlusIcon,
          keywords: ["new", "todo", "task", "reminder"],
          run: () => navigate(appDestination("actions").route),
        },
        {
          id: "add-asset",
          label: "Add an asset",
          icon: PlusIcon,
          keywords: ["new", "thing", "appliance", "car"],
          run: () => navigate(appDestination("assets").route),
        },
        {
          id: "add-saved-item",
          label: "Save an item",
          icon: PlusIcon,
          keywords: ["new", "link", "question", "bookmark"],
          run: () => navigate(appDestination("saved-items").route),
        },
      ],
    },
    {
      heading: "Go to",
      commands: destinationsInGroup("desktop-primary").map((destination) => ({
        id: `go-to-${destination.id}`,
        label: destination.label,
        icon: destination.icon,
        keywords: ["go to", "open"],
        run: () => navigate(destination.route),
      })),
    },
    {
      heading: "Appearance",
      commands: [
        { id: "theme-light", label: "Light", icon: SunIcon },
        { id: "theme-dark", label: "Dark", icon: MoonIcon },
        { id: "theme-system", label: "System", icon: MonitorIcon },
      ].map((mode) => {
        const value = mode.id.replace("theme-", "");
        return {
          ...mode,
          keywords: ["theme", "appearance", "mode"],
          checked: theme === value,
          run: () => setTheme(value),
        };
      }),
    },
  ];
}

/**
 * Plain substring matching over the label and its keywords.
 *
 * cmdk's own filter is off (`shouldFilter={false}`) because recall results are
 * already the server's answer and must never be re-scored client-side; that makes
 * command filtering ours to do, and one honest `includes` is the whole
 * requirement here - a dozen commands, typed at exactly.
 */
function filterCommandGroup(group: PaletteCommandGroup, query: string): PaletteCommandGroup | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return group;
  const commands = group.commands.filter((command) =>
    [command.label, ...command.keywords].some((term) => term.toLowerCase().includes(needle)),
  );
  return commands.length > 0 ? { ...group, commands } : null;
}
