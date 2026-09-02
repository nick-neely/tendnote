import type { Metadata } from "next";
import { Suspense } from "react";
import { AssistantPageReserve } from "@/components/assistant-page-reserve";
import { AssistantSurfaceContent } from "@/components/assistant-surface";

export const metadata: Metadata = { title: "Assistant" };

/**
 * One saved conversation, reopened.
 *
 * The session id in the URL is an identifier and never an authorization
 * (ADR 0238), so the thread is resolved through the owner-scoped read before
 * anything renders — and a thread that is not this owner's is `notFound()`,
 * byte-identical to one that never existed. The transcript itself is rebuilt
 * from Eve's own durable stream in the browser, not from a Tendnote copy; all
 * this route hands down is the id and the owner's conversation list.
 *
 * The route component itself reads nothing: `params` is awaited *inside* the
 * boundary below, so the page's static shell — rail geometry, header, composer
 * well — prerenders and is on screen before the request resolves.
 */
export default function AssistantThreadPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <Suspense fallback={<AssistantPageReserve />}>
      <AssistantThreadContent params={params} />
    </Suspense>
  );
}

async function AssistantThreadContent({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <AssistantSurfaceContent sessionId={sessionId} />;
}
