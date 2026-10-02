"use client";

import { Button } from "@tendnote/ui/button";
import { cn } from "@tendnote/ui/cn";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { useMounted } from "@/components/use-reduced-motion";

const MODES = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

/**
 * Light / Dark / System, the same three modes and the same quiet icon button
 * as the product's theme menu. The trigger's sun and moon swap on the `.dark`
 * class, so the server and the first client paint agree. The choices are a
 * native radio group in a small disclosure: arrow keys move between them, a
 * click or Enter picks one and closes it, and Escape or a click outside closes
 * it without changing anything. The panel only renders while open, after
 * hydration, so the stored theme never has to match the server's.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const activeLabel = MODES.find((mode) => mode.value === theme)?.label;

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    // Focus lands on the current mode, as it would in a menu.
    (
      root?.querySelector<HTMLInputElement>("input:checked") ??
      root?.querySelector<HTMLInputElement>("input")
    )?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!root?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <Button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={mounted && activeLabel ? `Theme: ${activeLabel}` : "Theme"}
        onClick={() => setOpen((value) => !value)}
        ref={toggleRef}
        size="icon"
        type="button"
        variant="ghost"
      >
        <SunIcon aria-hidden className="dark:hidden" />
        <MoonIcon aria-hidden className="hidden dark:block" />
      </Button>

      {open ? (
        <fieldset
          className="absolute top-full right-0 z-50 mt-2 flex min-w-36 flex-col rounded-xl border bg-background p-1 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] dark:shadow-[0_12px_32px_-16px_rgb(0_0_0/0.8)]"
          id={panelId}
        >
          <legend className="sr-only">Theme</legend>
          {MODES.map(({ value, label, Icon }) => (
            <label
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted has-focus-visible:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring"
              key={value}
            >
              <input
                checked={theme === value}
                className="sr-only"
                name={panelId}
                onChange={() => setTheme(value)}
                // A pointer click picks and closes; arrow keys only move the selection.
                onClick={(event) => event.detail > 0 && close()}
                onKeyDown={(event) => event.key === "Enter" && close()}
                type="radio"
                value={value}
              />
              <Icon aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">{label}</span>
              <CheckIcon
                aria-hidden
                className={cn("size-3.5 text-primary", theme === value ? "visible" : "invisible")}
              />
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

/**
 * The same three modes as an always-visible segmented control, for the phone
 * menu, where there is room to show the current mode instead of hiding it
 * behind an icon (as the product's phone menu does). A native radio group, so
 * the current mode is announced and arrow keys move it; selection is the sage
 * fill, and every option keeps its icon and label. Mount it only inside
 * something that renders after hydration, such as the menu sheet: `theme` is
 * unknown on the server.
 */
export function ThemeSegmentedControl({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const name = useId();

  return (
    <fieldset className={cn("flex flex-col gap-2", className)}>
      <legend className="mb-2 text-[length:var(--text-small)] font-medium text-muted-foreground">
        Appearance
      </legend>
      <div className="grid grid-cols-3 overflow-hidden rounded-lg border">
        {MODES.map(({ value, label, Icon }) => (
          <label
            className="flex h-11 cursor-pointer items-center justify-center gap-2 border-l text-sm transition-colors duration-150 first:border-l-0 hover:bg-muted has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-3 has-focus-visible:ring-ring has-focus-visible:ring-inset"
            key={value}
          >
            <input
              checked={(theme ?? "system") === value}
              className="sr-only"
              name={name}
              onChange={() => setTheme(value)}
              type="radio"
              value={value}
            />
            <Icon aria-hidden className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
