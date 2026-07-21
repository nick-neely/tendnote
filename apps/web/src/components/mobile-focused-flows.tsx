"use client";

import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { appDestinations } from "@/components/app-destinations";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocalComposerDraft } from "@/lib/local-composer-draft";

export type FocusedFlow = "eve" | "search" | "capture" | "menu";

function FullScreenFlow({
  children,
  description,
  initialFocusRef,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  title: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="inset-0 top-0 left-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-x-hidden rounded-none p-0"
        onOpenAutoFocus={(event) => {
          if (!initialFocusRef?.current) return;
          event.preventDefault();
          initialFocusRef.current.focus();
        }}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <header className="flex min-h-14 items-center gap-2 border-b px-3 pt-[env(safe-area-inset-top)]">
          <Button
            aria-label="Back to Today"
            className="size-11"
            onClick={onClose}
            size="icon-lg"
            variant="ghost"
          >
            <ArrowLeftIcon aria-hidden />
          </Button>
          <h2 className="font-semibold text-base">{title}</h2>
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SearchFlow({
  onClose,
  query,
  setQuery,
}: {
  onClose: () => void;
  query: string;
  setQuery: (query: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <FullScreenFlow
      description="Search records visible to you."
      initialFocusRef={inputRef}
      onClose={onClose}
      title="Search"
    >
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <label className="sr-only" htmlFor="mobile-global-search">
          Search Tendnote
        </label>
        <div className="flex min-h-12 items-center gap-2 rounded-xl border px-3 focus-within:ring-3 focus-within:ring-ring/35">
          <SearchIcon aria-hidden className="size-4 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            id="mobile-global-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people, actions, assets…"
            ref={inputRef}
            value={query}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          {query
            ? "Global Recall results will appear here."
            : "Search across records visible to you."}
        </p>
      </div>
    </FullScreenFlow>
  );
}

export function CaptureFlow({
  onClose,
  onSubmit,
  ownerUserId,
}: {
  onClose: () => void;
  onSubmit?: (value: string) => Promise<void>;
  ownerUserId: string;
}) {
  const draft = useLocalComposerDraft(ownerUserId, "capture");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [failure, setFailure] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (!onSubmit || !draft.value.trim() || pending) return;
    setPending(true);
    setFailure(false);
    try {
      await onSubmit(draft.value);
      draft.clear();
      setSaved(true);
    } catch {
      setFailure(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <FullScreenFlow
      description="Explicit save capture."
      initialFocusRef={inputRef}
      onClose={onClose}
      title="Capture"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {saved ? (
          <div className="flex flex-1 flex-col justify-center gap-3" role="status">
            <h3 className="font-semibold text-xl">Capture saved</h3>
            <p className="text-muted-foreground text-sm">The unsaved device draft was cleared.</p>
          </div>
        ) : (
          <>
            {draft.restored ? (
              <p className="text-muted-foreground text-sm" role="status">
                Unsaved draft restored on this device.
              </p>
            ) : null}
            <label className="font-medium text-sm" htmlFor="mobile-capture-input">
              What should Tendnote keep?
            </label>
            <textarea
              className="min-h-40 w-full resize-none rounded-xl border bg-background p-4 text-base leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
              id="mobile-capture-input"
              onChange={(event) => draft.setValue(event.target.value)}
              placeholder="Capture a note, reminder, link, or open question…"
              ref={inputRef}
              value={draft.value}
            />
            <p className="text-muted-foreground text-xs">
              This text is unsaved and stays only on this device for up to 24 hours.
            </p>
            {failure ? <MobileFailureState kind="app_server" onRetry={submit} /> : null}
            {!onSubmit ? (
              <p className="text-muted-foreground text-xs" role="status">
                Capture routing is temporarily unavailable. Your draft remains safe to copy or
                discard.
              </p>
            ) : null}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
              <Button
                className="min-h-11"
                onClick={draft.clear}
                size="lg"
                type="button"
                variant="ghost"
              >
                Discard draft
              </Button>
              <Button
                aria-busy={pending}
                className="min-h-11"
                disabled={!onSubmit || !draft.value.trim() || pending}
                onClick={submit}
                size="lg"
                type="button"
              >
                {pending ? "Saving…" : "Save capture"}
              </Button>
            </div>
          </>
        )}
      </div>
    </FullScreenFlow>
  );
}

export function EveFlow({ children, onClose }: { children?: ReactNode; onClose: () => void }) {
  return (
    <FullScreenFlow description="Focused Eve conversation." onClose={onClose} title="Eve">
      <div className="min-h-0 flex-1 overflow-hidden p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {children ?? <MobileFailureState kind="eve" />}
      </div>
    </FullScreenFlow>
  );
}

export function MenuFlow({ onClose }: { onClose: () => void }) {
  return (
    <FullScreenFlow description="Tendnote destinations." onClose={onClose} title="Menu">
      <nav aria-label="Menu destinations" className="flex flex-col divide-y px-5 py-4">
        {appDestinations.slice(1).map((item) => {
          const Icon = item.icon;
          return (
            <Link
              className="flex min-h-14 items-center gap-3 text-base focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden className="size-5 text-muted-foreground" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </FullScreenFlow>
  );
}
