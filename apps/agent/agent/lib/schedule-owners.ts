type ScheduleOwnerEnvironment = {
  NODE_ENV?: string;
  TENDNOTE_DEV_OWNER_USER_ID?: string;
};

type ResolveScheduledOwnerUserIdsInput = {
  env?: ScheduleOwnerEnvironment;
  listAdmittedOwnerUserIds: () => Promise<string[]>;
};

/** Resolve durable hosted owners while preserving the loopback-only demo owner locally. */
export async function resolveScheduledOwnerUserIds({
  env = process.env,
  listAdmittedOwnerUserIds,
}: ResolveScheduledOwnerUserIdsInput): Promise<string[]> {
  if (env.NODE_ENV === "production") {
    return listAdmittedOwnerUserIds();
  }

  return [env.TENDNOTE_DEV_OWNER_USER_ID?.trim() || "demo-user"];
}
