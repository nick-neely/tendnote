# The App Shell Mounts Exactly One Sidebar Provider

The desktop top bar had run out of room. Today, Assistant, Household, People,
Actions, Assets, Saved Items and Account sat in one row beside search and
appearance, with Gift plans already pushed out of it, and every destination
added from here would have made that worse. #552 moves navigation into a
site-wide rail built on the shadcn Sidebar — the same primitive the Assistant's
conversation rail already uses (ADR-0238) — collapsible to icons, with the
header reduced to a fold control and the two tools.

That puts two rails in one product, and the primitive is kept verbatim. A
`SidebarProvider` owns two things that are global rather than local: the
`Cmd/Ctrl+B` window keydown listener, and the `sidebar_state` cookie it writes
on every fold. Mounting a second provider does not scope either of them. One
keystroke folds both rails, and both write the cookie on that same event, so the
inner rail's fold is decided by whichever handler ran last — the fold you
performed is not the fold that is remembered.

## Decision

**Exactly one `SidebarProvider` is mounted at a time. On `/assistant` the shell
gives up its provider, not its navigation: the same rail is there, fixed to
icons.**

The shell mounts the foldable navigation rail on every route except `/assistant`
and `/assistant/[sessionId]`, where the conversation rail's own provider is the
only one. So `Cmd+B` folds exactly one rail everywhere in the product, the cookie
has exactly one writer, and nothing has to reason about which of two nested
contexts a `useSidebar` call resolves to.

What the canvas routes get instead is a plain column at the sidebar's own icon
width (`canvas-navigation-rail`, `--tn-canvas-rail`): no provider, no context, no
keystroke, no cookie. It reads the same groups from the same table, marks the
same row with the same sage, carries the same labels as tooltips, and keeps the
wordmark at its head. A member on the Assistant is one click from every
destination, exactly as they were from the top bar this replaced.

Neither rail may draw the item list itself. `app-navigation` owns the one answer
to "which destinations, and which is current", including the Household gate and
the boundary the membership read streams behind; the two rails differ in chrome
below that and in nothing else.

The primitive cannot be reused for the icon rail: `SidebarMenuButton` calls
`useSidebar` for the tooltip it shows only while collapsed, so it throws outside
a provider, and the collapsed geometry it would take comes from a
`group-data-[collapsible=icon]` ancestor that is not there either. The rows are
therefore drawn to match a folded button rather than being one.

The conversation rail is `position: fixed` against the window, so nothing in the
flow moves it aside for the icon rail; it is told where that rail ends, in the
same variant its own `data-[side=left]:left-0` is written in, or it slides
underneath. One token holds the width both of them read, and a browser test
pins the result at the narrowest desktop.

**Which shell a route gets is where its file lives, not what the URL says.** The
Assistant moved into a `(canvas)` route group whose layout passes `canvas` to
the shell; everything else stays under `(admitted)`. Both layouts share one
`AdmittedFrame` for the admission gate, so the gate is not duplicated. Reading
`usePathname` in the shell instead would have been shorter and wrong: it is a
dynamic hook, so under `cacheComponents` the frame above `children` could not
prerender, and every admitted route would lose the static shell that the
admitted layout and partial prefetching exist to produce. The build says so
outright — `CLIENT_HOOK_DYNAMIC` on the first prerendered route.

**Icons rather than nothing, because navigation is not chrome.** `/assistant` is
already the one destination that opts out of the shell's 1280px measure
(`data-full-bleed` in `globals.css`, DESIGN.md §5), because a transcript inside a
reading measure reads as a strip between two empty margins — so the temptation is
to let it take the whole window and drop the shell's rail with the rest of the
frame. That was tried and is wrong. It costs 3rem of a canvas that has 1232 to
spend at the narrowest desktop, and what it buys back is the product's entire
navigation: with the rail gone, every destination is reached from the Assistant
through the wordmark and a second click, or through a command palette a member
has to know exists. A destination is not a place navigation stops being true.
The provider is what has to be given up here, and the provider is only the fold.

**"One provider" means one live provider, not one in the document.** The router
parks the route you navigate away from in a hidden `<Activity>` rather than
unmounting it, so both shells really are in the DOM for a moment after crossing
the boundary. React destroys effects in a hidden Activity subtree, so the parked
shell holds no keydown listener and writes no cookie; that is what makes the
rule true at runtime, and it is pinned by a test rather than assumed.

**One fold preference, not two.** Both foldable rails read and write
`sidebar_state`, which is now a single "I keep the left rail folded" habit rather
than two independent memories. They are never foldable at the same time, so there
is no state a reader can see disagree with itself.

**The fold is corrected on the client, not read in the layout.** shadcn's recipe
reads the cookie in the layout and passes `defaultOpen`. The admitted layout
cannot: it prerenders an owner-neutral frame for partial prefetching, and under
`cacheComponents` a `cookies()` read there would make that whole frame dynamic
for one boolean. The frame therefore renders open and folds on mount from
`document.cookie`. The admitted frame is `display: none` until the admission
marker streams, so the correction lands behind that gate rather than in front of
the reader; the honest residue is that a slow hydration on a cold load can show
one expanded frame before the fold.

**Destinations still come from one table.** `app-destinations` gains
`sidebar-primary` and `sidebar-secondary` in place of `desktop-primary`: the
standing rows, and the quiet shelf at the foot of the rail holding Gift plans and
Account. The rail, the phone Menu, and the command palette all read groups from
that table, so they cannot drift into offering different sets, and the
Household row stays gated on live membership behind the same reserve the top bar
used. The reserve offers every unconditional destination and marks none current;
a member who holds a household gains that row when the read lands, which is the
honest direction for a reserve to be wrong in.

**Below `lg` nothing changes.** The phone keeps its bottom bar and its Menu
dialog. The rail's subtree is `display: none` there rather than conditional in
JavaScript, so the primitive's mobile sheet — which would be a second Menu with
the same links in it — is never mounted and never reachable.

## Consequences

- Adding a destination is a row in `app-destinations` with a group, and it
  appears in the rail, the Menu, and the palette at once.
- `/assistant` now sits under a different layout, so crossing that boundary
  remounts the shell subtree. Destination state is not preserved across that one
  boundary in the router's back/forward cache; every other navigation is
  unaffected.
- A second canvas destination joins `(canvas)`; a destination that wants the rail
  stays in `(admitted)`. Nothing else has to change for either.
- `SidebarInset` is deliberately unused: it renders a `<main>`, and the phone
  shell already renders the single `<main>` every destination paints into, which
  the `main:has(> [data-full-bleed])` rules in `globals.css` depend on.
- A canvas route's own rail has one more edge to respect than a foldable rail
  does. `--tn-canvas-rail` is where that arithmetic lives, and a rail added to a
  future canvas route reads it rather than repeating 3rem.
