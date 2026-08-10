"use client";

import type { ReactNode } from "react";
import { useRef, useState, useTransition } from "react";
import type { Icon } from "@/components/icons";
import { PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * The one collapsible form shape the Gift Plan surfaces use, with the focus
 * handling that a disclosure has to do and rarely does.
 *
 * Closing a collapsible removes the focused control from the document, and the
 * browser's answer to that is `<body>` — which strands a keyboard user at the
 * top of the page every time they save. So the trigger is refocused on close, by
 * every route out: submit, cancel, and Escape alike. The shell owns `open` for
 * exactly that reason; a caller toggling it from outside could close the form
 * without the focus ever landing anywhere.
 *
 * `onSubmit` answers whether the write succeeded. A failure keeps the form open
 * with the draft intact, because the message explaining what went wrong is
 * usually inside it.
 */
export function GiftPlanInlineForm({
  triggerLabel,
  triggerIcon: TriggerIcon = PlusIcon,
  triggerVariant = "outline",
  triggerSize,
  submitLabel,
  pendingLabel,
  onSubmit,
  children,
}: {
  triggerLabel: string;
  triggerIcon?: Icon;
  triggerVariant?: "outline" | "ghost";
  triggerSize?: "sm";
  submitLabel: string;
  /** The text-swap the product uses everywhere for an in-flight control. */
  pendingLabel: string;
  onSubmit: () => Promise<boolean>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <Collapsible
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <Button className="w-fit" ref={triggerRef} size={triggerSize} variant={triggerVariant}>
          <TriggerIcon aria-hidden className="size-4" />
          {triggerLabel}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form
          className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              if (await onSubmit()) close();
            });
          }}
        >
          {children}
          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? pendingLabel : submitLabel}
            </Button>
            <Button onClick={close} type="button" variant="ghost">
              Cancel
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
