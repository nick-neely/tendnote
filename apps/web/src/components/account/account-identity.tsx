/**
 * The signed-in account, shown so the visitor can confirm which account they
 * are in. Used by the areas outside the app shell, where nothing else names it.
 */
export function AccountIdentity({ user }: { user: { name: string; email: string } }) {
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[length:var(--text-small)] font-medium text-secondary-foreground"
      >
        {initial}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
          {user.name || user.email}
        </span>
        {user.name ? (
          <span className="truncate text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            {user.email}
          </span>
        ) : null}
      </div>
    </div>
  );
}
