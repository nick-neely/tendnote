export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://tendnote.local");
    if (url.origin !== "https://tendnote.local" || url.pathname.startsWith("/sign-in")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function signInPathFor(returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo);
  return safe === "/" ? "/sign-in" : `/sign-in?returnTo=${encodeURIComponent(safe)}`;
}

export function appReturnTo(
  pathname: string,
  searchParams?: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(searchParams ?? {})) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (value !== undefined) query.append(key, value);
    }
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return safeReturnTo(`${pathname}${suffix}`);
}
