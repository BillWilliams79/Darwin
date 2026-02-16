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
| AREA-03 | DnD reorder areas (keyboard) | area.spec.ts | **Skipped** |
| TASK-01 | Create task via template | task.spec.ts | Pass |
| TASK-02 | Toggle task done | task.spec.ts | Pass |
| TASK-03 | Toggle task priority | task.spec.ts | Pass |
| TASK-04 | Delete task with confirmation | task.spec.ts | Pass |
| TASK-05 | DnD task between areas | task.spec.ts | Pass |
| NAV-01 | Navigate between all views | navigation.spec.ts | Pass |

**P0 Coverage: 12/13 (92%)** — AREA-03 skipped due to @hello-pangea/dnd keyboard DnD flakiness in parallel headless Chromium.

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

## Untested Features — Prioritized Gap List

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
   - **Priority: P2** — works in manual testing, hard to automate reliably

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

## AREA-03 Skip Analysis

**Test**: AREA-03 — DnD reorder areas in AreaEdit via @hello-pangea/dnd keyboard API

**Why skipped**: @hello-pangea/dnd keyboard DnD requires:
1. Focus on drag handle
2. Space to lift (triggers screen reader announcement)
3. Arrow keys to move
4. Space to drop

In parallel headless Chromium, the Space key event sometimes fails to initiate the drag lift, causing intermittent failures. The DnD library's internal state machine depends on focus/blur events that behave differently in headless mode.

**Workaround attempted**: Longer timeouts, sequential test execution — still flaky (~30% failure rate).

**Recommendation**: Keep skipped. The area reorder functionality is tested indirectly via API-based sort_order verification in AREA-07 (sort-order.spec.ts). The actual DnD UI interaction is a library-level concern.

## Component Coverage Summary

| Component | View | Tests | Coverage |
|-----------|------|-------|----------|
| TaskCard | TaskPlanView | TASK-01–05, DND-03–07 | Excellent |
| DroppableTab | TaskPlanView | DOM-01, DOM-02, AREA-06 | Good |
| AreaTableRow | AreaEdit | AREA-01–05, AREA-07 | Good (minus DnD) |
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
