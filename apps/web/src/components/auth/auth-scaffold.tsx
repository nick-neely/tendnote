import Link from "next/link";
import type { ReactNode } from "react";
import { TendnoteLogo } from "@/components/tendnote-logo";

/**
 * The calm, centered shell for the signed-out and pending surfaces. It never
 * renders the app shell, navigation, or any relationship data — only the
 * Tendnote mark and the single task in front of the visitor.
 */
export function AuthScaffold({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500 motion-safe:ease-out">
        <div className="flex flex-col items-center gap-4 text-center">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-normal rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <TendnoteLogo />
          </Link>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal text-balance">
              {title}
            </h1>
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground text-pretty">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">{children}</div>

        {footer ? (
          <div className="text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
