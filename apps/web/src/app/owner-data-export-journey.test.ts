import type { BackgroundJobQueueSendInput } from "@tendnote/db/queries/background-job-deliveries";
import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import type {
  EnqueueAndTriggerOwnerDataExportJobInput,
  EnqueueAndTriggerOwnerDataExportJobResult,
  OwnerDataExportRelationshipContext,
} from "@tendnote/db/queries/owner-data-export";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admittedOwnerOrNullSpy,
  requireAdmittedOwnerForActionSpy,
} from "@/test/action-adapter-mocks";

type OwnerDataExportModule = typeof import("@tendnote/db/queries/owner-data-export");
type OwnerDataExportJobStore = ReturnType<
  OwnerDataExportModule["createInMemoryOwnerDataExportJobStore"]
>;
type OwnerDataExportArtifactStore = ReturnType<
  OwnerDataExportModule["createInMemoryOwnerDataExportArtifactStore"]
>;
type BackgroundJobDeliveryStore = ReturnType<typeof createInMemoryBackgroundJobDeliveryStore>;
type OwnerDataExportEnqueueResult = EnqueueAndTriggerOwnerDataExportJobResult;
type OwnerDataExportEnqueueInput = EnqueueAndTriggerOwnerDataExportJobInput;
type OwnerDataExportProcessInput = Parameters<
  OwnerDataExportModule["processOwnerDataExportJob"]
>[0];
type OwnerDataExportProcessResult = Awaited<
  ReturnType<OwnerDataExportModule["processOwnerDataExportJob"]>
>;

const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";
const NOW = new Date("2026-08-19T12:00:00.000Z");
const RETRY_AT = new Date("2026-08-19T12:05:00.000Z");

function requireState<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label} is not initialized.`);
  return value;
}

const state = vi.hoisted(() => ({
  actual: null as OwnerDataExportModule | null,
  jobs: null as OwnerDataExportJobStore | null,
  artifacts: null as OwnerDataExportArtifactStore | null,
  deliveries: null as BackgroundJobDeliveryStore | null,
  messages: [] as BackgroundJobQueueSendInput[],
  send: null as ((input: BackgroundJobQueueSendInput) => Promise<{ messageId: string }>) | null,
  generate: null as OwnerDataExportModule["generateOwnerDataExportArchive"] | null,
  externalNotification: null as (() => void) | null,
  externalDraftCreation: null as (() => void) | null,
  enqueue: null as
    | ((input: OwnerDataExportEnqueueInput) => Promise<OwnerDataExportEnqueueResult>)
    | null,
  process: null as
    | ((input: OwnerDataExportProcessInput) => Promise<OwnerDataExportProcessResult>)
    | null,
}));

vi.mock("@tendnote/db/queries/owner-data-export", async () => {
  const actual = await vi.importActual<OwnerDataExportModule>(
    "@tendnote/db/queries/owner-data-export",
  );
  state.actual = actual;
  return {
    ...actual,
    getLatestOwnerDataExportJob: async (ownerUserId: string) =>
      state.jobs?.getLatestForOwner({ ownerUserId }) ?? null,
    createDrizzleOwnerDataExportJobStore: () => state.jobs,
    createDrizzleOwnerDataExportArtifactStore: () => state.artifacts,
    enqueueAndTriggerOwnerDataExportJob: (input: OwnerDataExportEnqueueInput) => {
      if (!state.enqueue) throw new Error("Export enqueue seam is not initialized.");
      return state.enqueue(input);
    },
    claimOwnerDataExportJob: (input: { jobId: string; now?: Date }) =>
      state.jobs?.claim(input) ?? null,
    claimNextOwnerDataExportJob: (input: { now?: Date }) => state.jobs?.claimNext(input) ?? null,
    getOwnerDataExportJob: (jobId: string) => state.jobs?.get({ jobId }) ?? null,
    processOwnerDataExportJob: (input: OwnerDataExportProcessInput) => {
      if (!state.process) throw new Error("Export process seam is not initialized.");
      return state.process(input);
    },
  };
});

vi.mock("@/lib/background-jobs/owner-data-export-queue", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/background-jobs/owner-data-export-queue")>();
  return {
    ...actual,
    enqueueAndPublishOwnerDataExportJob: (
      input: Parameters<typeof actual.enqueueAndPublishOwnerDataExportJob>[0],
    ) => {
      if (!state.deliveries || !state.send || !state.enqueue) {
        throw new Error("Export queue seam is not initialized.");
      }
      return actual.enqueueAndPublishOwnerDataExportJob({
        ...input,
        runtimeMode: "enqueue_only",
        deliveryStore: state.deliveries,
        queue: { send: state.send },
        enqueueOwnerDataExport: state.enqueue,
      });
    },
  };
});

import { consumeOwnerDataExportQueueMessage } from "@/lib/background-jobs/owner-data-export-queue";
import { requestOwnerDataExportAction } from "./actions/owner-data-export";
import { GET } from "./api/account/data-export/[jobId]/route";

function account() {
  return {
    id: OWNER,
    name: "Owner Example",
    email: "owner@example.com",
    accessStatus: "granted" as const,
    accessSource: "self_hosted_bootstrap",
    grantedAt: NOW,
  };
}

function relationshipContext(externalNotification: () => void, externalDraftCreation: () => void) {
  return {
    people: [
      {
        id: "person-owner",
        ownerUserId: OWNER,
        displayName: "Owner Person",
        firstName: "Owner",
        lastName: "Person",
        birthday: null,
        relationshipType: "friend",
        closenessLevel: 1,
        profileBlurb: null,
        source: "manual",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    contactMethods: [],
    memories: [],
    sourceRecords: [],
    sourceRecordPeople: [],
    unresolvedMentions: [],
    interactions: [],
    followups: [],
    contextFacts: [],
    providerConnections: [{ id: "neutral-provider-connection", ownerUserId: OWNER }],
    sessions: [{ id: "neutral-session-row", ownerUserId: OWNER }],
    cacheEntries: [{ id: "neutral-cache-row", ownerUserId: OWNER }],
    snapshots: [{ id: "neutral-snapshot-row", ownerUserId: OWNER }],
    embeddings: [{ id: "neutral-embedding-row", ownerUserId: OWNER }],
    queueRows: [{ id: "neutral-queue-row", ownerUserId: OWNER }],
    deliveryRows: [{ id: "neutral-delivery-row", ownerUserId: OWNER }],
    auditRows: [{ id: "neutral-audit-row", ownerUserId: OWNER }],
    externalNotification,
    externalDraftCreation,
  } as OwnerDataExportRelationshipContext;
}

describe("owner data export Account journey", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    requireAdmittedOwnerForActionSpy.mockReset().mockResolvedValue(OWNER);
    admittedOwnerOrNullSpy.mockReset().mockResolvedValue(OWNER);
    const actual = requireState(state.actual, "Owner export module");
    const jobs = actual.createInMemoryOwnerDataExportJobStore();
    const artifacts = actual.createInMemoryOwnerDataExportArtifactStore(jobs);
    const deliveries = createInMemoryBackgroundJobDeliveryStore();
    state.jobs = jobs;
    state.artifacts = artifacts;
    state.deliveries = deliveries;
    state.messages = [];
    const send = vi.fn(async (input: BackgroundJobQueueSendInput) => {
      state.messages.push(input);
      return { messageId: "owner-export-message" };
    });
    state.send = send;
    const externalNotification = vi.fn();
    const externalDraftCreation = vi.fn();
    state.externalNotification = externalNotification;
    state.externalDraftCreation = externalDraftCreation;
    const generate = vi.fn(
      async (input: Parameters<OwnerDataExportModule["generateOwnerDataExportArchive"]>[0]) =>
        actual.generateOwnerDataExportArchive({
          ...input,
          account: account(),
          relationshipContext: relationshipContext(externalNotification, externalDraftCreation),
        }),
    );
    generate.mockRejectedValueOnce(new Error("temporary export processing failure"));
    state.generate = generate as unknown as OwnerDataExportModule["generateOwnerDataExportArchive"];
    state.enqueue = (input: OwnerDataExportEnqueueInput) =>
      actual.enqueueAndTriggerOwnerDataExportJob(input, {
        jobs,
        artifacts,
        generate: generate as unknown as OwnerDataExportModule["generateOwnerDataExportArchive"],
      });
    state.process = (input: OwnerDataExportProcessInput) =>
      actual.processOwnerDataExportJob({
        ...input,
        jobs,
        artifacts,
        generate: generate as unknown as OwnerDataExportModule["generateOwnerDataExportArchive"],
      });
  });

  afterEach(() => vi.useRealTimers());

  it("composes Account request, queue delivery/recovery, and owner-authenticated download", async () => {
    const requested = await requestOwnerDataExportAction();
    expect(requested).toMatchObject({ ok: true, view: { ownerUserId: OWNER, status: "pending" } });
    expect(requireAdmittedOwnerForActionSpy).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledOnce();
    const published = state.messages[0];
    if (!published) throw new Error("Expected a published owner export pointer.");
    expect(published.payload).toMatchObject({
      deliveryId: expect.any(String),
      jobKind: "owner_data_export",
      jobId: (requested as { ok: true; view: { id: string } }).view.id,
    });
    expect(published).not.toHaveProperty("archive");
    expect(published).not.toHaveProperty("draft");
    expect(published).not.toHaveProperty("notification");
    await expect(
      requireState(state.deliveries, "Delivery store").getBackgroundJobDeliveryForConsumer(
        published.payload.deliveryId,
      ),
    ).resolves.toMatchObject({
      ownerUserId: OWNER,
      jobKind: "owner_data_export",
      jobId: published.payload.jobId,
      status: "published",
    });

    await expect(
      consumeOwnerDataExportQueueMessage({
        payload: published.payload,
        deliveryStore: requireState(state.deliveries, "Delivery store"),
        now: NOW,
        metadata: { topicName: published.topic, messageId: "owner-export-message" },
      }),
    ).rejects.toThrow("temporary export processing failure");

    const failed = await requestOwnerDataExportAction();
    expect(failed).toMatchObject({
      ok: true,
      view: {
        id: (requested as { ok: true; view: { id: string } }).view.id,
        ownerUserId: OWNER,
        status: "failed",
        lastError: "temporary export processing failure",
        runAfter: RETRY_AT,
      },
    });
    expect(state.send).toHaveBeenCalledOnce();

    vi.setSystemTime(RETRY_AT);
    await expect(
      consumeOwnerDataExportQueueMessage({
        payload: published.payload,
        deliveryStore: requireState(state.deliveries, "Delivery store"),
        now: RETRY_AT,
        metadata: {
          topicName: published.topic,
          messageId: "owner-export-message",
          deliveryCount: 2,
        },
      }),
    ).resolves.toMatchObject({ status: "processed" });
    await expect(
      requireState(state.deliveries, "Delivery store").getBackgroundJobDeliveryForConsumer(
        published.payload.deliveryId,
      ),
    ).resolves.toMatchObject({ status: "published" });
    expect(state.generate).toHaveBeenCalledTimes(2);
    expect(state.externalNotification).not.toHaveBeenCalled();
    expect(state.externalDraftCreation).not.toHaveBeenCalled();

    const jobId = (requested as { ok: true; view: { id: string } }).view.id;
    admittedOwnerOrNullSpy.mockResolvedValue(OWNER);
    const downloaded = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await downloaded.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );

    admittedOwnerOrNullSpy.mockResolvedValue(null);
    const refusedUnauthenticated = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });
    admittedOwnerOrNullSpy.mockResolvedValue(OTHER_OWNER);
    const refusedOtherOwner = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });
    expect(refusedUnauthenticated.status).toBe(404);
    expect(refusedOtherOwner.status).toBe(404);
    expect(await refusedOtherOwner.text()).toBe(await refusedUnauthenticated.text());
  });
});
