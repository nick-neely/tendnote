import { InstantShellsPrototype } from "./prototype";

export const dynamic = "force-dynamic";

type Variant = "A" | "B" | "C";
type Surface = "today" | "list" | "detail" | "review" | "account";
type Phase = "shell" | "complete" | "failure";

const variants = new Set<Variant>(["A", "B", "C"]);
const surfaces = new Set<Surface>(["today", "list", "detail", "review", "account"]);
const phases = new Set<Phase>(["shell", "complete", "failure"]);

function choose<T extends string>(value: string | undefined, allowed: Set<T>, fallback: T): T {
  return value && allowed.has(value as T) ? (value as T) : fallback;
}

/**
 * PROTOTYPE ONLY — three transition-shell strategies, switchable with
 * `?variant=`, on one throwaway route. This branch must never merge to main.
 */
export default async function InstantShellsPrototypePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <InstantShellsPrototype
      initialPhase={choose(
        typeof query.phase === "string" ? query.phase : undefined,
        phases,
        "shell",
      )}
      initialSurface={choose(
        typeof query.surface === "string" ? query.surface : undefined,
        surfaces,
        "today",
      )}
      initialVariant={choose(
        typeof query.variant === "string" ? query.variant : undefined,
        variants,
        "A",
      )}
    />
  );
}
