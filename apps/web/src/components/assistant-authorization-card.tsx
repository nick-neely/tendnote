"use client";

import type { EveAuthorizationPart } from "eve/react";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import { CheckIcon, CopyIcon, ExternalLinkIcon, PlugIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

/**
 * A mid-turn sign-in challenge, rendered instead of dropped.
 *
 * When a tool needs an account the owner has not connected yet, eve pauses the
 * turn and projects an `authorization` part carrying a URL and, for a device
 * flow, a short code. Nothing rendered it before, so a turn that stopped for a
 * Google sign-in showed the owner an empty answer and no way forward — the turn
 * simply looked broken.
 *
 * It reads as a tentative card because that is exactly what it is: nothing has
 * happened yet, and the next step is the owner's, taken deliberately, in a tab
 * they opened themselves. The URL is eve's own connect endpoint rather than
 * model output, but it goes through the same scheme guard the markdown renderer
 * applies to a model-written link, and it opens in a new tab with the referrer
 * withheld — this surface never hands a third party the page the reader was on.
 */

/** Copies the device code and says so for a beat. */
function CodeCopyButton({ code }: { code: string }) {
  const clipboard = useCopyToClipboard();

  if (!clipboard) {
    return null;
  }

  return (
    <Button
      aria-label={clipboard.copied ? "Code copied" : "Copy the code"}
      className="text-muted-foreground hover:text-primary"
      onClick={() => clipboard.copy(code)}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      {clipboard.copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
    </Button>
  );
}

/**
 * The challenge URL, but only where a browser would treat it as an ordinary web
 * address, and only over TLS.
 *
 * Today this is eve's own connect endpoint, so the guard is defence in depth
 * rather than a live hole — but "the value is trustworthy today" is exactly the
 * assumption a connector added later quietly breaks, and the cost of being wrong
 * is a `javascript:` URL behind a button captioned "Open sign-in". Anything that
 * does not pass keeps its place in the card as plain text, so the owner can still
 * see where they were being sent.
 */
function safeChallengeHref(url: string): string | null {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** "expires in 4 minutes", or nothing when the stamp is missing or past. */
function expiryLabel(expiresAt: string | undefined, now: number): string | null {
  if (!expiresAt) {
    return null;
  }
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) {
    return null;
  }
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) {
    return "This code has expired";
  }
  return `Expires in ${minutes === 1 ? "1 minute" : `${minutes} minutes`}`;
}

export function AssistantAuthorizationCard({
  isNew,
  part,
}: {
  isNew: boolean;
  part: EveAuthorizationPart;
}) {
  const name = part.displayName || part.name;

  if (part.state === "completed") {
    return (
      <ResultCard
        icon={<PlugIcon className="size-3" />}
        isNew={isNew}
        kind="authorization"
        label={`${name} connected`}
        tone="confirmed"
      >
        <Body>You're signed in. Ask again and the assistant can use it.</Body>
      </ResultCard>
    );
  }

  const challenge = part.authorization;
  const expires = expiryLabel(challenge?.expiresAt, Date.now());
  const signInHref = challenge?.url ? safeChallengeHref(challenge.url) : null;

  return (
    <ResultCard
      icon={<PlugIcon className="size-3" />}
      isNew={isNew}
      kind="authorization"
      label={`${name} needs your sign-in`}
      tone="tentative"
    >
      <Body>{part.description || challenge?.instructions || `Connect ${name} to continue.`}</Body>
      {challenge?.userCode ? (
        <div className="flex items-center gap-1.5">
          <code className="rounded-md bg-background px-2 py-1 font-mono text-[length:var(--text-small)] tracking-[0.12em]">
            {challenge.userCode}
          </code>
          <CodeCopyButton code={challenge.userCode} />
        </div>
      ) : null}
      {signInHref ? (
        <Button asChild className="w-fit" size="sm" variant="default">
          <a href={signInHref} rel="noopener noreferrer" target="_blank">
            <ExternalLinkIcon aria-hidden />
            Open sign-in
          </a>
        </Button>
      ) : null}
      {challenge?.url && !signInHref ? (
        <Body className="wrap-anywhere font-mono text-[length:var(--text-small)] text-muted-foreground">
          {challenge.url}
        </Body>
      ) : null}
      {expires ? <Caption>{expires}</Caption> : null}
    </ResultCard>
  );
}
