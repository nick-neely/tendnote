"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Light / Dark / System theme control (PRODUCT.md: both themes first-class,
 * system-aware with a user toggle). A quiet ghost icon button opens a small menu
 * of the three modes with a check on the active one — calm and discoverable, no
 * novelty, fully keyboard operable through Radix's menu (arrow keys + roving
 * focus) with the shared button focus ring.
 *
 * No hydration flash, two ways:
 *   - The TRIGGER icon is a CSS class swap (Sun under light, Moon under `.dark`),
 *     so it reflects the *effective* theme by following the same `.dark` class the
 *     rest of the app does — no `theme` value is read to paint it, so the server
 *     and first client paint agree and there is never a wrong icon on load.
 *   - The MENU selection reads `theme`, but the menu content only mounts when
 *     opened (well after hydration), and the trigger's accessible name only names
 *     the current mode once `mounted` — the first client render matches the
 *     server ("Theme"), then upgrades — so neither introduces a mismatch.
 */

const MODES = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activeLabel = MODES.find((mode) => mode.value === theme)?.label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={mounted && activeLabel ? `Theme: ${activeLabel}` : "Theme"}
          className={className}
          size="icon"
          variant="ghost"
        >
          {/* CSS-swapped effective-theme icon — follows `.dark`, no hydration read. */}
          <SunIcon aria-hidden className="dark:hidden" />
          <MoonIcon aria-hidden className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup onValueChange={setTheme} value={theme}>
          {MODES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem className="gap-2" key={value} value={value}>
              <Icon aria-hidden className="text-muted-foreground" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
