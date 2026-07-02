import { createHash } from "node:crypto";
import { normalizeEmailContactValue, normalizePhoneContactValue } from "@tendnote/domain";

export type CleanupPreviewInputKind = "auto" | "csv" | "json" | "text" | "vcard";
export type CleanupPreviewInputSource = "paste" | "file_text" | "sandbox" | "discord_attachment";
export type CleanupPreviewCandidateKind =
  | "person"
  | "memory"
  | "contact_method"
  | "source_record"
  | "followup";

export type CleanupPreviewCandidate = {
  id: string;
  kind: CleanupPreviewCandidateKind;
  normalizedKey: string;
  title: string;
  value: string;
  sourceText: string;
  confidence: "high" | "medium" | "low";
  reviewOnly: true;
  writesRequireExplicitConfirmation: true;
};

export type CleanupPreview = {
  id: string;
  ownerUserId: string;
  inputKind: Exclude<CleanupPreviewInputKind, "auto">;
  source: Exclude<CleanupPreviewInputSource, "discord_attachment">;
  summary: {
    totalCandidates: number;
    duplicateCandidates: number;
    byKind: Record<CleanupPreviewCandidateKind, number>;
  };
  candidates: CleanupPreviewCandidate[];
};

export type CreateCleanupPreviewInput = {
  ownerUserId: string;
  inputText: string;
  inputKind?: CleanupPreviewInputKind;
  source?: CleanupPreviewInputSource;
};

type ParsedEntry = {
  name?: string;
  email?: string;
  phone?: string;
  birthday?: string;
  note?: string;
  followup?: string;
  sourceText: string;
};

const emptyCounts: Record<CleanupPreviewCandidateKind, number> = {
  person: 0,
  memory: 0,
  contact_method: 0,
  source_record: 0,
  followup: 0,
};

export function createCleanupPreview(input: CreateCleanupPreviewInput): CleanupPreview {
  const source = input.source ?? "paste";
  if (source === "discord_attachment") {
    throw new Error("Discord attachments are not a cleanup preview input path.");
  }

  const text = input.inputText.trim();
  const inputKind = resolveInputKind(text, input.inputKind ?? "auto");
  const parsed = parseInput(text, inputKind);
  const rawCandidates = parsed.flatMap(entryToCandidates);
  const { candidates, duplicateCandidates } = dedupeCandidates(rawCandidates);

  return {
    id: previewId(input.ownerUserId, inputKind, text),
    ownerUserId: input.ownerUserId,
    inputKind,
    source,
    summary: {
      totalCandidates: candidates.length,
      duplicateCandidates,
      byKind: countByKind(candidates),
    },
    candidates,
  };
}

function resolveInputKind(
  text: string,
  requested: CleanupPreviewInputKind,
): Exclude<CleanupPreviewInputKind, "auto"> {
  if (requested !== "auto") return requested;
  if (looksLikeJson(text)) return "json";
  if (/BEGIN:VCARD/i.test(text)) return "vcard";
  if (looksLikeCsv(text)) return "csv";
  return "text";
}

function parseInput(text: string, kind: Exclude<CleanupPreviewInputKind, "auto">): ParsedEntry[] {
  if (!text) return [];
  if (kind === "json") return parseJsonEntries(text);
  if (kind === "vcard") return parseVcardEntries(text);
  if (kind === "csv") return parseCsvEntries(text);
  return parseTextEntries(text);
}

function parseJsonEntries(text: string): ParsedEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return parseTextEntries(text);
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter(isRecord).map((row) => {
    const name = stringField(row, ["displayName", "display_name", "name", "fullName"]);
    const email = stringField(row, ["email", "emailAddress"]);
    const phone = stringField(row, ["phone", "phoneNumber", "tel"]);
    const birthday = stringField(row, ["birthday", "birthdate"]);
    const note = stringField(row, ["note", "notes", "memory", "context"]);
    const followup = stringField(row, ["followup", "followUp", "reminder", "nextAction"]);
    return { name, email, phone, birthday, note, followup, sourceText: JSON.stringify(row) };
  });
}

function parseVcardEntries(text: string): ParsedEntry[] {
  return text
    .split(/END:VCARD/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/);
      return {
        name: vcardValue(lines, "FN") ?? normalizeVcardStructuredName(vcardValue(lines, "N")),
        email: vcardValue(lines, "EMAIL"),
        phone: vcardValue(lines, "TEL"),
        birthday: vcardValue(lines, "BDAY"),
        note: vcardValue(lines, "NOTE"),
        sourceText: `${chunk}\nEND:VCARD`,
      };
    });
}

function parseCsvEntries(text: string): ParsedEntry[] {
  const rows = parseCsv(text);
  const [header, ...body] = rows;
  if (!header) return [];
  const normalizedHeader = header.map((value) => normalizeHeader(value));

  return body.map((row) => {
    const fields = Object.fromEntries(
      normalizedHeader.map((key, index) => [key, row[index] ?? ""]),
    );
    return {
      name: pickField(fields, ["displayname", "name", "fullname"]),
      email: pickField(fields, ["email", "emailaddress"]),
      phone: pickField(fields, ["phone", "phonenumber", "tel"]),
      birthday: pickField(fields, ["birthday", "birthdate"]),
      note: pickField(fields, ["note", "notes", "memory", "context"]),
      followup: pickField(fields, ["followup", "followup", "reminder", "nextaction"]),
      sourceText: row.join(", "),
    };
  });
}

function parseTextEntries(text: string): ParsedEntry[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const email = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      const phone = line.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
      const birthday = line.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)?.[0];
      const note = /(?:note|memory|context):/i.test(line) ? afterColon(line) : undefined;
      const followup = /(?:follow ?up|reminder):/i.test(line) ? afterColon(line) : undefined;
      const name =
        note || followup
          ? undefined
          : line
              .replace(email ?? "", "")
              .replace(phone ?? "", "")
              .replace(/\b(?:birthday|bday)\b:?\s*/gi, "")
              .replace(/[<>()]/g, "")
              .trim();
      return { name, email, phone, birthday, note, followup, sourceText: line };
    });
}

function entryToCandidates(entry: ParsedEntry): CleanupPreviewCandidate[] {
  const candidates: CleanupPreviewCandidate[] = [];
  const name = clean(entry.name);
  const birthday = normalizeBirthday(entry.birthday);

  if (name) {
    candidates.push(
      candidate("person", `person:${normalizeText(name)}`, name, name, entry.sourceText, "medium"),
    );
  }
  if (entry.email) {
    const normalized = normalizeEmailContactValue(entry.email);
    if (normalized) {
      candidates.push(
        candidate(
          "contact_method",
          `email:${normalized}`,
          name ? `${name} email` : "Email address",
          normalized,
          entry.sourceText,
          "high",
        ),
      );
    }
  }
  if (entry.phone) {
    const normalized = normalizePhoneContactValue(entry.phone).normalizedValue;
    if (normalized) {
      candidates.push(
        candidate(
          "contact_method",
          `phone:${normalized}`,
          name ? `${name} phone` : "Phone number",
          normalized,
          entry.sourceText,
          "high",
        ),
      );
    }
  }
  if (birthday && name) {
    candidates.push(
      candidate(
        "memory",
        `memory:birthday:${normalizeText(name)}:${birthday}`,
        `${name} birthday`,
        birthday,
        entry.sourceText,
        "medium",
      ),
    );
  }
  if (clean(entry.note)) {
    const value = clean(entry.note) as string;
    candidates.push(
      candidate(
        "memory",
        `memory:note:${normalizeText(value)}`,
        name ? `${name} note` : "Memory note",
        value,
        entry.sourceText,
        "low",
      ),
      candidate(
        "source_record",
        `source_record:${normalizeText(value)}`,
        "Cleanup source record",
        value,
        entry.sourceText,
        "low",
      ),
    );
  }
  if (clean(entry.followup)) {
    const value = clean(entry.followup) as string;
    candidates.push(
      candidate(
        "followup",
        `followup:${normalizeText(name ?? "")}:${normalizeText(value)}`,
        name ? `${name} follow-up` : "Follow-up",
        value,
        entry.sourceText,
        "low",
      ),
    );
  }

  return candidates;
}

function candidate(
  kind: CleanupPreviewCandidateKind,
  normalizedKey: string,
  title: string,
  value: string,
  sourceText: string,
  confidence: CleanupPreviewCandidate["confidence"],
): CleanupPreviewCandidate {
  return {
    id: stableId(kind, normalizedKey),
    kind,
    normalizedKey,
    title,
    value,
    sourceText,
    confidence,
    reviewOnly: true,
    writesRequireExplicitConfirmation: true,
  };
}

function dedupeCandidates(candidates: CleanupPreviewCandidate[]) {
  const byKey = new Map<string, CleanupPreviewCandidate>();
  let duplicateCandidates = 0;

  for (const item of candidates) {
    const key = `${item.kind}:${item.normalizedKey}`;
    if (byKey.has(key)) {
      duplicateCandidates += 1;
      continue;
    }
    byKey.set(key, item);
  }

  return { candidates: [...byKey.values()], duplicateCandidates };
}

function countByKind(candidates: CleanupPreviewCandidate[]) {
  const counts = { ...emptyCounts };
  for (const item of candidates) {
    counts[item.kind] += 1;
  }
  return counts;
}

function looksLikeJson(text: string) {
  return /^\s*[{[]/.test(text);
}

function looksLikeCsv(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes(",") && /name|email|phone|note|birthday/i.test(firstLine);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function vcardValue(lines: string[], key: string) {
  const line = lines.find((value) => value.toUpperCase().startsWith(key));
  return line?.split(":").slice(1).join(":").trim();
}

function normalizeVcardStructuredName(value: string | undefined) {
  if (!value) return undefined;
  const [family, given, additional, prefix, suffix] = value.split(";");
  return [prefix, given, additional, family, suffix].map(clean).filter(Boolean).join(" ");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  rows.push(row);
  return rows.filter((values) => values.some(Boolean));
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickField(fields: Record<string, string>, keys: string[]) {
  return keys.map((key) => fields[key]).find((value) => value?.trim());
}

function afterColon(value: string) {
  return value.split(":").slice(1).join(":").trim();
}

function clean(value: string | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function normalizeBirthday(value: string | undefined) {
  const cleaned = clean(value);
  if (!cleaned) return undefined;
  const iso = cleaned.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) return iso;
  const slash = cleaned.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!slash) return cleaned;
  const month = slash[1]?.padStart(2, "0");
  const day = slash[2]?.padStart(2, "0");
  const year = slash[3] ? (slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : "0000";
  return `${year}-${month}-${day}`;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@+]+/g, " ")
    .trim();
}

function previewId(ownerUserId: string, inputKind: string, text: string) {
  return stableId("cleanup_preview", `${ownerUserId}:${inputKind}:${text}`);
}

function stableId(prefix: string, value: string) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
