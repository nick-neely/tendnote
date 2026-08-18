"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

type VariantKey = "a" | "b" | "c";

type Variant = {
  key: VariantKey;
  name: string;
  thesis: string;
  eve: {
    eyebrow: string;
    title: string;
    paragraphs: string[];
    evidence: string[];
    limits: string;
  };
  thread: string[];
};

const placeholders = [
  "[EXACT CASE STUDY PERMALINK AT PUBLISHED COMMIT]",
  "[EXACT PUBLISHED COMMIT PERMALINK]",
  "[IMMUTABLE CLEAN EVALUATION SUMMARY + RAW EVIDENCE]",
  "[ADR 0230 PERMALINK AT PUBLISHED COMMIT]",
];

const variants = [
  {
    key: "a",
    name: "The inspectable claim",
    thesis: "Lead with the surprising claim, then make inspection the invitation.",
    eve: {
      eyebrow: "Technical field note · Tendnote",
      title:
        "Can an agent-built personal system carry privacy invariants you can actually inspect?",
      paragraphs: [
        "I built Tendnote largely through coding agents, then preserved the decisions, tests, evaluation output, and full git history so a skeptical reader does not have to take the privacy story on trust.",
        "Tendnote makes its privacy rules concrete: who owns a record, who may see it, what evidence may cross a boundary, which actions need approval, and how the system behaves when authority is unclear.",
        "The case study traces those rules from design decisions into code and tests, then checks them against a deterministic evaluation. Every link below points to the exact published commit.",
      ],
      evidence: [
        "Canonical Case Study at the exact published commit",
        "Clean first-sample deterministic run and preserved raw evidence",
        "ADR 0230, which bounds the claim",
        "All repository history, published unchanged",
      ],
      limits:
        "Limits: I have personally read roughly 15% of the code; this is the suite’s first Phase 9a execution, not a continuous track record; Household collaboration has not been exercised with a second person; and the clean run supports only the behavior it evaluates.",
    },
    thread: [
      "I built a privacy-sensitive personal system largely with coding agents. Now I’m publishing the code and the trail behind its privacy rules so other people can check the work. 1/5",
      "Tendnote keeps relationship context private and consent-first. Its decision records and code spell out ownership, access, evidence boundaries, approval, and failure behavior. 2/5",
      "For publication I ran a deterministic gate and preserved the exact result, raw artifacts, decision record, commit, and full git history as one citable source bundle. 3/5",
      "I’ve personally read about 15% of the code. This is the first Phase 9a run, and Household use has yet to involve a second person. The gate covers only the behavior it evaluates. 4/5",
      "Read the case study and follow the source trail: [CANONICAL BUNDLE LINK] 5/5",
    ],
  },
  {
    key: "b",
    name: "The uncomfortable hook + inspection path",
    thesis:
      "Earn attention with the trust problem, then answer it with an inspectable evidence path.",
    eve: {
      eyebrow: "An uncomfortable open-source case study",
      title: "I’m publishing a private relationship assistant after reading only ~15% of its code.",
      paragraphs: [
        "That makes me uneasy too. Tendnote was built largely through coding agents, and it handles private relationship context.",
        "Publishing it responsibly means the privacy story has to stand without relying on my familiarity with the code. Tendnote spells out who owns each record, who may see it, what evidence may cross a boundary, which actions need approval, and how the system behaves when authority is unclear.",
        "The case study traces those rules from design decisions into code and tests, then checks them against a deterministic evaluation. Every link below points to the exact published commit so you can follow the same trail.",
      ],
      evidence: [
        "Read the Case Study at the published commit",
        "Inspect the clean first-sample run and raw output",
        "See ADR 0230 for the limits of the claim",
        "Trace the work through the complete git history",
      ],
      limits:
        "Limits: I have personally read roughly 15% of the code; this is the suite’s first Phase 9a execution, not a continuous track record; Household collaboration has not been exercised with a second person; and the clean run supports only the behavior it evaluates.",
    },
    thread: [
      "I’m open-sourcing a privacy-sensitive relationship assistant after personally reading about 15% of its code. I’m uneasy about that too. 1/5",
      "Most of Tendnote was built through coding agents. Publishing it responsibly means its privacy rules have to stand without relying on my familiarity with the code. 2/5",
      "The case study traces ownership, access, evidence, approval, and failure rules from design decisions into code and tests. A clean deterministic run checks the behavior covered by the suite. 3/5",
      "This is the first Phase 9a run, and Household use has yet to involve a second person. The gate covers only the behavior it evaluates. 4/5",
      "Read the case study and follow the source trail at the exact published commit: [CANONICAL BUNDLE LINK] 5/5",
    ],
  },
  {
    key: "c",
    name: "The audit packet",
    thesis: "Treat the launch as a compact release note for skeptical builders.",
    eve: {
      eyebrow: "Publication record · Tendnote",
      title: "Tendnote’s publication packet: claim, proof, and known limits",
      paragraphs: [
        "Tendnote is an agent-built, consent-first relationship memory system. Before making the repository public, I assembled a single audit path for its privacy-sensitive design invariants.",
        "The publication record brings the case study, exact repository commit, clean deterministic result, raw output, governing decision, and complete history into one source trail.",
      ],
      evidence: [
        "CLAIM — agent-built software can carry inspectable privacy invariants",
        "DESIGN — ownership, audience, evidence, approval, fail-closed behavior",
        "PROOF — clean deterministic result for the evaluated cases",
        "SOURCE — case study, ADR, repository commit, and raw evidence",
      ],
      limits:
        "Coverage boundary: ~15% personally read; first Phase 9a suite execution; no two-person Household exercise; evaluated behavior only.",
    },
    thread: [
      "Publication packet for an agent-built, privacy-sensitive system: one claim, one exact commit, and an evidence trail you can inspect. 1/5",
      "CLAIM: agentic development can preserve explicit privacy rules when the decisions, code, tests, and failures remain open to inspection. 2/5",
      "PACKET: canonical case study → ADR 0230 → clean deterministic result + raw artifacts → preserved git history. 3/5",
      "BOUNDARY: ~15% personally read; first Phase 9a run; no second-person Household exercise; no blanket correctness claim. 4/5",
      "Inspect the immutable source bundle: [CANONICAL BUNDLE LINK] 5/5",
    ],
  },
] satisfies [Variant, Variant, Variant];

function isVariantKey(value: string | null): value is VariantKey {
  return variants.some((variant) => variant.key === value);
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const router = useRouter();
  const index = variants.findIndex((variant) => variant.key === current);

  function move(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length] ?? variants[0];
    router.replace(`?variant=${next.key}`);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white shadow-2xl">
      <button
        className="rounded-full px-3 py-1 hover:bg-slate-800"
        onClick={() => move(-1)}
        type="button"
        aria-label="Previous variant"
      >
        ←
      </button>
      <span className="min-w-56 text-center font-medium">
        {current.toUpperCase()} — {(variants[index] ?? variants[0]).name}
      </span>
      <button
        className="rounded-full px-3 py-1 hover:bg-slate-800"
        onClick={() => move(1)}
        type="button"
        aria-label="Next variant"
      >
        →
      </button>
    </div>
  );
}

function EvidencePlaceholders() {
  return (
    <aside className="rounded-2xl border border-dashed border-amber-500/60 bg-amber-50 p-5 text-amber-950">
      <p className="text-xs font-bold uppercase tracking-[0.18em]">Locked until publication</p>
      <ul className="mt-3 space-y-2 font-mono text-xs">
        {placeholders.map((placeholder) => (
          <li key={placeholder}>{placeholder}</li>
        ))}
      </ul>
    </aside>
  );
}

function EvePost({ variant }: { variant: Variant }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
      <header className="border-b border-stone-200 bg-stone-50 px-6 py-5 sm:px-9">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-800">
          {variant.eve.eyebrow}
        </p>
        <h2 className="mt-3 max-w-3xl font-serif text-3xl leading-tight text-stone-950 sm:text-4xl">
          {variant.eve.title}
        </h2>
      </header>
      <div className="grid gap-8 px-6 py-7 sm:px-9 lg:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-5 text-[1.02rem] leading-8 text-stone-700">
          {variant.eve.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <p className="border-l-4 border-stone-900 pl-4 text-sm font-medium leading-6 text-stone-900">
            {variant.eve.limits}
          </p>
        </div>
        <div className="space-y-5">
          <section className="rounded-2xl bg-slate-950 p-5 text-slate-100">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
              Inspection path
            </p>
            <ol className="mt-4 space-y-3 text-sm leading-6">
              {variant.eve.evidence.map((item, index) => (
                <li key={item}>
                  <span className="mr-2 text-emerald-300">0{index + 1}</span>
                  {item}
                </li>
              ))}
            </ol>
          </section>
          <EvidencePlaceholders />
        </div>
      </div>
    </article>
  );
}

function XThread({ variant }: { variant: Variant }) {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-600">
            X · compact thread
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">The same claim, compressed</h2>
        </div>
        <p className="text-right text-xs text-slate-600">
          One visible bundle link
          <br />
          No moving branch URLs
        </p>
      </div>
      <div className="space-y-3">
        {variant.thread.map((post, index) => (
          <article
            className="relative rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
            key={post}
          >
            {index < variant.thread.length - 1 && (
              <div className="absolute -bottom-4 left-9 h-5 w-px bg-slate-300" />
            )}
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white">
                TN
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  Tendnote <span className="font-normal text-slate-600">@tendnote</span>
                </p>
                <p className="mt-1 whitespace-pre-line text-[0.97rem] leading-6 text-slate-800">
                  {post}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Phase9aLaunchPrototype() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("variant");
  const current: VariantKey = isVariantKey(requested) ? requested : "b";
  const variant = variants.find((candidate) => candidate.key === current) ?? variants[0];

  return (
    <main className="min-h-screen bg-[#f4f2ec] px-4 pb-28 pt-8 text-slate-950 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 grid gap-4 border-b border-slate-300 pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-rose-700">
              Internal prototype · never publish from this screen
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
              Phase 9a channel-native introductions
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              Three structures for one careful claim. Current thesis:{" "}
              <strong className="text-slate-900">{variant.thesis}</strong>
            </p>
          </div>
          <div className="rounded-xl border border-slate-300 bg-white/70 px-4 py-3 text-sm text-slate-600">
            Eve community first
            <br />X follows · no Hacker News
          </div>
        </header>

        <div className="space-y-10">
          <EvePost variant={variant} />
          <XThread variant={variant} />
        </div>
      </div>
      <PrototypeSwitcher current={current} />
    </main>
  );
}
