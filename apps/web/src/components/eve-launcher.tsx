"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const EveSurface = dynamic(
  () => import("@/components/mobile-eve-surface").then((mod) => mod.EveSurface),
  { ssr: false },
);

/** A desktop-shaped reserve that keeps Eve context and conversation work interaction-started. */
export function EveLauncher({ ownerUserId }: { ownerUserId: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <EveSurface ownerUserId={ownerUserId} />;
  return (
    <section className="flex h-full min-h-[30rem] flex-col justify-end rounded-xl border bg-panel p-5 lg:min-h-0">
      <div className="max-w-md">
        <h2 className="font-semibold text-lg">Eve</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Ask about your notebook when you are ready. Nothing is loaded or sent until you open a
          conversation.
        </p>
        <Button className="mt-4" onClick={() => setOpen(true)} type="button">
          Open Eve
        </Button>
      </div>
    </section>
  );
}
