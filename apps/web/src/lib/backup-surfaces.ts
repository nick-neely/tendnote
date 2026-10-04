import {
  type BackupSurfaceFinding,
  type BackupSurfaceInventory,
  backupSurfaceFindings,
} from "@tendnote/domain/backup-surfaces";
import { z } from "zod";

/** Exactly the variables the check reads. */
type BackupSurfaceEnvironment = {
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
};

const NEON_API = "https://console.neon.tech/api/v2";
const REQUEST_TIMEOUT_MS = 10_000;
/** Neon's maximum page size, so one page normally holds every branch. */
const BRANCH_PAGE_LIMIT = 10_000;

const time = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const projectResponse = z.object({
  project: z.object({ history_retention_seconds: z.number().int() }),
});
const snapshotsResponse = z.object({
  snapshots: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      manual: z.boolean().optional(),
      created_at: time,
      timestamp: time.nullish(),
      expires_at: time.nullish(),
    }),
  ),
});
const branchesResponse = z.object({
  branches: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      default: z.boolean(),
      created_at: time,
      parent_id: z.string().nullish(),
      parent_timestamp: time.nullish(),
      restored_from: z.string().nullish(),
      expires_at: time.nullish(),
    }),
  ),
  pagination: z.object({ next: z.string().optional() }).optional(),
});

export type BackupSurfaceCheck =
  | { status: "off" }
  | { status: "ran"; findings: BackupSurfaceFinding[] };

/**
 * Reads every surface of the production Neon project that can hold a copy of
 * deleted data: the history setting, snapshots, and branches. Read-only. Throws
 * when Neon cannot be read or answers in an unexpected shape.
 */
async function readNeonInventory(input: {
  apiKey: string;
  projectId: string;
  fetch: typeof fetch;
}): Promise<BackupSurfaceInventory> {
  const project = `${NEON_API}/projects/${encodeURIComponent(input.projectId)}`;
  const get = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
    const response = await input.fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Neon answered ${response.status}.`);
    return schema.parse(await response.json());
  };

  const readBranches = async () => {
    const branches: z.infer<typeof branchesResponse>["branches"] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: String(BRANCH_PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      const page = await get(`${project}/branches?${query}`, branchesResponse);
      branches.push(...page.branches);
      const next = page.pagination?.next;
      // Follow the cursor until a page comes back empty, or Neon hands back the same one.
      cursor = page.branches.length > 0 && next !== cursor ? next : undefined;
    } while (cursor);
    return branches;
  };

  const [settings, { snapshots }, branches] = await Promise.all([
    get(project, projectResponse),
    get(`${project}/snapshots`, snapshotsResponse),
    readBranches(),
  ]);
  return {
    historyRetentionSeconds: settings.project.history_retention_seconds,
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      scheduled: snapshot.manual === false,
      // The point it captured, which can be well before it was taken.
      capturedAt:
        snapshot.timestamp && snapshot.timestamp < snapshot.created_at
          ? snapshot.timestamp
          : snapshot.created_at,
      expiresAt: snapshot.expires_at ?? null,
    })),
    branches: branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      default: branch.default,
      createdAt: branch.created_at,
      parentId: branch.parent_id ?? null,
      parentTimestamp: branch.parent_timestamp ?? null,
      restoredFromSnapshotId: branch.restored_from ?? null,
      expiresAt: branch.expires_at ?? null,
    })),
  };
}

/**
 * The backup-surface check (#622). Off unless both `NEON_API_KEY` and
 * `NEON_PROJECT_ID` are set, so a self-hosted deployment never runs it. Throws
 * when Neon cannot be read, so a caller can tell "no findings" from "no answer".
 */
export async function checkBackupSurfaces(
  input: { env?: BackupSurfaceEnvironment; fetch?: typeof fetch; now?: Date } = {},
): Promise<BackupSurfaceCheck> {
  const env = input.env ?? (process.env as BackupSurfaceEnvironment);
  const apiKey = env.NEON_API_KEY?.trim();
  const projectId = env.NEON_PROJECT_ID?.trim();
  if (!apiKey || !projectId) return { status: "off" };
  const inventory = await readNeonInventory({
    apiKey,
    projectId,
    fetch: input.fetch ?? fetch,
  });
  return { status: "ran", findings: backupSurfaceFindings(inventory, input.now ?? new Date()) };
}

/**
 * The check on the recovery cron's schedule, for the operator alert channel.
 * Each finding is logged on every pass it holds; the alert itself is sent once
 * per episode. A check that could not read Neon gives `null`, no reading.
 */
export async function backupSurfaceReading(
  input: Parameters<typeof checkBackupSurfaces>[0] = {},
): Promise<BackupSurfaceCheck | null> {
  try {
    const check = await checkBackupSurfaces(input);
    if (check.status === "ran") {
      for (const finding of check.findings) console.error("backup_surface.finding", finding);
    }
    return check;
  } catch (error) {
    console.error("backup_surface.check_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
