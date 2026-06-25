import type { Followup, Memory, Person, SourceRecord, SourceRecordPerson } from "@tendnote/domain";

const now = new Date("2026-06-24T12:00:00.000Z");

export const demoOwnerUserId = "demo-user";

const alexId = "8b5f52bf-7f5c-44b2-9c2b-f77c7ec9f010";
const jordanId = "d1367b4f-79fd-49fd-a3a7-a2807b15a47c";
const caseyId = "f29448de-bec8-48f1-91a5-2af8d55ecbd0";
const alexSourceRecordId = "d337739b-9dc9-4881-a924-aeb8abf3cc8e";
const caseySourceRecordId = "0ea0fc54-71d7-44af-b7a6-8ef31bc86ee7";

export const mockPeople: Person[] = [
  {
    id: alexId,
    ownerUserId: demoOwnerUserId,
    displayName: "Alex Morgan",
    firstName: "Alex",
    lastName: "Morgan",
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 4,
    profileBlurb: "Backend engineer exploring a new role.",
    source: "seed",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: jordanId,
    ownerUserId: demoOwnerUserId,
    displayName: "Jordan Rivera",
    firstName: "Jordan",
    lastName: "Rivera",
    birthday: null,
    relationshipType: "networking",
    closenessLevel: 3,
    profileBlurb: "Interview follow-up due next week.",
    source: "seed",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: caseyId,
    ownerUserId: demoOwnerUserId,
    displayName: "Casey Thompson",
    firstName: "Casey",
    lastName: "Thompson",
    birthday: "1990-07-02",
    relationshipType: "friend",
    closenessLevel: 4,
    profileBlurb: "Likes concise, low-key birthday texts.",
    source: "seed",
    createdAt: now,
    updatedAt: now,
  },
];

export const mockSourceRecords: SourceRecord[] = [
  {
    id: alexSourceRecordId,
    ownerUserId: demoOwnerUserId,
    sourceType: "seed",
    content: "Alex is job hunting and prefers backend platform work.",
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
    confidence: "high",
    sensitivity: "normal",
    scope: "private",
    importance: 3,
    metadataJson: {},
    createdAt: now,
    updatedAt: now,
  },
  {
    id: caseySourceRecordId,
    ownerUserId: demoOwnerUserId,
    sourceType: "seed",
    content: "Casey appreciates casual messages that do not overdo it.",
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
    confidence: "medium",
    sensitivity: "normal",
    scope: "private",
    importance: 3,
    metadataJson: {},
    createdAt: now,
    updatedAt: now,
  },
];

export const mockSourceRecordPeople: SourceRecordPerson[] = [
  {
    id: "e0329a22-8dfc-4a61-bf2d-2906d6b49e11",
    sourceRecordId: alexSourceRecordId,
    personId: alexId,
    role: "primary",
    createdAt: now,
  },
  {
    id: "f1d2faaa-315e-46f3-a39c-425b999a57e5",
    sourceRecordId: caseySourceRecordId,
    personId: caseyId,
    role: "primary",
    createdAt: now,
  },
];

export const mockMemories: Memory[] = [
  {
    id: "9e5cb115-261b-46cb-a72e-89fb90f025be",
    personId: alexId,
    ownerUserId: demoOwnerUserId,
    sourceRecordId: alexSourceRecordId,
    memoryType: "context",
    content: "Alex is job hunting and prefers backend platform work.",
    status: "approved",
    importance: 3,
    sensitivity: "normal",
    confidence: "high",
    scope: "private",
    approvedAt: now,
    dismissedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "b64c9818-9744-4f35-9fc4-0462c062c0f7",
    personId: caseyId,
    ownerUserId: demoOwnerUserId,
    sourceRecordId: caseySourceRecordId,
    memoryType: "preference",
    content: "Casey appreciates casual messages that do not overdo it.",
    status: "approved",
    importance: 3,
    sensitivity: "normal",
    confidence: "medium",
    scope: "private",
    approvedAt: now,
    dismissedAt: null,
    createdAt: now,
    updatedAt: now,
  },
];

export const mockFollowups: Followup[] = [
  {
    id: "44a67523-4080-4492-8de2-01309b21950d",
    personId: jordanId,
    ownerUserId: demoOwnerUserId,
    reason: "Check in after Jordan's interview.",
    dueAt: new Date("2026-06-26T15:00:00.000Z"),
    status: "open",
    cadence: null,
    lastPromptedAt: null,
    createdAt: now,
    updatedAt: now,
  },
];
