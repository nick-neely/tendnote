"use client";

import { type ReactNode, useLayoutEffect, useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";

/** The fold belongs to the destination, not to a streamed conversation. */
export function AssistantPageFrame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useLayoutEffect(() => {
    setOpen(!document.cookie.split(";").some((entry) => entry.trim() === "sidebar_state=false"));
  }, []);
  return (
    <SidebarProvider
      className="h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] min-h-0 lg:h-[calc(100dvh-3.5rem-2px)]"
      data-full-bleed
      open={open}
      onOpenChange={setOpen}
    >
      {children}
    </SidebarProvider>
  );
}
