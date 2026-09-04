import type { Metadata } from "next";
import { Suspense } from "react";
import { AssistantPageReserve } from "@/components/assistant-page-reserve";
import { AssistantSurfaceContent } from "@/components/assistant-surface";

export const metadata: Metadata = { title: "Assistant" };

/**
 * A new conversation, beside every conversation the owner already has.
 *
 * It is deliberately not wrapped in `AdmittedRoute`: the shared `RouteReserve`
 * is a narrow ledger heading over three card shapes, and this destination is a
 * full-height two-column canvas with a composer pinned to the bottom of it. A
 * reserve that is not the shape of what replaces it is exactly the layout shift
 * the reserve exists to prevent, so this route brings its own (ADR 0207).
 */
export default function AssistantRoutePage() {
  return (
    <Suspense fallback={<AssistantPageReserve />}>
      <AssistantSurfaceContent sessionId={null} />
    </Suspense>
  );
}
