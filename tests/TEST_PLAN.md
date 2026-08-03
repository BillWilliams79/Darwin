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
| `pipeline-mutations.spec.ts` | MUT-01…08 (9) | The eight recorded mutation classes, via the MCP tools |

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

Three plans are seeded: the 34-step Substrate plan, a four-step launch-batch plan,
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
| PIPE-04 | Launch-batch banner | `LAUNCH BATCH A`, the exact `/swarm-start <ids>` command, the wall-clock gate, the banner immediately above its first member, the legend key, and — since req #3303 — the ABSENCE of any condensation advisory, asserted here because this is the plan shape that used to raise one |
| PIPE-04b | No batch | No banner and NO legend key on the Substrate plan, with `batches === []` asserted as a precondition |
| PIPE-05 | Time / Tokens toggle | Cost hidden by default; one cell per row when revealed; a dash or a real figure; no cost-error notice |
| PIPE-06 | Requirement link | Renders the bare id and navigates to `/swarm/requirement/:id` |
| PIPE-07 | NO-'#' audit | Zero `#<digits>` in generated labels on both views. Stored plan prose is excluded — and the exclusion is evidenced, since the fixture's step 22 really contains "#3077 R13" |
| PIPE-08 | Visualizer drag | The canvas mounts, a drag changes the world transform (pixel diff on a plan with no pulsing bead), and neither the container nor the document scrolls horizontally |
| PIPE-09 | Zoom | The level chip crosses Overview → Plan → Detail and the canvas redraws at each |
| PIPE-10 | Batch box + conditional key | One dashed box and a visible key on the batch plan; no box and no key on the Substrate plan |
| PIPE-11 | Click targets | Bead → Table mode focused on that row; requirement label → `/swarm/requirement/:id`; epic band label → `/swarm/features?epic=<id>` |
| PIPE-12 | Loud failure | The corrupted plan raises the non-dismissible invariant banner naming the cycle, on BOTH views |
| PIPE-13 | Description in the title bar (req #3179) | The goal field is ABSENT from the page column; the info button is inside the header row, right of the title and every chip; it opens a Dialog carrying the seeded text and closing unmounts it; and the canvas starts within 16px of the header row and runs to the bottom of the viewport |

### MUT — the eight recorded mutation classes

Each case asserts the tool's ECHO, the DERIVED state, and a `verifyOrder`-clean
order re-read from `darwin://pipeline/{id}` — after every mutation, not once at
the end.

| ID | Recorded case | Expected |
|----|---------------|----------|
| MUT-01 | Step inserted mid-pipeline (#3078) | The new step lands with its gate and links; the displaced step re-gates onto it; topological order follows |
| MUT-02 | Requirement wontfixed, scope folded (#3041 → #3072/#3077) | wontfix is terminal so the step derives Complete; the fold note lands in the RECEIVING requirement; the step then leaves the plan with no link, dep or dangling reference behind |
| MUT-03 | Coordination flipped with an autonomy grant (#3075) | The flip and the note echo back; coordination is NOT a state input, so the derived state and the order are untouched |
| MUT-04 | Step re-scoped after filing (B5 split) | Title and notes update; `notes` REPLACES on the second write; an unset field is left alone |
| MUT-05 | Gate passed WITH EXCEPTIONS (s1.4) | The disposition is stored in the step notes and `completed_at` is stamped — valid only because the step links no requirements, and a later link attempt is refused |
| MUT-06 | Dual-condition gate (s0.4) | Two dep rows on one step; eligibility stays false with either half unsatisfied and flips true only when BOTH hold |
| MUT-07 | Two requirements, one step (s0.5) | Running while any is `development`; Scheduled in the honest middle; Complete only when all are terminal (`deferred` counts) |
| MUT-08 | Step dropped without residue (#3065/#3074) | The drop is REFUSED while another step gates on it and the message names that step, with nothing deleted on the way; after the reference clears, the hard delete leaves no step, link or dep row |
