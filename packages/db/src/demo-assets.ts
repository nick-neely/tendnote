import type {
  assetEvidence,
  assetLinks,
  assetMemories,
  assets,
  generalActionAssets,
  generalActions,
  householdMemberships,
  householdWorkspaces,
} from "./schema";

/**
 * The Phase 6 Asset Memory demo world: the refrigerator water filter proof scenario
 * (#196), seeded as data rather than told as a story.
 *
 * It exists so the Eve asset evals have something true to answer *from*. Every record
 * here is load-bearing for a boundary the evals prove:
 *
 * - a household Asset (the fridge) whose reviewed details carry exact values — the
 *   filter size an answer lives or dies on;
 * - a second Asset (the filter) promoted from the Phase 5 asset hint, linked back to
 *   the fridge and carrying the recurring Action that hint became;
 * - a **suggested** Asset Memory the owner has not reviewed, which no answer may ever
 *   state as a fact;
 * - a co-member's **private** memory and receipt hanging under that household Asset,
 *   which the owner's own answers must never surface — the child-scope ceiling, from
 *   the other side;
 * - **dismissed** proposals already linked to the filter's replacement interval and to the
 *   car's oil-change interval, so a proposal pass over either has nothing left to say. That
 *   is the nag-prevention rule (#203): a detail the owner has turned down never comes back.
 *
 * The dev app and the eval database seed from the same rows, so what a developer sees
 * in the Assets surface is exactly what the evals reason about.
 */

const at = (iso: string) => new Date(iso);
const now = at("2026-06-24T12:00:00.000Z");

const demoOwnerUserId = "demo-user";
/** The household co-member: real enough to own private records the owner cannot see. */
export const demoMemberUserId = "demo-member";

type DemoHousehold = typeof householdWorkspaces.$inferInsert;
type DemoHouseholdMembership = typeof householdMemberships.$inferInsert;
type DemoAsset = typeof assets.$inferInsert;
type DemoAssetMemory = typeof assetMemories.$inferInsert;
type DemoAssetEvidence = typeof assetEvidence.$inferInsert;
type DemoAssetLink = typeof assetLinks.$inferInsert;
type DemoGeneralAction = typeof generalActions.$inferInsert;
type DemoGeneralActionAsset = typeof generalActionAssets.$inferInsert;

const assetIds = {
  household: "9f9908d9-dbfb-48be-bd0b-809ba364d6e3",
  ownerMembership: "36c6bb55-3376-485d-bf6d-6d5332826127",
  memberMembership: "0ba22fd6-ce65-41e4-aa54-fe519ed23acf",
  fridge: "ad3f4a95-e7a8-4d4a-af5d-81f050ab36d2",
  filter: "e9168a2f-fd85-47aa-aee0-9b6fdd9e03ce",
  memoryFilterSize: "47422602-b5c4-417d-9595-d01f426d0f3b",
  memoryModelNumber: "c18e370c-57f6-4a8e-9d51-75ee5e2bdd8a",
  memoryWarranty: "9838c345-6d46-4ee7-a50b-191c08d1538d",
  memoryReplacementInterval: "b3604275-127a-446b-b6bb-44c88251a01f",
  memorySuggestedIceMaker: "9aca61c3-447c-4085-82f0-eeeb127e5ec7",
  memoryMemberPrivate: "ba6a282c-8f43-4ba6-b3c6-edf01dacd427",
  evidenceFridgeReceipt: "daf49b9c-df7a-411e-a10f-bca71747b796",
  evidenceFridgeManual: "7d2af1e4-67cb-4b88-9ea3-83dbfdb73421",
  evidenceFilterReceipt: "93e0f18f-e728-4f78-87dd-1bcbf1ae666e",
  evidenceMemberPrivate: "49bfd3cb-e4a6-4761-ac05-8557b54c2aa0",
  linkFilterFitsFridge: "85b6d8b4-d7a6-49fb-a95e-23de203bf067",
  car: "966eae5a-4686-47f3-8635-412a8e4431b9",
  memoryOilChangeInterval: "619bc96c-a76d-4afd-9d07-a078a8c3b075",
  actionDismissedOilChange: "fad185ae-62a0-457e-8afe-50673ba02a1c",
  actionLinkDismissedOilChange: "5b3921d2-a556-409d-8e40-e7de98816537",
  actionReplaceFilter: "6c1d5a67-6b0f-4a55-9a56-0a3a3f2a1d21",
  actionDismissedInterval: "1f0f4d0e-30e0-4c4a-9d21-2f6dd3f0b6c3",
  actionLinkRoutine: "5e8b3a54-8f3d-4a9c-a3d9-2c0f9f3a4c11",
  actionLinkDismissed: "2a2f0f9c-4a8b-4a2e-9f0a-64e2b1c9d7a4",
} as const;

/** The fridge, by id — the seed rebuilds its snapshot cache and then deliberately staleens it. */
export const demoFridgeAssetId: string = assetIds.fridge;

/**
 * The prose of a snapshot that has fallen behind its records (#196 decisions; ADR 0009 for
 * Assets): it still names the filter cartridge the fridge USED to take. Nothing regenerates it,
 * because the seed writes it over a freshly-built cache whose fingerprint still matches the
 * records — which is exactly the state a real stale cache is in, and the only state in which the
 * question worth asking can be asked: when the summary and the records disagree, which one does
 * the answer come from? A snapshot is a rebuildable cache, never a source of truth, and an eval
 * that ran against a world where the two agreed could never tell the difference.
 */
export const DEMO_STALE_FRIDGE_SNAPSHOT: string = [
  "Kitchen refrigerator is an appliance you track.",
  "Confirmed: Filter size: XWFE. Model number: WRF535SWHZ. Warranty expires: 2027-03-14.",
  "Evidence on file: Appliance store receipt (receipt), Refrigerator manual (manual).",
  "Related: fits Refrigerator water filter.",
].join("\n");

export const demoHouseholdWorkspaces: DemoHousehold[] = [
  {
    id: assetIds.household,
    ownerUserId: demoOwnerUserId,
    name: "Home",
    defaultScope: "private",
    createdAt: now,
    updatedAt: now,
  },
];

export const demoHouseholdMemberships: DemoHouseholdMembership[] = [
  {
    id: assetIds.ownerMembership,
    householdId: assetIds.household,
    userId: demoOwnerUserId,
    invitedByUserId: demoOwnerUserId,
    role: "owner",
    status: "active",
    invitedAt: at("2026-01-04T12:00:00.000Z"),
    acceptedAt: at("2026-01-04T12:00:00.000Z"),
    removedAt: null,
    createdAt: at("2026-01-04T12:00:00.000Z"),
    updatedAt: at("2026-01-04T12:00:00.000Z"),
  },
  {
    id: assetIds.memberMembership,
    householdId: assetIds.household,
    userId: demoMemberUserId,
    invitedByUserId: demoOwnerUserId,
    role: "member",
    status: "active",
    invitedAt: at("2026-01-04T12:00:00.000Z"),
    acceptedAt: at("2026-01-05T09:00:00.000Z"),
    removedAt: null,
    createdAt: at("2026-01-04T12:00:00.000Z"),
    updatedAt: at("2026-01-05T09:00:00.000Z"),
  },
];

export const demoAssets: DemoAsset[] = [
  {
    id: assetIds.fridge,
    ownerUserId: demoOwnerUserId,
    name: "Kitchen refrigerator",
    kind: "appliance",
    status: "active",
    scope: "household",
    householdId: assetIds.household,
    archivedAt: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-02-10T17:00:00.000Z"),
    updatedAt: at("2026-02-10T17:00:00.000Z"),
  },
  {
    // The Phase 5 asset hint ("refrigerator water filter") grown into a real Asset (#199).
    id: assetIds.filter,
    ownerUserId: demoOwnerUserId,
    name: "Refrigerator water filter",
    kind: "item",
    status: "active",
    scope: "household",
    householdId: assetIds.household,
    archivedAt: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-03-02T19:30:00.000Z"),
    updatedAt: at("2026-03-02T19:30:00.000Z"),
  },
  {
    // The nag-rule fixture, on an asset whose name nothing else can be confused with: its
    // one recurring detail already proposed a reminder, and the owner dismissed it.
    id: assetIds.car,
    ownerUserId: demoOwnerUserId,
    name: "Toyota Corolla",
    kind: "vehicle",
    status: "active",
    scope: "household",
    householdId: assetIds.household,
    archivedAt: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-01-20T16:00:00.000Z"),
    updatedAt: at("2026-01-20T16:00:00.000Z"),
  },
];

export const demoAssetMemories: DemoAssetMemory[] = [
  {
    // The exact value the whole proof scenario hangs on.
    id: assetIds.memoryFilterSize,
    assetId: assetIds.fridge,
    ownerUserId: demoOwnerUserId,
    status: "active",
    label: "Filter size",
    valueJson: { type: "text", text: "EDR1RXD1" },
    notes: "Printed inside the door frame, above the crisper drawer.",
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-02-10T17:05:00.000Z"),
    updatedAt: at("2026-02-10T17:05:00.000Z"),
  },
  {
    id: assetIds.memoryModelNumber,
    assetId: assetIds.fridge,
    ownerUserId: demoOwnerUserId,
    status: "active",
    label: "Model number",
    valueJson: { type: "text", text: "WRF535SWHZ" },
    notes: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-02-10T17:06:00.000Z"),
    updatedAt: at("2026-02-10T17:06:00.000Z"),
  },
  {
    // A dated detail with no prior proposal: the one thing a proposal pass may still say.
    id: assetIds.memoryWarranty,
    assetId: assetIds.fridge,
    ownerUserId: demoOwnerUserId,
    status: "active",
    label: "Warranty expires",
    valueJson: { type: "date", date: "2027-03-14" },
    notes: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-02-10T17:07:00.000Z"),
    updatedAt: at("2026-02-10T17:07:00.000Z"),
  },
  {
    // The detail whose proposal the owner already dismissed (see the dismissed action
    // and its link below). A proposal pass over the filter must stay silent (#203).
    id: assetIds.memoryReplacementInterval,
    assetId: assetIds.filter,
    ownerUserId: demoOwnerUserId,
    status: "active",
    label: "Replacement interval",
    valueJson: { type: "interval", interval: 6, unit: "month" },
    notes: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-03-02T19:35:00.000Z"),
    updatedAt: at("2026-03-02T19:35:00.000Z"),
  },
  {
    // Review-gated: inferred, never reviewed. No answer may state it as a fact.
    id: assetIds.memorySuggestedIceMaker,
    assetId: assetIds.fridge,
    ownerUserId: demoOwnerUserId,
    status: "suggested",
    label: "Ice maker filter size",
    valueJson: { type: "text", text: "F2WC9I1" },
    notes: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-05-18T14:00:00.000Z"),
    updatedAt: at("2026-05-18T14:00:00.000Z"),
  },
  {
    // A co-member's private detail under the household Asset: the child-scope ceiling
    // from the other side. The owner's answers must never surface it.
    id: assetIds.memoryMemberPrivate,
    assetId: assetIds.fridge,
    ownerUserId: demoMemberUserId,
    status: "active",
    label: "Compressor repair quote",
    valueJson: { type: "amount", amount: 840, currency: "USD" },
    notes: "Paid it from my own account — not shared with the household.",
    scope: "private",
    householdId: null,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoMemberUserId,
    lastActorUserId: demoMemberUserId,
    createdAt: at("2026-05-30T20:00:00.000Z"),
    updatedAt: at("2026-05-30T20:00:00.000Z"),
  },
  {
    // The car's only timed detail. Its proposal was made once and dismissed (below), so a
    // fresh pass over the car has nothing to say — the nag rule, with nothing to hide behind.
    id: assetIds.memoryOilChangeInterval,
    assetId: assetIds.car,
    ownerUserId: demoOwnerUserId,
    status: "active",
    label: "Oil change interval",
    valueJson: { type: "interval", interval: 6, unit: "month" },
    notes: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-01-20T16:05:00.000Z"),
    updatedAt: at("2026-01-20T16:05:00.000Z"),
  },
];

export const demoAssetEvidence: DemoAssetEvidence[] = [
  {
    id: assetIds.evidenceFridgeReceipt,
    assetId: assetIds.fridge,
    ownerUserId: demoOwnerUserId,
    kind: "receipt",
    label: "Appliance store receipt",
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    url: null,
    capturedText: "Appliance World — Kitchen refrigerator — paid in full.",
    moneyJson: { amount: 1899, currency: "USD" },
    purchasedOn: "2024-11-02",
    renewsOn: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-02-10T17:10:00.000Z"),
    updatedAt: at("2026-02-10T17:10:00.000Z"),
  },
  {
    id: assetIds.evidenceFridgeManual,
    assetId: assetIds.fridge,
    ownerUserId: demoOwnerUserId,
    kind: "manual",
    label: "Refrigerator manual",
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    url: "https://example.com/manuals/wrf535swhz.pdf",
    capturedText: null,
    moneyJson: null,
    purchasedOn: null,
    renewsOn: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-02-10T17:12:00.000Z"),
    updatedAt: at("2026-02-10T17:12:00.000Z"),
  },
  {
    id: assetIds.evidenceFilterReceipt,
    assetId: assetIds.filter,
    ownerUserId: demoOwnerUserId,
    kind: "receipt",
    label: "Filter two-pack receipt",
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    url: null,
    capturedText: "Two-pack of replacement filters.",
    moneyJson: { amount: 54.99, currency: "USD" },
    purchasedOn: "2026-03-02",
    renewsOn: null,
    scope: "household",
    householdId: assetIds.household,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    createdAt: at("2026-03-02T19:40:00.000Z"),
    updatedAt: at("2026-03-02T19:40:00.000Z"),
  },
  {
    // A co-member's private receipt under the household Asset — never the owner's to see.
    id: assetIds.evidenceMemberPrivate,
    assetId: assetIds.fridge,
    ownerUserId: demoMemberUserId,
    kind: "receipt",
    label: "Compressor repair receipt",
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    url: null,
    capturedText: "Compressor swap, paid privately.",
    moneyJson: { amount: 840, currency: "USD" },
    purchasedOn: "2026-05-30",
    renewsOn: null,
    scope: "private",
    householdId: null,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: demoMemberUserId,
    lastActorUserId: demoMemberUserId,
    createdAt: at("2026-05-30T20:05:00.000Z"),
    updatedAt: at("2026-05-30T20:05:00.000Z"),
  },
];

export const demoAssetLinks: DemoAssetLink[] = [
  {
    // "The filter fits the refrigerator" — the fixed-vocabulary Related Asset Link (#202).
    id: assetIds.linkFilterFitsFridge,
    ownerUserId: demoOwnerUserId,
    fromAssetId: assetIds.filter,
    toAssetId: assetIds.fridge,
    relation: "fits",
    status: "active",
    sourceRecordId: null,
    createdAt: at("2026-03-02T19:45:00.000Z"),
    updatedAt: at("2026-03-02T19:45:00.000Z"),
  },
];

export const demoAssetGeneralActions: DemoGeneralAction[] = [
  {
    // The Phase 5 Routine the asset hint came from, now linked to the real Asset (#199).
    id: assetIds.actionReplaceFilter,
    ownerUserId: demoOwnerUserId,
    title: "Replace the refrigerator water filter",
    // Deliberately does NOT repeat the filter's part number. The filter size lives in exactly
    // one place — the reviewed Asset Memory on the fridge — so an answer that states it can
    // only have come from that record. A copy here would give a recall eval a second way to be
    // right, and an assertion with two ways to pass proves neither.
    notes: "Uses the cartridge the fridge takes.",
    links: [],
    status: "open",
    dueAt: at("2026-09-02T16:00:00.000Z"),
    deferUntil: null,
    recurrence: { interval: 6, unit: "month" },
    sourceRecordId: null,
    areaId: null,
    scope: "household",
    householdId: assetIds.household,
    assetHints: [{ label: "refrigerator water filter" }],
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    completedAt: null,
    createdAt: at("2026-03-02T19:30:00.000Z"),
    updatedAt: at("2026-03-02T19:30:00.000Z"),
  },
  {
    // The proposal the owner turned down. It stays dismissed: re-proposing what someone
    // just rejected is the nag loop the review gate exists to prevent (#203).
    id: assetIds.actionDismissedInterval,
    ownerUserId: demoOwnerUserId,
    title: "Replace Refrigerator water filter",
    notes:
      'Proposed from the "Replacement interval: every 6 months" detail on Refrigerator water filter.',
    links: [],
    status: "dismissed",
    dueAt: at("2026-09-02T16:00:00.000Z"),
    deferUntil: null,
    recurrence: { interval: 6, unit: "month" },
    sourceRecordId: null,
    areaId: null,
    scope: "household",
    householdId: assetIds.household,
    assetHints: [],
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    completedAt: null,
    createdAt: at("2026-05-04T15:00:00.000Z"),
    updatedAt: at("2026-05-06T15:00:00.000Z"),
  },
  {
    // The car's dismissed oil-change proposal — the one the nag eval asks about.
    id: assetIds.actionDismissedOilChange,
    ownerUserId: demoOwnerUserId,
    title: "Service Toyota Corolla",
    notes: 'Proposed from the "Oil change interval: every 6 months" detail on Toyota Corolla.',
    links: [],
    status: "dismissed",
    dueAt: at("2026-07-20T16:00:00.000Z"),
    deferUntil: null,
    recurrence: { interval: 6, unit: "month" },
    sourceRecordId: null,
    areaId: null,
    scope: "household",
    householdId: assetIds.household,
    assetHints: [],
    createdByUserId: demoOwnerUserId,
    lastActorUserId: demoOwnerUserId,
    completedAt: null,
    createdAt: at("2026-04-11T14:00:00.000Z"),
    updatedAt: at("2026-04-12T14:00:00.000Z"),
  },
];

export const demoGeneralActionAssets: DemoGeneralActionAsset[] = [
  {
    id: assetIds.actionLinkRoutine,
    ownerUserId: demoOwnerUserId,
    generalActionId: assetIds.actionReplaceFilter,
    assetId: assetIds.filter,
    hintLabel: "refrigerator water filter",
    assetMemoryId: null,
    createdAt: at("2026-03-02T19:30:00.000Z"),
  },
  {
    // The provenance that makes the dismissal stick: this detail already had its say.
    id: assetIds.actionLinkDismissed,
    ownerUserId: demoOwnerUserId,
    generalActionId: assetIds.actionDismissedInterval,
    assetId: assetIds.filter,
    hintLabel: null,
    assetMemoryId: assetIds.memoryReplacementInterval,
    createdAt: at("2026-05-04T15:00:00.000Z"),
  },
  {
    id: assetIds.actionLinkDismissedOilChange,
    ownerUserId: demoOwnerUserId,
    generalActionId: assetIds.actionDismissedOilChange,
    assetId: assetIds.car,
    hintLabel: null,
    assetMemoryId: assetIds.memoryOilChangeInterval,
    createdAt: at("2026-04-11T14:00:00.000Z"),
  },
];
