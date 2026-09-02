"use client";

import type { EveAuthorizationPart } from "eve/react";
import { useEffect, useRef, useState } from "react";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import { CheckIcon, CopyIcon, ExternalLinkIcon, PlugIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

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
 * model output, but it still opens in a new tab with the referrer withheld —
 * this surface never hands a third party the page the reader was on.
 */

/** Copies the device code and says so for a beat. */
function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return null;
  }

  return (
    <Button
      aria-label={copied ? "Code copied" : "Copy the code"}
      className="text-muted-foreground hover:text-primary"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        });
      }}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
    </Button>
  );
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
      {challenge?.url ? (
        <Button asChild className="w-fit" size="sm" variant="default">
          <a href={challenge.url} rel="noopener noreferrer" target="_blank">
            <ExternalLinkIcon aria-hidden />
            Open sign-in
          </a>
        </Button>
      ) : null}
      {expires ? <Caption>{expires}</Caption> : null}
    </ResultCard>
  );
}
