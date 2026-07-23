"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./prototype.module.css";

type Variant = "A" | "B" | "C";
type Surface = "today" | "list" | "detail" | "review" | "account";
type Phase = "shell" | "complete" | "failure";

const variantOrder: Variant[] = ["A", "B", "C"];
const variantNames: Record<Variant, string> = {
  A: "Shaped reserve",
  B: "Named regions",
  C: "Retained context",
};
const surfaceNames: Record<Surface, string> = {
  today: "Today",
  list: "People list",
  detail: "Person detail",
  review: "Review",
  account: "Account",
};
const surfaceControlNames: Record<Surface, string> = {
  today: "Today",
  list: "People",
  detail: "Person",
  review: "Review",
  account: "Account",
};
const surfaceOrder: Surface[] = ["today", "list", "detail", "review", "account"];
const phaseOrder: Phase[] = ["shell", "complete", "failure"];

export function InstantShellsPrototype({
  initialPhase,
  initialSurface,
  initialVariant,
}: {
  initialPhase: Phase;
  initialSurface: Surface;
  initialVariant: Variant;
}) {
  const router = useRouter();
  const [variant, setVariant] = useState(initialVariant);
  const [surface, setSurface] = useState(initialSurface);
  const [phase, setPhase] = useState(initialPhase);

  function setQuery(next: { variant?: Variant; surface?: Surface; phase?: Phase }) {
    const nextVariant = next.variant ?? variant;
    const nextSurface = next.surface ?? surface;
    const nextPhase = next.phase ?? phase;
    setVariant(nextVariant);
    setSurface(nextSurface);
    setPhase(nextPhase);
    router.replace(
      `/prototype/instant-shells?variant=${nextVariant}&surface=${nextSurface}&phase=${nextPhase}`,
      { scroll: false },
    );
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const current = variantOrder.indexOf(variant);
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      const next = variantOrder[(current + offset + variantOrder.length) % variantOrder.length];
      if (next) {
        setVariant(next);
        router.replace(
          `/prototype/instant-shells?variant=${next}&surface=${surface}&phase=${phase}`,
          { scroll: false },
        );
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [variant, surface, phase, router]);

  return (
    <div className={styles.prototype}>
      <aside className={styles.prototypeHeader}>
        <div>
          <strong>Throwaway prototype</strong>
          <span>Instant route shells · visual contract only</span>
        </div>
        <aside className={styles.legend} aria-label="Annotation legend">
          <span>
            <i className={styles.availableDot} />
            Available immediately
          </span>
          <span>
            <i className={styles.streamDot} />
            Streams next
          </span>
        </aside>
      </aside>

      <div className={styles.labControls}>
        <ControlGroup label="Route">
          {surfaceOrder.map((item) => (
            <ControlButton
              active={surface === item}
              key={item}
              onClick={() => setQuery({ surface: item })}
            >
              {surfaceControlNames[item]}
            </ControlButton>
          ))}
        </ControlGroup>
        <ControlGroup label="Moment">
          {phaseOrder.map((item) => (
            <ControlButton
              active={phase === item}
              key={item}
              onClick={() => setQuery({ phase: item })}
            >
              {item === "shell" ? "0–100 ms" : item === "complete" ? "Resolved" : "Failure"}
            </ControlButton>
          ))}
        </ControlGroup>
      </div>

      <main className={styles.app} aria-busy={phase === "shell"}>
        <DesktopHeader surface={surface} />
        <div className={styles.canvas}>
          {phase === "complete" ? (
            <CompleteSurface surface={surface} />
          ) : phase === "failure" ? (
            <FailureSurface surface={surface} variant={variant} />
          ) : variant === "A" ? (
            <ShapedReserve surface={surface} />
          ) : variant === "B" ? (
            <NamedRegions surface={surface} />
          ) : (
            <RetainedContext surface={surface} />
          )}
        </div>
        <MobileNav surface={surface} />
      </main>

      <nav className={styles.variantSwitcher} aria-label="Prototype variants">
        <button
          aria-label="Previous variant"
          onClick={() => {
            const index = variantOrder.indexOf(variant);
            setQuery({
              variant: variantOrder[(index - 1 + variantOrder.length) % variantOrder.length],
            });
          }}
          type="button"
        >
          ←
        </button>
        <div>
          <span>Variant {variant}</span>
          <strong>{variantNames[variant]}</strong>
        </div>
        <button
          aria-label="Next variant"
          onClick={() => {
            const index = variantOrder.indexOf(variant);
            setQuery({ variant: variantOrder[(index + 1) % variantOrder.length] });
          }}
          type="button"
        >
          →
        </button>
      </nav>
    </div>
  );
}

function ControlGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className={styles.controlGroup}>
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function ControlButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button aria-pressed={active} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function DesktopHeader({ surface }: { surface: Surface }) {
  return (
    <header className={styles.desktopHeader}>
      <div className={styles.brand}>
        <span>T</span>Tendnote
      </div>
      <nav aria-label="Primary prototype navigation">
        {["Today", "People", "Actions", "Assets", "Saved Items", "Account"].map((item) => (
          <span
            className={
              (surface === "today" && item === "Today") ||
              (surface === "list" && item === "People") ||
              (surface === "detail" && item === "People") ||
              (surface === "account" && item === "Account")
                ? styles.currentNav
                : undefined
            }
            key={item}
          >
            {item}
          </span>
        ))}
      </nav>
    </header>
  );
}

function MobileNav({ surface }: { surface: Surface }) {
  return (
    <nav className={styles.mobileNav} aria-label="Mobile prototype navigation">
      {["Today", "Search", "Capture", "Review", "Menu"].map((item) => (
        <span
          className={
            (surface === "today" && item === "Today") || (surface === "review" && item === "Review")
              ? styles.currentMobile
              : undefined
          }
          key={item}
        >
          <i>{item === "Capture" ? "+" : "·"}</i>
          {item}
        </span>
      ))}
    </nav>
  );
}

function SurfaceHeading({ detail, title }: { detail?: string; title: string }) {
  return (
    <header className={styles.surfaceHeading}>
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
    </header>
  );
}

function ShapedReserve({ surface }: { surface: Surface }) {
  return (
    <section className={styles.routeShell}>
      <ImmediateTag />
      <SurfaceHeading
        detail={surface === "today" ? "Thursday, July 23" : undefined}
        title={surface === "detail" ? "Person" : surfaceNames[surface]}
      />
      {surface === "today" ? (
        <div className={styles.todayGrid}>
          <SkeletonPanel rows={5} titleWidth="48%" />
          <div className={styles.rail}>
            <SkeletonPanel rows={3} titleWidth="34%" />
            <SkeletonPanel rows={2} titleWidth="42%" />
          </div>
        </div>
      ) : surface === "list" ? (
        <div className={styles.listReserve}>
          {[80, 68, 76, 62, 72].map((width) => (
            <SkeletonRow key={width} width={width} />
          ))}
        </div>
      ) : surface === "detail" ? (
        <>
          <div className={styles.detailIdentity}>
            <span className={styles.avatarReserve} />
            <div>
              <i style={{ width: "11rem" }} />
              <i style={{ width: "7rem" }} />
            </div>
          </div>
          <div className={styles.tabRule}>
            <span>Overview</span>
            <span>Memories</span>
            <span>Follow-ups</span>
          </div>
          <SkeletonPanel rows={4} titleWidth="40%" />
        </>
      ) : surface === "review" ? (
        <div className={styles.reviewReserve}>
          <div className={styles.tabRule}>
            <span>Memories</span>
            <span>Follow-ups</span>
            <span>Actions</span>
          </div>
          <SkeletonPanel rows={4} titleWidth="55%" />
        </div>
      ) : (
        <div className={styles.accountReserve}>
          <SkeletonRow width={44} />
          <SkeletonPanel rows={3} titleWidth="28%" />
          <SkeletonPanel rows={4} titleWidth="35%" />
        </div>
      )}
      <StreamTag text="Content-shaped space is reserved; each region resolves in place." />
    </section>
  );
}

function NamedRegions({ surface }: { surface: Surface }) {
  const regions: Record<Surface, Array<{ title: string; detail: string }>> = {
    today: [
      { title: "Today", detail: "Choosing a short, useful list…" },
      { title: "Eve", detail: "Ready for capture and recall." },
      { title: "Notes for today", detail: "Looking for briefs and calendar context…" },
    ],
    list: [{ title: "People", detail: "Opening the people you’re keeping in mind…" }],
    detail: [
      { title: "Person", detail: "Opening the relationship ledger…" },
      { title: "Recent context", detail: "Loading memories and notes independently…" },
    ],
    review: [
      { title: "Needs review", detail: "Gathering suggestions that still need your decision…" },
      { title: "Other review types", detail: "Counts arrive without delaying this view." },
    ],
    account: [
      { title: "Identity", detail: "Your admitted account is ready." },
      { title: "Connections", detail: "Checking each provider independently…" },
      { title: "Reminders", detail: "Checking this installation…" },
    ],
  };
  return (
    <section className={styles.namedShell}>
      <ImmediateTag />
      <SurfaceHeading title={surface === "detail" ? "Person" : surfaceNames[surface]} />
      <div className={styles.namedRegions}>
        {regions[surface].map((region, index) => (
          <section className={index === 0 ? styles.primaryRegion : undefined} key={region.title}>
            <div>
              <h2>{region.title}</h2>
              <p>{region.detail}</p>
            </div>
            <span className={styles.quietPulse} aria-hidden />
          </section>
        ))}
      </div>
      <StreamTag text="Useful landmarks and honest words replace skeleton geometry." />
    </section>
  );
}

function RetainedContext({ surface }: { surface: Surface }) {
  return (
    <section className={styles.retainedShell}>
      <div className={styles.retainedContent} aria-hidden>
        <SurfaceHeading detail="The screen you were just using" title="Today" />
        <div className={styles.fakeToday}>
          <article>
            <strong>Check in with Mara</strong>
            <span>Birthday next week</span>
          </article>
          <article>
            <strong>Reply to Sam</strong>
            <span>Saved from your last note</span>
          </article>
          <article>
            <strong>Bring the book for Alex</strong>
            <span>Tomorrow</span>
          </article>
        </div>
      </div>
      <div className={styles.openingPanel} role="status">
        <span className={styles.quietPulse} />
        <div>
          <strong>Opening {surfaceNames[surface]}</strong>
          <span>Your previous place is held until it’s ready.</span>
        </div>
      </div>
      <StreamTag text="Previous content remains visible but inert; destination space is not reserved." />
    </section>
  );
}

function CompleteSurface({ surface }: { surface: Surface }) {
  return (
    <section className={styles.completeSurface}>
      <SurfaceHeading
        detail={
          surface === "today"
            ? "Thursday, July 23"
            : surface === "list"
              ? "5 people you’re keeping in mind."
              : undefined
        }
        title={surface === "detail" ? "Mara Neely" : surfaceNames[surface]}
      />
      {surface === "today" ? (
        <div className={styles.todayGrid}>
          <section className={styles.evePanel}>
            <p>Ask Eve anything…</p>
            <span>No external sends without approval.</span>
          </section>
          <div className={styles.resolvedList}>
            <h2>Today</h2>
            <article>
              <strong>Check in with Mara</strong>
              <span>Birthday next week</span>
            </article>
            <article>
              <strong>Bring the book for Alex</strong>
              <span>Tomorrow</span>
            </article>
          </div>
        </div>
      ) : surface === "list" ? (
        <div className={styles.peopleList}>
          {["Mara Neely", "Alex Kim", "Sam Rivera", "Jordan Lee", "Priya Shah"].map(
            (name, index) => (
              <article key={name}>
                <span>{name.slice(0, 1)}</span>
                <div>
                  <strong>{name}</strong>
                  <small>{index % 2 ? "Friend" : "Family"}</small>
                </div>
              </article>
            ),
          )}
        </div>
      ) : surface === "detail" ? (
        <>
          <div className={styles.detailIdentity}>
            <span className={styles.personAvatar}>M</span>
            <div>
              <strong>Mara Neely</strong>
              <small>Family · Chicago</small>
            </div>
          </div>
          <div className={styles.tabRule}>
            <span>Overview</span>
            <span>Memories 8</span>
            <span>Follow-ups 2</span>
          </div>
          <div className={styles.ledger}>
            <h2>Recent context</h2>
            <p>Planning a quiet birthday dinner next week.</p>
            <p>Recommended the new neighborhood bookstore.</p>
          </div>
        </>
      ) : surface === "review" ? (
        <div className={styles.reviewList}>
          <article>
            <small>Ready to review</small>
            <strong>Mara prefers a quiet birthday dinner.</strong>
            <p>From your note on July 18.</p>
            <div>
              <button type="button">Save</button>
              <button type="button">Dismiss</button>
            </div>
          </article>
          <article>
            <small>Ready to review</small>
            <strong>Follow up with Sam about the proposal.</strong>
            <p>Suggested from your recent conversation.</p>
            <div>
              <button type="button">Save</button>
              <button type="button">Dismiss</button>
            </div>
          </article>
        </div>
      ) : (
        <div className={styles.accountList}>
          <section>
            <h2>Identity</h2>
            <p>
              <strong>Nick Neely</strong>
              <span>Private Beta Access · Active</span>
            </p>
          </section>
          <section>
            <h2>Connections</h2>
            <p>
              <strong>Google Calendar</strong>
              <span>Connected</span>
            </p>
            <p>
              <strong>Discord</strong>
              <span>Connected</span>
            </p>
          </section>
          <section>
            <h2>Reminders</h2>
            <p>
              <strong>This installation</strong>
              <span>Allowed</span>
            </p>
          </section>
        </div>
      )}
    </section>
  );
}

function FailureSurface({ surface, variant }: { surface: Surface; variant: Variant }) {
  return (
    <section className={styles.failureSurface}>
      <SurfaceHeading title={surface === "detail" ? "Person" : surfaceNames[surface]} />
      <div className={styles.failureMessage}>
        <strong>{surfaceNames[surface]} couldn’t finish loading.</strong>
        <p>
          {variant === "C"
            ? "The previous screen is no longer shown. Your records are unchanged."
            : "The rest of Tendnote is still available. Your records are unchanged."}
        </p>
        <button type="button">Try again</button>
      </div>
      <p className={styles.failureNote}>
        Stable navigation, the destination heading, and entered text remain available.
      </p>
    </section>
  );
}

function SkeletonPanel({ rows, titleWidth }: { rows: number; titleWidth: string }) {
  return (
    <div className={styles.skeletonPanel}>
      <i style={{ width: titleWidth }} />
      {rows >= 1 ? <i style={{ width: "88%" }} /> : null}
      {rows >= 2 ? <i style={{ width: "76%" }} /> : null}
      {rows >= 3 ? <i style={{ width: "64%" }} /> : null}
      {rows >= 4 ? <i style={{ width: "88%" }} /> : null}
      {rows >= 5 ? <i style={{ width: "76%" }} /> : null}
    </div>
  );
}

function SkeletonRow({ width }: { width: number }) {
  return (
    <div className={styles.skeletonRow}>
      <span />
      <div>
        <i style={{ width: `${width}%` }} />
        <i style={{ width: `${Math.max(30, width - 24)}%` }} />
      </div>
    </div>
  );
}

function ImmediateTag() {
  return (
    <span className={styles.immediateTag}>
      <i />
      Available immediately
    </span>
  );
}

function StreamTag({ text }: { text: string }) {
  return (
    <p className={styles.streamTag}>
      <i />
      {text}
    </p>
  );
}
