/** Shared lifetime profiles for bounded Cache Components product views. */
export const cacheProfiles = {
  interactive: { stale: 30, revalidate: 30, expire: 300 },
  reference: { stale: 300, revalidate: 900, expire: 86400 },
} as const;
