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
│   │   ├── auth.spec.ts           # AUTH-01 through AUTH-05
│   │   ├── domain.spec.ts         # DOM-01 through DOM-05
│   │   ├── area.spec.ts           # AREA-01 through AREA-07
│   │   ├── task.spec.ts           # TASK-01 through TASK-10
│   │   ├── calendar.spec.ts       # CAL-01, CAL-02
│   │   ├── navigation.spec.ts     # NAV-01, RESP-01
│   │   ├── error.spec.ts          # ERR-01
│   │   └── profile.spec.ts        # PROF-01
│   ├── helpers/
│   │   ├── react-dnd-drag.ts      # Synthetic DragEvent helper for react-dnd
│   │   └── auth-setup.ts          # Cognito InitiateAuth + cookie injection
│   ├── fixtures/                   # Test data files
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
