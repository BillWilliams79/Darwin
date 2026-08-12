# Darwin E2E Test Plan

## Framework & Tooling

| Component | Choice | Rationale |
|-----------|--------|-----------|
| E2E Framework | **Playwright** | Free parallelism, superior DnD support, official MCP server, async/await model |
| Auth Testing | Cognito `InitiateAuth` API | Programmatic login (1-3s) vs hosted UI automation (60s+) |
| CI/CD | GitHub Actions | Start CRA dev server, run tests, upload HTML report as artifact |
| Test Reports | Playwright HTML report + traces | Uploaded as GitHub Actions artifacts |
| MCP Server | `@playwright/mcp` (Microsoft official) | Claude can browse app, inspect accessibility tree, help write tests |

## Architecture

### Directory Structure

```
Darwin/
├── e2e/
│   ├── tests/
│   │   ├── auth.setup.ts          # Cognito InitiateAuth + cookie injection setup
│   │   ├── auth.spec.ts           # AUTH-01, AUTH-02 (P0)
│   │   ├── auth-p1.spec.ts        # AUTH-03, AUTH-04 (P1)
│   │   ├── domain.spec.ts         # DOM-01, DOM-02 (P0)
│   │   ├── domain-p1.spec.ts      # DOM-03, DOM-04 (P1)
│   │   ├── area.spec.ts           # AREA-01, AREA-02, AREA-03 (P0)
│   │   ├── area-p1.spec.ts        # AREA-04, AREA-05, AREA-06 (P1)
│   │   ├── task.spec.ts           # TASK-01 through TASK-05 (P0)
│   │   ├── task-p1.spec.ts        # TASK-06, TASK-07, TASK-08 (P1)
│   │   ├── calendar.spec.ts       # CAL-01, CAL-02 (P1)
│   │   ├── navigation.spec.ts     # NAV-01 (P0)
│   │   └── error.spec.ts          # ERR-01 (P1)
│   ├── helpers/
│   │   ├── react-dnd-drag.ts      # Synthetic DragEvent helper for react-dnd
│   │   ├── auth.ts                # Cognito InitiateAuth token acquisition
│   │   └── api.ts                 # REST API helper (getIdToken, apiCall, apiDelete, uniqueName)
│   ├── .auth/                      # Saved auth state (user.json)
│   ├── playwright.config.ts
│   └── TEST_PLAN.md               # This file
├── src/                            # Application source
└── package.json
```

### Authentication Strategy

1. **Cognito app client** (`4qv8m44mllqllljbenbeou4uis`) — enable `ALLOW_USER_PASSWORD_AUTH` (one-time console change, coexists with implicit grant)
2. **Dedicated test user** — create via real signup flow to trigger post-confirmation Lambda provisioning
3. **Playwright setup project** — calls `InitiateAuth` API, gets tokens, injects cookies (`idToken`, `accessToken`, `profile`), saves `storageState`
4. **All tests** consume saved `storageState` — no login overhead per test
5. **One dedicated test** (AUTH-01) validates the full hosted UI login flow

### DnD Testing Strategy

| Library | Views | Testing Approach |
|---------|-------|-----------------|
| react-dnd (HTML5Backend) | TaskPlanView, CalendarView | Synthetic `DragEvent` dispatch via `page.evaluate()` with shared `DataTransfer` object |
| @hello-pangea/dnd | AreaEdit | Keyboard: Space (lift) → Arrow keys (move) → Space (drop) |

**react-dnd helper** (`helpers/react-dnd-drag.ts`):
- Creates `DataTransfer` object
- Fires: `dragstart` → `dragenter` → `dragover` (×3) → `drop` → `dragend`
- Must use same `DataTransfer` instance across all events
- Multiple `dragover` events required (react-dnd checks for continued hovering)

**@hello-pangea/dnd keyboard testing**:
- Focus the draggable element
- `Space` to lift → announcement "You have lifted an item"
- `ArrowUp`/`ArrowDown` to move → announcement "You have moved the item"
- `Space` to drop → announcement "You have dropped the item"
- Deterministic, no pixel coordinates, tests accessibility compliance

### Test Data Strategy

- **Dedicated test user** on production DB — `creator_fk` scoping provides natural isolation
- **Timestamped names** for identification: `e2e-{timestamp}-TestDomain`
- **Hybrid cleanup**: `afterAll` deletes test data via Darwin API + `beforeAll` safety cleanup
- **No separate test database** — Darwin's user-scoped data model is sufficient

### Prerequisites

- [ ] Enable `ALLOW_USER_PASSWORD_AUTH` on Cognito app client
- [ ] Create dedicated test user via real signup flow
- [ ] Store test credentials in `.env.test.local` (gitignored) and GitHub Actions secrets
- [ ] Add `data-testid` attributes to key components (draggables, droppables, buttons, form fields)
- [ ] Install `@playwright/test` and configure `playwright.config.ts`

---

## Test Cases

### P0 — Critical (13 tests)

#### AUTH-01: Full login flow via Cognito hosted UI
- **Preconditions**: Test user exists in Cognito, user is logged out
- **Steps**: Navigate to `/` → click Login → fill credentials on Cognito hosted UI → submit
- **Expected**: Redirected to `/loggedin` → JWT validated → cookies set → redirected to app
- **Notes**: This is the only test that exercises the hosted UI; all others use API auth

#### AUTH-02: Auth guard redirects unauthenticated users
- **Preconditions**: No auth cookies set
- **Steps**: Navigate directly to `/taskcards`
- **Expected**: Redirected to `/login`

#### DOM-01: Create domain via dialog
- **Preconditions**: Authenticated, on TaskPlanView
- **Steps**: Click "+" tab → type domain name in dialog → press Enter
- **Expected**: Dialog closes, new domain tab appears, API POST returns 200/201

#### DOM-02: Close domain tab
- **Preconditions**: Authenticated, test domain exists
- **Steps**: Click close icon on domain tab → confirm in DomainCloseDialog
- **Expected**: Domain tab removed, PUT `{closed: 1}` sent

#### AREA-01: Create area via template pattern
- **Preconditions**: Authenticated, domain with area card visible
- **Steps**: Click blank area template field → type area name → press Enter
- **Expected**: Area created via POST, new blank template appears below

#### AREA-02: Close area card
- **Preconditions**: Authenticated, area card exists
- **Steps**: Click close icon on card → confirm in CardCloseDialog
- **Expected**: Card removed, PUT `{closed: 1, sort_order: 'NULL'}` sent

#### AREA-03: DnD reorder areas in AreaEdit
- **Preconditions**: Authenticated, on AreaEdit, domain with 2+ areas
- **Steps**: Focus second area row → Space (lift) → ArrowUp (move) → Space (drop)
- **Expected**: Areas reordered, sort_order updated via PUT, persists on reload

#### TASK-01: Create task via template pattern
- **Preconditions**: Authenticated, area card visible
- **Steps**: Click blank task template → type description → press Enter
- **Expected**: Task created via POST, new blank template appears, list re-sorted

#### TASK-02: Toggle task done
- **Preconditions**: Authenticated, task exists
- **Steps**: Click done checkbox on task
- **Expected**: Task marked done, `done_ts` set, task removed from active list

#### TASK-03: Toggle task priority
- **Preconditions**: Authenticated, task exists
- **Steps**: Click flag/priority icon on task
- **Expected**: Priority toggled (0↔1), task list re-sorted (flagged first)

#### TASK-04: Delete task with confirmation
- **Preconditions**: Authenticated, task exists
- **Steps**: Click delete icon → confirm in TaskDeleteDialog
- **Expected**: Task removed, DELETE sent to API

#### TASK-05: DnD task between areas (react-dnd)
- **Preconditions**: Authenticated, on TaskPlanView, 2+ areas with tasks
- **Steps**: Drag task from Area A to Area B (via synthetic DragEvent)
- **Expected**: Task moves to Area B, `area_fk` updated via PUT, persists on reload

#### NAV-01: Navigate between all views
- **Preconditions**: Authenticated
- **Steps**: Navigate Plan → Calendar → AreaEdit → DomainEdit → Profile via NavBar
- **Expected**: Each view loads without error, correct content displayed

### P1 — Important (13 tests)

#### AUTH-03: Logout clears session
- **Preconditions**: Authenticated
- **Steps**: Click Logout
- **Expected**: Cookies cleared, redirected to home page, auth guard blocks protected routes

#### AUTH-04: Expired token handled
- **Preconditions**: Set expired idToken cookie
- **Steps**: Navigate to `/taskcards`
- **Expected**: Redirected to login (AuthenticatedRoute check fails)

#### DOM-03: Update domain name
- **Preconditions**: Authenticated, on DomainEdit, domain exists
- **Steps**: Edit domain name field → blur
- **Expected**: Name updated via PUT, persists on reload

#### DOM-04: Hard delete domain
- **Preconditions**: Authenticated, on DomainEdit, test domain exists
- **Steps**: Click delete icon → confirm in DomainDeleteDialog
- **Expected**: Domain permanently deleted via DELETE

#### AREA-04: Update area name
- **Preconditions**: Authenticated, area card visible
- **Steps**: Edit area name field → blur
- **Expected**: Name updated via PUT, persists on reload

#### AREA-05: Hard delete area
- **Preconditions**: Authenticated, on AreaEdit or DomainEdit
- **Steps**: Click delete icon → confirm
- **Expected**: Area permanently deleted via DELETE

#### AREA-06: DnD area cross-domain (react-dnd)
- **Preconditions**: Authenticated, on TaskPlanView, 2+ domains with areas
- **Steps**: Drag area card to different domain tab (hover to switch tab, then drop)
- **Expected**: Area adopted by new domain, `domain_fk` updated, persists on reload

#### TASK-06: Update task description
- **Preconditions**: Authenticated, task exists
- **Steps**: Edit task description → blur
- **Expected**: Description updated via PUT, persists on reload

#### TASK-07: Task edit dialog
- **Preconditions**: Authenticated, task exists
- **Steps**: Open TaskEditDialog → modify fields (description, priority, etc.) → save
- **Expected**: All field changes persisted via PUT

#### TASK-08: Template row disabled until parent saved
- **Preconditions**: Authenticated, area with blank template
- **Steps**: Attempt to interact with task template in unsaved area
- **Expected**: Template fields disabled (`id === ''` check)

#### CAL-01: Done tasks appear in CalendarView
- **Preconditions**: Authenticated, tasks marked done with `done_ts`
- **Steps**: Navigate to CalendarView
- **Expected**: Done tasks displayed on their completion dates

#### CAL-02: Day view shows completed tasks
- **Preconditions**: Authenticated, done tasks exist
- **Steps**: Click a date in CalendarView
- **Expected**: DayView opens showing tasks completed that day

#### ERR-01: API error shows snackbar
- **Preconditions**: Authenticated
- **Steps**: Trigger an API error (e.g., intercept with Playwright route to return 500)
- **Expected**: SnackBar appears with error message, auto-hides after 2 seconds

### P2 — Nice to Have (8 tests)

#### AUTH-05: New user signup and provisioning
- **Preconditions**: Fresh email not in Cognito
- **Steps**: Full signup flow via Cognito hosted UI → email verification → first login
- **Expected**: Post-confirmation Lambda provisions profile, "Personal" domain, "Home" area, instructional task

#### DOM-05: Domain sort order
- **Preconditions**: Authenticated, multiple domains (some closed)
- **Steps**: View domain list
- **Expected**: Sorted: closed asc, blanks last

#### AREA-07: Area sort order
- **Preconditions**: Authenticated, multiple areas with varying sort_order
- **Steps**: View area list
- **Expected**: Sorted: closed asc, sort_order asc, blanks last

#### TASK-09: Task sort order
- **Preconditions**: Authenticated, tasks with varying priority
- **Steps**: View task list
- **Expected**: Sorted: priority desc (flagged first), blanks last

#### TASK-10: Tab switch on drag hover
- **Preconditions**: Authenticated, on TaskPlanView, 2+ domains
- **Steps**: Start dragging task → hover over different domain tab for 500ms+
- **Expected**: Tab switches to hovered domain (DroppableTab 500ms timer)

#### DND-01: Cancel drag returns item
- **Preconditions**: Authenticated, draggable item available
- **Steps**: Start drag → press Escape
- **Expected**: Item returns to original position, no API calls made

#### PROF-01: Profile drawer
- **Preconditions**: Authenticated
- **Steps**: Open profile drawer from NavBar
- **Expected**: User profile information displayed correctly

#### RESP-01: Responsive viewport
- **Preconditions**: Authenticated
- **Steps**: Set viewport to mobile size (375×667), navigate key views
- **Expected**: Views render without horizontal overflow, key controls accessible

---

## CI/CD Workflow (GitHub Actions)

```yaml
name: E2E Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    timeout-minutes: 15
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: lts/*
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps
      - name: Run E2E tests
        run: npx playwright test
        env:
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
          COGNITO_CLIENT_ID: ${{ secrets.COGNITO_CLIENT_ID }}
      - name: Upload test report
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## Component Instrumentation Needed

These components need `data-testid` attributes added for reliable E2E selectors:

| Component | File | Test IDs Needed |
|-----------|------|----------------|
| TaskEdit | `src/Components/TaskEdit/TaskEdit.js` | `task-{id}`, `task-template` |
| TaskCard | `src/TaskPlanView/TaskCard.js` | `area-card-{id}` |
| DroppableTab | `src/TaskPlanView/DroppableTab.js` | `domain-tab-{id}` |
| AreaTableRow | `src/AreaEdit/AreaTableRow.js` | `area-row-{index}` |
| DomainAddDialog | `src/Components/DomainAdd/DomainAddDialog.js` | `domain-add-dialog` |
| TaskDeleteDialog | `src/Components/TaskDeleteDialog/TaskDeleteDialog.js` | `task-delete-dialog` |
| CardCloseDialog | `src/Components/CardClose/CardCloseDialog.js` | `card-close-dialog` |
| DomainCloseDialog | `src/Components/DomainClose/DomainCloseDialog.js` | `domain-close-dialog` |
| SnackBar | `src/Components/SnackBar/SnackBar.js` | `snackbar` |

## Future Considerations

- **CRA → Vite migration**: E2E tests provide safety net. Only `webServer.command` changes in config.
- **Auth code + PKCE overhaul**: Update auth setup helper to use new flow. Most tests unaffected.
- **Vitest**: After Vite migration, replace Jest with Vitest for unit tests (same config).

---

## Swarm Orchestration — pipelines acceptance battery (req #3118)

The regression gate for the Swarm Orchestration epic: the engine (req #3112), the
list/table UI (#3114), the Plan visualizer (#3115) and the MCP tools (#3113),
measured against the design rules in req #3080.

**Spec files**

| File | Tests | What it covers |
|------|-------|----------------|
| `pipelines.spec.ts` | PIPE-01…13 (14) | The browser surface, over a seeded plan |
| `pipeline-mutations.spec.ts` | MUT-01…12 (12) | The twelve canonical mutation classes, via the MCP tools |

**Fixture strategy — why it is not the req #3111 fixture**

`darwin_dev` already holds the Substrate Rebuild plan (pipeline 9001) from req
#3111, but it is owned by the user's Cognito sub and every Darwin read is
creator-scoped server-side (req #3050), so the E2E user cannot see a row of it.
`helpers/pipelineFixture.ts` therefore re-seeds the SAME plan — from the static
module req #3112 froze, `src/SwarmView/pipelines/__tests__/substrateRebuildFixture.js`
— under the test user's own identity, through Lambda-Rest. Two properties are
preserved deliberately: steps are inserted SEQUENTIALLY so id order matches the
canonical stored order the display-order tie-break depends on, and step titles are
verbatim so the no-'#' audit is measured against real plan prose.

Three plans are seeded: the 34-step Substrate plan, a four-step co-launchable plan
(four steps sharing one launch key — the shape that used to draw a launch group),
and a two-step plan with a deliberate dependency cycle. A stale-fixture sweep runs
before every seed, because `cleanupStaleData` knows nothing about pipelines and its
requirement deletes actually FAIL against a leaked plan (`requirement_fk` is
ON DELETE RESTRICT).

**The mutation replay's second daemon**

The MCP daemon on port 8765 talks to production `darwin`, where `pipelines` must
stay EMPTY until the Primary's live-plan cutover. `scripts/mcp/darwin-dev-mcp.sh`
starts a second daemon pinned to `darwin_dev` on port 8766 with its own pid/log
files; `helpers/darwinDevMcp.ts` points `MCP_URL` at it and drives the ordinary
`darwin-read.sh` / `darwin-tool.sh` wrappers, so the always-via-wrapper policy
(req #2365) is unchanged — only the transport endpoint moves. That daemon
authenticates as the USER's Darwin account, so the replay's rows are invisible to
the browser half; the two share a database and nothing else.

### PIPE — the browser surface

| ID | Test | Expected |
|----|------|----------|
| PIPE-01 | Cards\|Table switch on `/swarm/pipelines` | Both views render, the choice persists via `useViewPreference`, a row click opens the plan |
| PIPE-02 | Rendered step order vs `displayOrder` | The full 34-row sequence matches element for element, and the engine's own `violations` are empty first |
| PIPE-03 | State chips, epic/feature groups, machine column | Every chip reads the DERIVED state; labels render once per contiguous group (compared by id, not title); machine cells match `rowMachineLabel`, em-dash on the req-less step |
| PIPE-04 | The step row's `/swarm-start` (req #3371) | Each SCHEDULED step row carries the exact `/swarm-start <ids>` command for its OWN launch argument list, every fixture requirement appears among the commands drawn, the wall-clock gate renders through the shared formatter, and — since req #3303 — the ABSENCE of any condensation advisory, asserted here because this is the plan shape that used to raise one. Was a full-width `LAUNCH BATCH A` banner until req #3371 made the step the launch unit |
| PIPE-04b | No launch line off the scheduled band | No launch command and no blocked-reason line on any Complete or Running row — the launch line is scoped to SCHEDULED work. Was "no banner and no legend key" until req #3371 removed both |
| PIPE-05 | Time / Tokens toggle | Cost hidden by default; one cell per row when revealed; a dash or a real figure; no cost-error notice |
| PIPE-06 | Requirement link | Renders the bare id and navigates to `/swarm/requirement/:id` |
| PIPE-07 | NO-'#' audit | Zero `#<digits>` in generated labels on both views. Stored plan prose is excluded — and the exclusion is evidenced, since the fixture's step 22 really contains "#3077 R13" |
| PIPE-08 | Visualizer drag | The canvas mounts, a drag changes the world transform (pixel diff on a plan with no pulsing bead), and neither the container nor the document scrolls horizontally |
| PIPE-09 | Zoom | The level chip crosses Overview → Plan → Detail and the canvas redraws at each |
| ~~PIPE-10~~ | ~~Launch rectangle + conditional key~~ | **DELETED by req #3371.** It asserted one dashed launch-unit rectangle and a visible legend key on the co-launchable plan and neither on the Substrate plan. The rectangle, its `data-batch-boxes` count attribute and the key are all gone: the step is the launch unit and the bead stands for it, so there is no construct left to draw conditionally |
| PIPE-11 | Click targets | Bead → Table mode focused on that row; requirement label → `/swarm/requirement/:id`; epic band's ↗ → `/swarm/steps?epic=<id>` (re-pointed off the retired Features route by req #3373 — see req #3375 below) |
| PIPE-12 | Loud failure | The corrupted plan raises the non-dismissible invariant banner naming the cycle, on BOTH views |
| PIPE-13 | Description in the title bar (req #3179) | The goal field is ABSENT from the page column; the info button is inside the header row, right of the title and every chip; it opens a Dialog carrying the seeded text and closing unmounts it; and the canvas starts within 16px of the header row and runs to the bottom of the viewport |

### MUT — the eight recorded mutation classes

Each case asserts the tool's ECHO, the DERIVED state, and a violation-free
order re-read from `darwin://pipeline/{id}` — after every mutation, not once at
the end. The order check reads the composed payload's own server-side `derived`
block; there is no client-side model for this spec to build.

| ID | Recorded case | Expected |
|----|---------------|----------|
| MUT-01 | Step inserted mid-pipeline (#3078) | The new step lands with its gate and links; the displaced step re-gates onto it; topological order follows |
| MUT-02 | Requirement wontfixed, scope folded (#3041 → #3072/#3077) | wontfix is terminal so the step derives Complete; the fold note lands in the RECEIVING requirement; the step then leaves the plan with no link, dep or dangling reference behind |
| MUT-03 | Coordination flipped with an autonomy grant (#3075) | The flip and the note echo back; coordination is NOT a state input, so the derived state and the order are untouched |
| MUT-04 | Step re-scoped after filing (B5 split) | Title and notes update; `notes` REPLACES on the second write; an unset field is left alone |
| MUT-05 | Gate passed WITH EXCEPTIONS (s1.4) | The disposition is stored in the step notes and `completed_at` is stamped — valid only because the step links no requirements, and a later link attempt is refused |
| MUT-06 | Dual-condition gate (s0.4) | ONE dep row plus the step's own `not_before` column — the time gate is no longer a dep row; eligibility stays false with either half unsatisfied and flips true only when BOTH hold |
| MUT-07 | Two requirements, one step (s0.5) | Running while any is `development`; Scheduled in the honest middle; Complete only when all are terminal (`deferred` counts) |
| MUT-08 | Step dropped without residue (#3065/#3074) | The drop is REFUSED while another step gates on it and the message names that step, with nothing deleted on the way; after the reference clears, the hard delete leaves no step, link or dep row |
| MUT-09 | Step re-parented across epics | Legal within a plan — the step keeps its notes, completion stamp and dependency edges; REFUSED across plans, naming every crossing edge in both directions |
| MUT-10 | Epic created and deleted | The delete is REFUSED while a step OUTSIDE the epic gates on a step inside it, with nothing deleted on the way; after the gate clears it leaves no epic, step or dep row |
| MUT-11 | Epics re-ordered | `sort_order` echoes back, and both the derived epic order and the step display order the tree walk derives from it follow |
| MUT-12 | Step widened while ALREADY eligible | The launch set grows with no false→true eligibility edge — the case commanded-requirement tracking exists to catch |

---

## Pipeline 2.0 — the plan visualizer's test plan (req #3375)

Separate from the implementation requirements it tests (#3371–#3374) on the
requirement's own instruction: this surface's vitest suite is 7,083+ lines in
one file plus a 400-plan fuzz corpus, and its history is a record of
assertions that had no coverage (req #3207's 16 plan-scale tests running on an
empty plan; req #3229's launch-unit invariant passing on one hand-built
fixture while violated 7 times per 40,000 real layouts). This section answers,
for every invariant the four implementation requirements touched: **what
asserts it, over what data, and what would have to break for the assertion to
go quiet** — not just "there is a test".

Read alongside `memory/pipeline-2-visualizer-design.md` (the stage-2 design
record this plan was built against) and `memory/pipeline-plan-visualizer.md`
(the surface's own design-intent document, which most of the invariants below
trace back to).

### 1. The invariant table

| Invariant | Asserts | Over what data | Goes quiet if |
|---|---|---|---|
| No two beads share a `(band, column, lane)` cell | `pipelinePlanLayout.test.js` § *cell invariant over a timed fuzz corpus (req #3229)* — collects every collision as `"${band}|${depth}|${lane}: steps X and Y"`, not just a count | The 400-plan deterministic `timedFuzzCorpus()`, run **with and without a time axis** (two full passes) | A future edit shrinks the corpus below its own pinned preconditions (`toHaveLength(400)`, `rows>5000`, `bands>700`, `multiLaneBands>400`, `deepBands>250`) — those ARE the vacuity guard req #3207 was filed over, so this invariant cannot go quiet the way it did before without failing first |
| A launch-unit rect encloses exactly its members | **DELETED, with the code it guarded** — req #3371 removed the batch box; `batchRunNext`/`runOk`/`runIntervals`/`interiorClear`/`enclosingRunAnyColumn` are gone, and no construct exists for this invariant to be about | — | N/A — deleting the invariant's own subject is the correct disposition per the requirement's own instruction, not a weakening |
| `runIntervals`' and `interiorClear`'s hand-built repros (five-step, nine-step cases) | **DELETED**, same reason | — | N/A |
| Cross-epic dependency edges are legal, not flagged | `pipelinePlanLayout.test.js` § *cross-epic dependency edges stay legal — sameBand keeps routing, reports nothing (req #3372 item 3, gate-delta F1)* — asserts the arc routes as an ordinary `early` shape, `layout.violations` is `undefined`, and the arc object carries no extra field | A hand-built two-epic fixture with one cross-epic dep | Someone reintroduces a `sameBand`-as-assertion (reported in the design doc as gate-delta F1 superseding the requirement's own original item 3 instruction) — this is a POSITIVE/legal-case test, so a regression would have to actively re-add a rejection path, which is loud by construction |
| Four-combination zero-overlap label contract | `pipelinePlanLayout.test.js` § *zero label overlap — all four layout/label combinations* + the fuzz-corpus label check (`describe.each(COMBOS)`) | Every layout/label COMBO (horizontal/vertical req layout × id/title step label), both the Substrate fixture and the 400-plan corpus | The `batch` label `kind` is gone from `layout.labels` entirely (confirmed: grep for `kind === 'batch'` across the file returns zero hits) — the contract now covers `req`/`step`/`title`/`epic` only, narrowed by exactly the one kind req #3371 removed and not weakened for the rest |
| Halo ceiling (`NEXT_HALO_MAX_OUTER`=30, `NEXT_HALO_MAX_MAGNIFY`≈2.222×) | Pre-existing tests assert these are **derived, not typed** (`Object.keys(NEXT_HALO_CLEARANCES).length >= 4`, `NEXT_HALO_MAX_MAGNIFY > 1.8`) plus a fuzz-corpus furniture-clearance sweep | Substrate fixture + 400-plan corpus at worst-case magnification | The clearance list shrinks back toward a one-constraint answer (both prior wrong ceilings — 2.37× and 3.76× — are the regressions this guards) |
| Halo floor (`NEXT_MARK_FLOOR_K`≈0.27, req #3299's ring→dot crossover) | Pre-existing: asserted as **derived** (`toBeCloseTo` the formula, 10 digits) plus a range (0.26–0.28) | Direct formula evaluation | The formula's own inputs (`NEXT_MARK_MIN_STROKE_PX`, `NEXT_HALO_STROKE`, `NEXT_HALO_MAX_MAGNIFY`) drift apart while staying internally self-consistent — which is exactly why this plan adds the next row |
| **NEW (req #3375, "ONE ADDITION" from the #3331 code review)** — ceiling, floor, flat-band lower edge and screen radius pinned as **measured numbers**, not only self-consistent derivations | New test in `pipelinePlanLayout.test.js`: `NEXT_HALO_MAX_OUTER` ≈ 30, `NEXT_HALO_MAX_MAGNIFY` ≈ 20/9, `NEXT_MARK_FLOOR_K` ≈ 0.27, `K_READABLE / NEXT_HALO_MAX_MAGNIFY` (the flat-band lower edge) ≈ 0.36, `NEXT_MARK_SCREEN_RADIUS` ≈ 8.1 | Direct module evaluation, values confirmed by a throwaway probe before writing the assertions (`NEXT_HALO_MAX_MAGNIFY` = 2.2222222222222223, `NEXT_MARK_FLOOR_K` = 0.26999999999999996, flat-band = 0.36, `NEXT_MARK_SCREEN_RADIUS` = 8.1 — exact) | Any of the five constants moves in VALUE even while every existing derivation-based test stays green — which is the literal failure mode the design record's flat-band-lower-edge note (0.400→0.360) had NO test at all before this |
| Epic band order from `epics.sort_order` (req #3430), falling back to derived-start tiers | `pipelinePlanLayout.test.js` § *epic bands stack by `epics.sort_order` (req #3430)* — user order wins outright; unordered falls back BELOW every ordered epic; NULL is unordered not zeroth; ties fall through; "No epic" always last even among ordered epics; stringly-typed `sort_order` still sorts numerically | Hand-built multi-epic fixtures, one property varied per test | The override tier is deleted or the fallback chain (`bandTierOf`/`bandStartOf`) is deleted without deleting the override — either would surface immediately since both are exercised by name |
| "No epic" band is still reachable | `pipelinePlanLayout.test.js` § *a band is a plain column read (req #3372 item 1)* — a `null` `epicId` still bands on its own, in a fixture with a real epic present too | Hand-built two-row fixture (`epicId: 6`, `epicId: null`) | The branch is deleted on the (currently false) premise that `epic_fk` is NOT NULL upstream — the test's own comment names the exact live condition (req #3462's revert) that keeps this reachable and points at the follow-on that will retire it correctly |
| A step's dominant `epic` stays singular even when it spans `epicLabels` | `pipelineModel.test.js` § *rule 10 is NOT filtered* | Substrate Rebuild fixture, step 19 (2 epic labels, 1 dominant `epic`) | The dominant-epic tally starts returning a set instead of one value — this is `pipelineModel.js`'s own boundary (§ 3 below), not this surface's, but the test lives here because it's what the RENDER bands on |
| Display order in the view is a tree walk (epic order, then dependency graph within) | The CANVAS achieves this structurally: bands sort by `epics.sort_order`/derived-start (above), and every arc-routing rule (chain inheritance, corridor-aware parking, adaptive routing — req #3157) is already band-local. Explicitly **not** the same claim as the TABLE's `displayOrder`, which stays state-first (design doc: *"THE BAND STACK IS WHAT DELIVERS THE USER-VISIBLE EPIC ORDER, and `displayOrder` is not"*) | Same fixtures as the band-order and arc-routing suites above | A future edit makes the table's row order try to mirror the canvas's band order — the two are DELIBERATELY different questions and conflating them is the regression to watch for |
| Batch-zoom vocabulary retired, step-zoom vocabulary live | `pipelineEpicZoom.test.js` (33 tests) — `EPIC_ZOOM_BATCH`/`nextBatchLetter`/`batchFocusTransform`/`BATCH_FOCUS_CONTEXT` have zero occurrences anywhere in the suite; `stepFocusTransform`/`STEP_FOCUS_CONTEXT`/`stepFitRect` are exercised throughout, including the explicit migration note at `pipelinePlanLayout.test.js`'s *step focus geometry* block | `epicZoomFixture.js`, built around `nextLaunchStep`/`EPIC_ZOOM_STEP` semantics | Any batch identifier reappears — grep is the whole check, and it is exact |

### 2. The ordering self-check (item 4 of the requirement) — SPECIFIED, NOT YET BUILDABLE, and said so rather than faked

The requirement asks for two things: a test that the **epic-scoped** state-banding check returns 0 violations on a tree-walked plan (matching design record § 5.4 measurement D), and a hand-built three-step single-epic case that MUST still report (matching § 5.3's Cause 2).

**Neither can be written honestly against the code as it ships today, and this is reported rather than worked around.** Direct inspection of `pipelineModel.js::verifyOrder` (2026-08-10) shows the `state-banding` invariant is still **GLOBAL** — it compares every row against every EARLIER row in the whole plan (`for (let j = 0; j < i; j++)`), with no epic parameter anywhere in the function signature or body. The Python twin, `pipeline_derive.py::verify_order`, is the same. This matches — and is independently confirmed by — `pipeline-2-visualizer-design.md` §4.2.1's own dated correction (2026-08-10, the same day this requirement was worked): req #3462's production-outage revert pulled the composed-read wiring back out before the epic-scoped derivation could land, the design record calls the resulting false-positive risk (15 violations under a tree walk with a global check, § 5.2 condition C) **LATENT on the live plan today**, and states in as many words that closing it is a follow-on **"without editing `pipelineModel.js` from a deployed session on an unreviewed scope decision"** — which is exactly what writing a passing test for epic-scoped `verifyOrder` here would have required, since no such code exists to test.

The three-step single-epic case (1 pending, 2 pending, 3 done depending on 2 → `verifyOrder` must still report step 3 sinking below the unrelated step 1) does not need epic scoping to demonstrate — it is a property of the GLOBAL check, which already exists — and it is already covered, in the identical shape, by `pipelineModel.test.js` § *verifyOrder — each invariant caught on a seeded bad input*, `'invariant 2: an inversion the order did NOT have to make is still caught'` (steps 19/38, unrelated running/done pair) and `'invariant 2: depending on ONE running row does not excuse sinking below another'`. Nothing new was needed there.

**Disposition, mechanically enforced by the coverage gate:** `pipeline2_behaviours.json`'s `VIS-005` (owned by this requirement) is registered `testability: untestable` with a note citing this exact finding and `pending: "3349"` — the sibling requirement whose landing settles it. The gate (`verification_matrix.py --assert-covered --req 3375`) treats an untestable-with-note behaviour as passing without a fabricated `COVERS:` marker; reverting to `auto` with a real marker is explicitly the follow-on's job, not this one's.

### 3. Fixtures — NOT reshaped onto `epic_fk`, and this is a correction to the requirement's own text

Item 2 of the requirement's body ("FIXTURES THAT CHANGE SHAPE") instructs re-shaping `substrateRebuildFixture.js`, `timedFuzzPlans.js`, `epicZoomFixture.js` and `pipelineFixture.ts` onto a NOT-NULL `epic_fk` column, on the premise that Feature-mediated epic derivation is gone.

**That premise is false for the code these fixtures actually feed, and the design record's own §4.2.1 correction (dated the same day, 2026-08-10) says so explicitly.** Confirmed directly against source: `pipelineModel.js::dominantLabels` still tallies `req.feature_fk → features.epic_fk` and picks the modal epic (`pipelineModel.js:364-388`); `PlanRow.featureId`/`.feature` are still populated (`pipelineModel.js:91-92, 388, 595`); and `pipelinePlanLayout.js` still carries — and tests — the null-epic-band branch with a dated comment naming this exact situation. The reason is req #3462: it reverted req #3381's browser cutover onto the 2.0 composed read (a production outage, no 1.0↔2.0 pipeline id mapping exists), so the only live consumer of this module, `PipelineDetail.jsx`, still derives `epicId` through the OLD Feature-mediated chain, which CAN legitimately return `null`.

Reshaping the four fixtures onto direct `epic_fk` would therefore make them test a data shape **nothing in production produces**, which is precisely the "assertion with no coverage" failure mode this whole requirement exists to close. **They were left alone, deliberately, and this is that decision recorded rather than made silently.** `pipelineFixture.ts`'s `batchPipelineId`/`batchRequirementIds` construct also survives untouched for an independent reason: `pipelineModel.js::launchBatches` still derives multi-step launch GROUPS for consumers outside this surface (per the design record's boundary table, "nothing on THIS surface draws one" since req #3371 — other consumers still do), so the fixture and its extensive `pipelineModel.test.js` coverage (the `launchBatches`/`swarmStartCommand`/`noLaunchReason` suite) remain load-bearing for code this requirement does not own.

`timedFuzzPlans.js`'s 400-plan corpus generates dependency edges by step-id proximity with no epic awareness, so cross-epic edges arise routinely and are exercised by construction — matching § 1's cross-epic-legal row above.

### 4. The shared conformance corpus's disposition (explicitly asked, answered)

**Not collapsed to one implementation.** `pipelineModel.js` (JS) and `darwin-mcp/services/pipeline_derive.py` (Python) both still exist, both still export `verify_order`/`verifyOrder`, and `darwin-mcp/tests/conformance/pipeline_conformance.json` is still run against both — `pipelineConformance.test.js` (60 tests, JS side) and its Python counterpart. The corpus remains the drift control it was built as, not an ordinary suite duplicated for nostalgia: the file's own header states the reason two implementations exist at all (the browser reaches Lambda-Rest directly; `darwin-mcp` is a localhost daemon the browser cannot reach) and that reason is unchanged by anything #3371–#3375 touched.

### 5. E2E — measured, with one closed defect class and a systemic, reported finding

**`tests/tests/pipelines.spec.ts` could not run at all before this requirement**, for a reason unrelated to Batch/Feature/epic-containment: `527d278` (the req #3462 production-outage revert, 2026-08-09) deleted `testOrderedPlan.js` and restored `orderedPlan` as a live export of `pipelineViewModel.js`, but never updated this spec's import, which still pointed at the deleted file. Fixed by importing `orderedPlan` directly again (§ *Provenance* in the spec file now records why).

With the suite loadable, two further defects surfaced and were fixed, each confirmed against the real code rather than papered over in the test — a third candidate fix was proposed, disproven by code review, and reverted rather than left in as a harmless-looking no-op:

1. **`row.swarmStartCommand`/`row.noLaunchReason` were never attached to a `PlanRow`.** `buildPlanRows` computed the per-row `launchReqIds`/`launchExcluded`/`launchBlock` trio (req #3360) but the two fields `PipelinePlanTable.jsx`'s `StepLaunchLine` actually reads — the command STRING and the human reason — existed only inside `launchBatches()`'s separate batch objects. Every step row's launch line rendered nothing, silently, on every plan. Fixed in `pipelineModel.js::buildPlanRows` by computing both with the identical helper `launchBatches` already uses (`noLaunchReasonFor`), against a shared `launchOnlyMember` object rather than a fresh inline literal — the first cut of this fix (code review caught it, verified live against pipeline 79: **15 of 63 rows** affected) built that literal without `launchExcluded`, so a partially-excluded row's reason rendered `"nothing launchable — only swarm_ready launches: "` with the exclusion list silently dropped even though the sibling batch computation carried it correctly. This is req #3371 item 4 / P8's own deliverable — "the step row carries the launch payload the batch banner carried" — which had shipped with no rendering at all.
2. **`pipelineFixture.ts`'s client-side `epics` array carried no `sort_order`**, while the real INSERT gives each epic `sort_order: i` (matching the `EPICS` array's own order). Production reads the real value and bands accordingly (req #3430); the test's local re-derivation of the SAME plan, used to compute expected click coordinates, treated every epic as unordered and fell back to derived-start tiers — landing "No epic" FIRST locally while production correctly drew it last. Fixed by mirroring the insert's `sort_order: i` into the client model.
3. **REVERTED — a claimed `started_at`/`completed_at` server-stamping fix, disproven.** The first pass at diagnosing PIPE-14 (below) proposed that Lambda-Rest stamps these columns on INSERT for a non-`authoring`/`approved` requirement, and added an `insertRow` helper to read them back. Code review checked the claim against `DarwinSQL/schema.sql` (both columns `TIMESTAMP NULL`, no `DEFAULT`), `Lambda-Rest/rest_post.py` (inserts exactly the body keys, no `started_at` reference anywhere in `Lambda-Rest/`), and confirmed no `CREATE TRIGGER` exists anywhere in `DarwinSQL/` — the actual status→timestamp stamping lives in `darwin-mcp/services/requirements.py`, a component this fixture never calls. The fix was a no-op (every echoed date was `null` either way) and has been reverted in full; PIPE-14 was unaffected by it either way, which is itself part of how the false premise was caught.
4. **PIPE-11's requirement-label click computed a target that Auto correctly refuses to draw.** The batch plan's world grew a real second band (`No epic`) once epic-containment shipped, so the factory-default landing (req #3312) now lands this specific four-step fixture at `'out'`, where req labels are correctly undrawn by the semantic-level ladder. The fix is the file's own established pattern for this class of problem — pin a level rather than zoom — but the OTHER established helper (`zoomToLegibleMid`, which wheels in around the canvas CENTER) is the wrong tool here: on a plan this small it pans the specific label off screen (measured: the computed click point landed at negative screen coordinates). Pinning `L2` instead changes what is drawn without moving the camera — the same guarantee PIPE-16 asserts of the level control — so the already-correct landing transform stays valid for the coordinate math.

**Measured result, the full file, every test run at least once: 21 of 26 specs pass.** `data-testid^="pipeline-launch-command-"` / the launch line (with the exclusion list intact), the click-target trio, and the sort_order-corrected band stacking are all exercised and green — PIPE-01 through PIPE-13, PIPE-15, PIPE-16, PIPE-17, PIPE-20, PIPE-22, PIPE-23.

**Five failures, and they are NOT independent — reported as ONE systemic finding rather than five, because four of the five measurably share a root cause.** `test.describe.configure({mode: 'serial'})` means one failure blocks everything after it in file order, so getting a complete picture required re-running with `--grep` past each failure in turn — the numbers below are the first time this file has been run end to end since `527d278` broke its import.

- **PIPE-14, PIPE-16b, PIPE-19 and PIPE-21 all fail on the SAME class of assertion against `fixture.mainPipelineId`** (the 34-step Substrate plan): the live page's landing/derived camera scale does not match what the spec's local re-derivation of the identically-seeded plan predicts. PIPE-14 measured it most precisely: the page consistently lands at `k = 0.2569` against `factoryDefaultScale`'s locally-computed `0.334` (`toBeCloseTo` precision 2 — off by ~15× the tolerance), **deterministic to four decimal places across repeated runs**, ruling out a race. Ruled out as causes, each verified directly rather than assumed: a settling race (added an explicit wait — no change), `epicCounts` omitted from the local layout (added it — no change, count-suffix text does not move column/band geometry), and both real fixture fixes above (neither moved this number). The arithmetic is consistent with production computing a materially taller or wider world than the local re-derivation produces (`0.2569` implies a ~2491-unit-tall or ~4274-unit-wide world against the test's own `1860.5 × 3288.0`), but which dimension, and why, was not isolated within this session. PIPE-16b fails the identical `toBeCloseTo(kFactory, 2)` assertion at a different absolute scale (`0.3967` vs `0.4921`); PIPE-19 and PIPE-21 fail because a canvas hover/click target computed from the same locally-recomputed geometry misses on live canvas. **None of the four is touched by, or downstream of, anything req #3371–#3375 changed** — the Substrate fixture's steps, requirements and dependency structure are untouched by this session, and the `epics.sort_order` fix above provably does not move this number (confirmed by direct measurement before and after).
- **PIPE-18 fails on an unrelated header-row responsive-width assertion** (`docOverflow` 128px at a 1152px viewport, expected ≤0). This is `PipelinePlanToolbar`'s own layout math, has nothing to do with Batch, Feature or epic containment, and was not investigated further — it is a different bug in a different subsystem, filed here only because running the rest of the suite required stepping past it.

**Filed here rather than forced green, on the requirement's own instruction** that a test needing to change is "a finding to report rather than a test to quietly edit," and on the intellectual-honesty rule against shipping an assertion nobody has actually made true. **Next step for whoever picks up PIPE-14/16b/19/21**: instrument `factoryDefaultScale`'s actual call site in `PipelinePlanVisualizer.jsx`, or intercept the live `darwin_dev` REST responses for `mainPipelineId` (as this session did transiently, via a `page.on('response', ...)` listener, since removed), to compare the PRODUCTION `layout.width`/`layout.height` against the spec's local recomputation directly rather than inferring them from `k0`. PIPE-18 needs a fresh, unrelated investigation into the header row's own width arithmetic at narrow viewports.

### 6. Coverage gate (req #3376)

`python3 scripts/swarm/verification_matrix.py --assert-covered --req 3375` — **OK**, all 5 owned behaviours (`VIS-001`…`VIS-005`) covered or untestable-with-note, zero orphaned markers:

| id | statement | disposition |
|---|---|---|
| VIS-001 | Every step renders under exactly one epic | `COVERS: VIS-001` — `pipelineModel.test.js`, step 19's singular dominant `epic` vs its full `epicLabels` set |
| VIS-002 | Display order in the view is a tree walk | `COVERS: VIS-002` — `pipelinePlanLayout.test.js`, a hand-built cross-epic-dependency fixture proving epic-band grouping wins over a global topological sort, not only the `epics.sort_order` override (code review: the first placement, on the sort_order test alone, proved a narrower claim) |
| VIS-003 | Nothing in the render groups steps into a batch | `COVERS: VIS-003` — `pipelinePlanLayout.test.js`, the removed-second-positional-argument guard |
| VIS-004 | No feature tier appears in the render or in its model | `COVERS: VIS-004` — `pipelineViewModel.test.js`, a `planRenderRows` entry's exact key set (no `showFeature`/`feature` of any kind); `pipelines.spec.ts` PIPE-03 adds the DOM-level absence check (`[data-testid^="pipeline-feature-"]` count 0). Code review: the marker's first placement (PIPE-03's comment alone) asserted nothing about features at all, and the statement's "in its model" half is FALSE of `pipelineModel.js`'s `PlanRow` (still carries `featureId`/`feature`/`featureLabels`, #3349's boundary, deliberately) — narrowed to the render-preparation model (`planRenderRows`'s output), which is what is actually true |
| VIS-005 | State-banding invariant is scoped to the epic, 0 violations on live data | `untestable`, `pending: 3349` — § 2 above |

### 7. Coverage analysis of the changed area

The change surface for this requirement is the files listed in § 5's defect list plus the new assertions in § 1 (the halo measured-number pin, the VIS-002/VIS-004 tests, the five `COVERS:` markers) — not a global percentage. `npx vitest run src/SwarmView/pipelines/` (the full pipeline-surface suite: 23 files, including every file this requirement touched) is **907/907 green**; the pre-existing, unrelated failures elsewhere in the repo (`src/SwarmView/__tests__/sessionPipelineLink.test.js`, `src/__tests__/dataGridRowHeight.test.js` — confirmed present on the clean base commit via `git stash`, before this session's changes) are out of this requirement's scope and were not touched.

### 8. This section's own code review

A `code-reviewer` pass on this requirement's diff (mandatory per the deployed-worker procedure) found one Critical (§ 5 item 1's exclusion-list bug, fixed), disproved one of the four claimed fixture fixes (§ 5 item 3, reverted), and found two of the five `COVERS:` markers attached to a test that did not actually demonstrate its behaviour (VIS-002, VIS-004 — both corrected in § 6's table above). One further note, not acted on: `darwin-mcp/services/pipeline_derive.py` (the Python twin CLAUDE.md's Single DB Gateway / DRY doctrine names as this surface's drift control) publishes per-row `launch_block` but not `swarm_start_command`/`no_launch_reason` — the two fields this requirement's Critical fix added to the JS side. Both fields are pure BROWSER-TABLE rendering (`StepLaunchLine`'s own payload, never read by the orchestration engine `pipeline_derive.py` serves), so this may not be a real asymmetry, but the call belongs to whoever owns that boundary and is recorded here rather than decided unilaterally from a test-only session.
