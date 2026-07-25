import { TendnoteLogo } from "@/components/tendnote-logo";

/**
 * The only fallback that may render before request-bound admission resolves.
 * Keep it intentionally owner-neutral: no navigation, destination name, or
 * product data belongs here.
 */
export function AccessCheckFallback() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div aria-busy="true" className="flex flex-col items-center gap-4 text-center">
        <TendnoteLogo size="header" />
        <p className="text-muted-foreground text-sm">Checking access…</p>
      </div>
    </main>
  );
}
