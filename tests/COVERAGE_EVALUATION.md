# E2E Test Coverage Evaluation

## Summary

**47 tests** across 17 spec files (46 active + 1 skipped). Coverage maps against 34 test IDs from TEST_PLAN.md plus 13 tests added post-plan.

## Test Inventory by Spec File

| Spec File | Tests | Test IDs |
|-----------|-------|----------|
| auth.spec.ts | 2 | AUTH-01, AUTH-02 |
| auth-p1.spec.ts | 2 | AUTH-03, AUTH-04 |
| domain.spec.ts | 2 | DOM-01, DOM-02 |
| domain-p1.spec.ts | 2 | DOM-03, DOM-04 |
| domain-counts.spec.ts | 2 | DOM-06, DOM-07 |
| area.spec.ts | 2+1skip | AREA-01, AREA-02, AREA-03 (skipped) |
| area-p1.spec.ts | 3 | AREA-04, AREA-05, AREA-06 |
| task.spec.ts | 5 | TASK-01 through TASK-05 |
| task-p1.spec.ts | 5 | TASK-06, TASK-07, TASK-08, TASK-09, TASK-10 |
| task-dnd.spec.ts | 5 | DND-03, DND-04, DND-05, DND-06, DND-07 |
| cancel-drag.spec.ts | 2 | DND-01, DND-02 |
| calendar.spec.ts | 2 | CAL-01, CAL-02 |
| navigation.spec.ts | 1 | NAV-01 |
| sort-order.spec.ts | 6 | DOM-05, AREA-07, TASK-09, TASK-11, TASK-12, TASK-13 |
| error.spec.ts | 1 | ERR-01 |
| error-p1.spec.ts | 1 | ERR-02 |
| profile.spec.ts | 2 | PROF-01, PROF-02 |

## TEST_PLAN.md Coverage Matrix

### P0 — Critical (13 planned)

| Test ID | Planned | Implemented | Status |
|---------|---------|-------------|--------|
| AUTH-01 | Full login via Cognito hosted UI | auth.spec.ts | Pass |
| AUTH-02 | Auth guard redirects unauth users | auth.spec.ts | Pass |
| DOM-01 | Create domain via dialog | domain.spec.ts | Pass |
| DOM-02 | Close domain tab | domain.spec.ts | Pass |
| AREA-01 | Create area via template | area.spec.ts | Pass |
| AREA-02 | Close area card | area.spec.ts | Pass |
| AREA-03 | DnD reorder areas (dnd-kit mouse) | area.spec.ts | Pass |
| TASK-01 | Create task via template | task.spec.ts | Pass |
| TASK-02 | Toggle task done | task.spec.ts | Pass |
| TASK-03 | Toggle task priority | task.spec.ts | Pass |
| TASK-04 | Delete task with confirmation | task.spec.ts | Pass |
| TASK-05 | DnD task between areas | task.spec.ts | Pass |
| NAV-01 | Navigate between all views | navigation.spec.ts | Pass |

**P0 Coverage: 13/13 (100%)** — AREA-03 runs on dnd-kit with real pointer input since req #3664 (it was skipped while AreaEdit was on @hello-pangea/dnd).

### P1 — Important (13 planned)

| Test ID | Planned | Implemented | Status |
|---------|---------|-------------|--------|
| AUTH-03 | Logout clears session | auth-p1.spec.ts | Pass |
| AUTH-04 | Expired token handled | auth-p1.spec.ts | Pass |
| DOM-03 | Update domain name | domain-p1.spec.ts | Pass |
| DOM-04 | Hard delete domain | domain-p1.spec.ts | Pass |
| AREA-04 | Update area name | area-p1.spec.ts | Pass |
| AREA-05 | Hard delete area | area-p1.spec.ts | Pass |
| AREA-06 | DnD area cross-domain | area-p1.spec.ts | Pass |
| TASK-06 | Update task description | task-p1.spec.ts | Pass |
| TASK-07 | Task edit dialog | task-p1.spec.ts | Pass |
| TASK-08 | Template row disabled | task-p1.spec.ts | Pass |
| CAL-01 | Done tasks in CalendarView | calendar.spec.ts | Pass |
| CAL-02 | Day view shows tasks | calendar.spec.ts | Pass |
| ERR-01 | API error shows snackbar | error.spec.ts | Pass |

**P1 Coverage: 13/13 (100%)**

### P2 — Nice to Have (8 planned)

| Test ID | Planned | Implemented | Status |
|---------|---------|-------------|--------|
| AUTH-05 | New user signup | — | **Not implemented** |
| DOM-05 | Domain sort order | sort-order.spec.ts | Pass |
| AREA-07 | Area sort order | sort-order.spec.ts | Pass |
| TASK-09 | Task sort order (priority) | sort-order.spec.ts | Pass |
| TASK-10 | Tab-hover-switch on drag | — | **Not implemented** |
| DND-01 | Cancel drag returns item | cancel-drag.spec.ts | Pass |
| PROF-01 | Profile drawer | profile.spec.ts | Pass |
| RESP-01 | Responsive viewport | — | **Not implemented** |

**P2 Coverage: 5/8 (63%)** — AUTH-05, TASK-10, RESP-01 not implemented.

## Tests Added Beyond Original Plan

These 13 tests were added in sessions after the original TEST_PLAN.md was written:

| Test ID | File | Description | Added With |
|---------|------|-------------|------------|
| DOM-06 | domain-counts.spec.ts | Areas/Tasks column headers in DomainEdit | PR#23 |
| DOM-07 | domain-counts.spec.ts | Area and task counts accuracy | PR#23 |
| TASK-09 | task-p1.spec.ts | Priority set during creation persists | PR#22 |
| TASK-10 | task-p1.spec.ts | No duplicate task on Enter+priority race | PR#22 |
| TASK-11 | sort-order.spec.ts | Tasks render in sort_order (hand mode) | PR#29 |
| TASK-12 | sort-order.spec.ts | Sort mode toggle switches order | PR#29 |
| TASK-13 | sort-order.spec.ts | Hand-sort DnD reorder persists | PR#29 |
| DND-02 | cancel-drag.spec.ts | Cancel task drag fires no PUT | PR#29 |
| DND-03 | task-dnd.spec.ts | Same-card hand-sort reorder | PR#29 |
| DND-04 | task-dnd.spec.ts | No duplicates/artifacts after DnD | PR#29 |
| DND-05 | task-dnd.spec.ts | Cross-card drag in priority mode | PR#29 |
| DND-06 | task-dnd.spec.ts | Cross-card to hand-sorted target | PR#29 |
| DND-07 | task-dnd.spec.ts | Cancel hand-sort drag — no PUT | PR#29 |
| ERR-02 | error-p1.spec.ts | 404 page for invalid routes | PR#36 |
| PROF-02 | profile.spec.ts | Profile page via direct navigation | Post-plan |

**Note**: TASK-09 and TASK-10 exist in both task-p1.spec.ts and sort-order.spec.ts/TEST_PLAN.md with different meanings. The task-p1.spec.ts versions test race conditions; the plan/sort-order versions test sort ordering.

## Untested Areas — Prioritized Gap List

### High Priority Gaps

1. **LoggedIn Error Paths** (6 paths in `src/LoggedIn/LoggedIn.jsx`)
   - No auth code in URL → "No authorization code returned" (line 49)
   - CSRF mismatch → "CSRF Tokens did not match" (line 59)
   - Missing PKCE code_verifier → "PKCE code verifier missing" (line 66)
   - Token exchange failure → "Authentication failed" (line 108)
   - JWT validation failure → implicit (caught by call_rest_api error chain)
   - Profile fetch failure → snackbar error (line 101, 104)

   **Assessment**: These are real user-facing error paths but testing them requires mocking Cognito token exchange, PKCE storage, and JWT validation — complex test infrastructure for edge cases that only occur during auth flow corruption. **Priority: P2** — would need Playwright route interception for `/oauth2/token` endpoint.

2. **TASK-10 (Plan): Tab-hover-switch during drag** (`DroppableTab` 500ms timer)
   - The plan specified testing tab switching during drag-hover
   - Requires sustained drag-hover coordination between react-dnd synthetic events and tab monitoring
   - **Since covered** with real input on dnd-kit: `plan-dnd.spec.ts` PDND-07/08 (req #3662),
     `swarm-dnd.spec.ts` SDND-12/13 and `recurring-tasks.spec.ts` REC-DND-02/03 (req #3663)

3. **RESP-01: Responsive viewport**
   - No mobile viewport tests
   - Would test 375x667 viewport across key views
   - **Priority: P3** — Darwin is primarily a desktop app

### Medium Priority Gaps

4. **AUTH-05: New user signup and provisioning**
   - Full signup flow via Cognito hosted UI
   - Would create a real Cognito user → trigger Lambda-Cognito → verify provisioned data
   - **Not testable in E2E** without disposable email — better tested via Lambda-Cognito integration tests
   - **Priority: Skip** — covered by Lambda-Cognito test suite (13 tests)

5. **Empty state rendering**
   - No tests for empty domain list, empty area cards, or empty calendar
   - Low risk — these are simple conditional renders
   - **Priority: P3**

### Low Priority Gaps

6. **SnackBar auto-hide timing**
   - ERR-01 tests snackbar appearance but timing assertions are inherently flaky
   - Current test does check auto-hide (line 41 in error.spec.ts)
   - **Priority: Covered** — already in ERR-01

7. **Concurrent mutation conflicts**
   - No tests for two browser sessions modifying same data
   - Out of scope for single-user E2E
   - **Priority: Skip**

## AREA-03 (formerly skipped)

AREA-03 was skipped while AreaEdit dragged through @hello-pangea/dnd, whose keyboard lift failed
intermittently in headless Chromium. Req #3664 moved every editor onto the dnd-kit foundation and
removed @hello-pangea/dnd; AREA-03 now drives a real pointer drag and runs, and
`editors-dnd.spec.ts` covers the editors' lift, reflow, persistence, keyboard reorder, closed-row
and template non-targets, edge auto-scroll and touch.

## Component Coverage Summary

| Component | View | Tests | Coverage |
|-----------|------|-------|----------|
| TaskCard | TaskPlanView | TASK-01–05, DND-03–07 | Excellent |
| DroppableTab | TaskPlanView | DOM-01, DOM-02, AREA-06 | Good |
| AreaTableRow | AreaEdit | AREA-01–05, AREA-07, EDND-01–05, EDTOUCH-01–02 | Excellent |
| DomainEdit | DomainEdit | DOM-03–07 | Excellent |
| CalendarView | CalendarView | CAL-01, CAL-02 | Good |
| TaskEditDialog | CalendarView | TASK-07 | Minimal |
| NavBar | All views | NAV-01, PROF-01, PROF-02 | Good |
| LoggedIn | Auth callback | AUTH-01 (partial) | **Weak** |
| Error404 | Error | ERR-02 | Good |
| SnackBar | All views | ERR-01 | Good |

## Recommendations

1. **No immediate action needed** — 92% P0, 100% P1, 63% P2 is strong coverage
2. **LoggedIn error paths** are the most significant gap but require complex test infrastructure
3. **AREA-03** should remain skipped — the risk is low and the flakiness is a library issue
4. **Responsive testing** is low priority for a desktop-focused productivity app
5. **New user signup** is adequately covered by the Lambda-Cognito integration tests

---

## Swarm Orchestration pipelines — coverage analysis (req #3118)

**22 tests across 2 spec files** (13 UI + 9 mutation-replay), all passing headless
in ~2.8 minutes. Test IDs and the fixture strategy are documented in TEST_PLAN.md
§ "Swarm Orchestration — pipelines acceptance battery".

### What is covered, by design rule

| req #3080 rule | Covered by |
|----------------|------------|
| 1 — DERIVED, never stored (an epic has no state; its open work is derived) | PIPE-03 (every chip), MUT-05 (a req-less epic holds no open work and carries no `completed_at` — req #3750/#3752), MUT-07 (all three derivations) |
| 2 — an epic is a swarm-start (launch unit) | PIPE-04 (the epic row's own exact `/swarm-start` command — literally this rule since req #3371 made the epic the launch unit; also asserts no condensation advisory, which req #3303 deleted, so the rule is covered by what the EPIC launches and never by a proposal to merge), MUT-07 (multi-requirement epic) |
| 3 — display order computed + self-verified | PIPE-02 (full sequence vs `displayOrder`), PIPE-12 (loud failure), every MUT case (`verifyOrder` clean after each) |
| 4 — deps reference stable epic ids | MUT-08 (drop refused while referenced, named gate, no residue) |
| 5 — render path is fast, no N+1 | MUT `readPlan()` uses the single composed read and asserts `epic_count` against the epics returned |
| 6 — refresh is event-driven | Indirect only — see gaps |
| 7 — automation that waits fails loud | Out of scope here (the watchdog is a shell script, not a UI surface) |
| 8 — launch unit visibility | PIPE-04 (exact `/swarm-start` args on the epic's own row, and the gate). PIPE-10's dashed rectangle and conditional key were deleted with the multi-epic launch grouping (req #3371) |
| 9 — requirement-centric views carry no session data | Structural: the plan reads carry no session table at all |
| 10 — one initiative/feature label per epic | PIPE-03 (contiguous groups compared by ID, not title) |

Production directives from the POC polish review are covered by PIPE-07 (no '#'),
PIPE-08 (no horizontal scrollbar, drag-pan), PIPE-11 (epics/requirements/initiatives are
clickable links).

### Defect found and fixed by this battery

`pipelines-datagrid` never reached the DOM: the testid was handed to `<DataGrid>`,
which MUI does not forward to the grid root, so the registry entry named in
`PipelinesTableView.jsx`'s own header was unqueryable. Moved to a wrapping `<Box>`,
matching `RequirementsTableView` / `InstructionsTableView`.

### Gaps — deliberately not covered

1. **Per-level canvas detail suppression.** PIPE-09 asserts that the level chip
   crosses Overview → Plan → Detail, that `data-transform`'s scale moves in the
   right direction at each, that the canvas redraws, and that the layout really
   contains the label kinds the ladder gates (`title` at `in`, `epic` suppressed
   at `out`). What it does NOT assert is that those labels are absent from the
   rendered BITMAP at the wrong level — Konva draws to a canvas, so proving that
   needs pixel-region comparison or a screenshot baseline.
   **Priority: low** — what remains unproven is three lines of
   `if (level === …) return` between a verified level and a verified label set.
2. **The hover datacard.** Content and edge-clamping of `PlanDataCard` are
   untested: it is triggered by a canvas `mouseenter` hit-test and its rows are
   built from the same `row.cost` / `formatTimeGates` the table asserts.
   **Priority: medium** — it is the visualizer's whole detail surface.
3. **Failed-read banners.** `pipeline-dictionary-error` and `pipeline-cost-error`
   are asserted ABSENT on healthy data but never provoked; making them appear needs
   request interception on specific list reads. Both exist because a silent failure
   would read as real data, so the positive case has real value.
   **Priority: medium.**
4. **Design rule 6 (event-driven refresh).** No test mutates a requirement and
   watches an open plan page update. The refresh is TanStack Query's staleTime +
   `refetchOnWindowFocus` + invalidation rather than code this feature owns, but
   the rule is about the plan staying current and nothing proves that end to end.
   **Priority: medium.**
5. **Truncated composed reads.** `readPlan()` scans each returned list for a
   `_truncated` marker element — which is where `truncate_to_budget` actually puts
   one — but no fixture is large enough to produce it, so the branch is
   unexercised. (An earlier version of this guard checked a top-level
   `composed._truncated`, which the service never sets on a dict payload: a check
   that could not fire, on a payload shape where a real marker would have reached
   `buildPipelineModel` as a row with `id: undefined`.)
   **Priority: low** — req #3078's own suite covers the budget logic.

7. **Rendered order after a mutation.** The MUT spec has no browser: after each
   of the eight mutations it re-runs the engine over a fresh composed read, so
   what is proven invariant-clean is the ORDER, not the PAGE. Nothing checks that
   the plan page survives the eight mutations end to end.
   **Priority: medium** — the two halves meet only at the shared engine import.

8. **The other five order invariants.** Only `cycle` has a corrupted fixture.
   `topology`, `state-banding`, `batch-contiguity`, `duplicate-id` and
   `dangling-dependency` have none — and `duplicate-id` has a dedicated banner
   branch in `PipelinePlanTable.jsx` that this battery never reaches. (The engine's
   vitest suite covers the detection itself; what is untested is the banner.)
   **Priority: medium** — these are the loud-failure paths, and a loud-failure
   path that is never exercised is indistinguishable from a silent one.
6. **Cost with real numbers.** Every seeded requirement is new, so the Cost column
   is all em-dashes; PIPE-05 deliberately accepts "a dash OR a real figure" so it
   cannot break when a rollup starts returning figures, but the formatted
   `Xh Ym / Nk tok` path is only covered by the `fmtCost` unit tests.
   **Priority: low.**

## Engine view — `/swarm/engines` and the plan page's Engine mode (req #3760)

`tests/tests/engine-view.spec.ts` (ENG-01…05) drives the user actions the page offers against
routed engine-table reads whose decision records `core.decide()` produced
(`src/SwarmView/engine/__tests__/engineViewFixture.json`, regenerated by
`scripts/swarm/engine2/view_fixture.py`; `tests/engine/test_view_fixture.py` fails when stale):

| Test | Proves | Engine coverage row |
|---|---|---|
| ENG-01 | opens on every engine: latest decision, missing BY AGE, off greyed with its stop time, limits, cut line | I7 |
| ENG-02 | scrubs history back, reads what changed, returns to Latest | A20 |
| ENG-03 | an admission the executor failed is admitted again and lands | A19 |
| ENG-04 | an epic link opens the plan view framed on that epic | — |
| ENG-05 | Engines sits under Pipelines in the navbar | — |

Component coverage (vitest, `src/SwarmView/engine/__tests__/`): each panel against fixture
records including `missing` health and an empty queue (`EnginePanels.test.jsx`); the page and the
plan-scoped mode with a live store that publishes new cycles (`EnginesPage.test.jsx`); the model
(`engineRecordModel.test.js`); the vocabulary held to `core.py` and the heartbeat schema
(`engineVocabulary.test.js`). The plan page's Plan | Engine switch is
`src/SwarmView/pipelines/__tests__/PipelineDetail.planOnly.test.jsx`.

**Not covered here, deliberately:** a LIVE engine on the page — that is req #3763's cutover.

## Plan view engine overlay — `/swarm/pipeline/:id?mode=plan` (req #3762)

`tests/tests/plan-engine-overlay.spec.ts` drives the overlay against routed reads answered from
`src/SwarmView/engine/__tests__/planOverlayFixture.json` — the composed read, the machine's ceiling
and live sessions, the live claims and the engine's rows, every record and every prediction
produced by `core.decide()` (`scripts/swarm/engine2/overlay_fixture.py`;
`tests/engine/test_overlay_fixture.py` fails when stale). The switch's writes land in the spec's
in-memory tables, so no E2E data is touched. The machine is named in the link
(`?engineMachine=1`): the Desktop Chrome profile reports a Windows platform.

| Test | Proves | Engine coverage row |
|---|---|---|
| OVL-01 | switch ON from the plan view: `desired_state` written by the user, a draft plan activated, the engine comes up, badges + cut + slots become its record exactly, role reads Primary (req #3981) | A1, A21 |
| OVL-02 | switch OFF: written, the plan untouched, the overlay returns to the prediction | A2 |
| OVL-03 | hovering a held epic gives its hold in the engine view's plain words | I7 |
| OVL-A8…A18, A21 | every state of each action's scenario drawn from the engine's record, then the same plan predicted with the engine off | A8–A18, A21 |

Component coverage (vitest, `src/SwarmView/engine/__tests__/`): the engine-off prediction replayed
against `decide()` on every cycle of the scenario corpus (`enginePredict.test.js`); records and
derived blocks mapped to badges, the cut, limits and launch machines (`engineOverlay.test.js`); the
switch's lifecycle-contract writes, the 409 race and the echo check (`engineSwitchApi.test.js`); the
strip and the badge (`PlanEngineOverlay.test.jsx`); the fast read while an engine comes up
(`engineTransitioning.test.js`).

**Not covered here, deliberately:** a LIVE supervisor answering the switch — that is req #3763's
cutover; the spec plays the supervisor's part from the fixture.
