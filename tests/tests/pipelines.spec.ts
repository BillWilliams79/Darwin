import { test, expect, Page, Locator } from '@playwright/test';
import { getIdToken } from '../helpers/api';
import { seedPipelineFixture, SeededPipelines } from '../helpers/pipelineFixture';

// Swarm Orchestration — the browser half of the req #3118 acceptance battery.
// The MCP mutation half lives in pipeline-mutations.spec.ts.
//
// Everything here renders from ONE seeded plan (helpers/pipelineFixture.ts: the
// req #3083 Substrate Rebuild plan, 34 steps) plus two purpose-built variants —
// a launch-batch plan and a deliberately corrupted one. Seeding is the only
// non-UI act; every assertion afterwards goes through the app.
//
// ── The load-bearing assertion ──────────────────────────────────────────────
// PIPE-02 compares the rendered row sequence against `orderedPlan()` run over
// the same seeded rows, element for element. That is design rule 3's contract
// at the page level: the engine computes the order, the page must render THAT
// order, and the engine's own self-check must be clean. The engine's ordering
// ALGORITHM is proven against the archived POC by the vitest suite; what this
// spec proves is the wiring — that the query layer, the adapter and the table
// deliver it intact.
//
// ── Waits ───────────────────────────────────────────────────────────────────
// Event/response based only, no sleeps. The plan page paints from seven list
// reads; `pipeline-plan-table` appearing means every one of them resolved,
// because PipelineDetail gates its whole render on them.

import {
    buildPipelineModel,
    orderedPlan,
    rowMachineLabel,
} from '../../src/SwarmView/pipelines/pipelineViewModel.js';
import {
    computePlanLayout, REQ_LINE_H, K_READABLE, BEAD_HIT_RADIUS,
    epicFocusTransform, FOCUS_PAD, FOCUS_MAX_RATIO,
} from '../../src/SwarmView/pipelines/pipelinePlanLayout.js';
// PIPE-19 asserts the Autonomy row against the label table the card renders
// through, not against a hand-copied string — the point of D5 is that the card
// shows the UI's word for a coordination type and never the raw column.
import { COORDINATION_LABELS } from '../../src/CalendarFC/timeSeriesSizes.js';
import { aiModelLabel } from '../../src/SwarmView/modelChipStyles.js';
import { effortLabel } from '../../src/SwarmView/effortChipStyles.js';

// UTC so the seeded naive timestamps and the rendered ones agree on any host.
test.use({ timezoneId: 'UTC' });

// EXACTLY what PipelineDetail passes the visualizer now that the `Reqs:` and
// `Step:` controls are gone (user directive 2026-08-01): the requirement marks
// are always the vertical stack reserving their TITLE's box, and the step label
// is always the title. Width is the one thing still chosen, and `pinPreferences`
// pins it to `compact`. Every layout this spec computes for a click target uses
// this object, so the spec and the page cannot disagree about the geometry.
const PLAN_VIEW_OPTIONS = {
    reqLayout: 'vertical' as const,
    reqLabel: 'title' as const,
    stepLabel: 'title' as const,
    stepWidth: 'compact' as const,
};

/**
 * The epic -> {met,total} lookup the visualizer feeds `computePlanLayout`,
 * mirroring `PipelinePlanVisualizer.jsx`'s own memo.
 *
 * NEEDED FROM req #3241, when the Counts toggle began defaulting ON: the band
 * label is `${epic} ${met}/${total}` from that moment, and a spec that computes
 * its expectations from a layout built WITHOUT this map is asserting against a
 * plan the component is not drawing. That bites hardest where the label is read
 * as TEXT rather than as geometry — the epic chip's `aria-label` and the ↗'s
 * `title` are both interpolated from it — because those assertions fail loudly
 * while a small geometric difference would not.
 */
type EpicCount = { epicId: number; met: number; total: number };
const epicCountsOf = (p: ReturnType<typeof orderedPlan>) =>
    new Map((p.requirementCounts?.byEpic || []).map(
        (c: EpicCount) => [c.epicId, c] as [number, EpicCount]));

// One seed for the whole file — ~200 gateway inserts is not something to repeat
// per test, and every test is read-only against it.
//
// The timeout is raised above Playwright's 30 s default deliberately: several
// tests below wait on a specific locator with an explicit 30 s budget, and under
// the default an expiring TEST would always pre-empt them, so the targeted
// timeout could never actually fire with its targeted message.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('Swarm Orchestration — pipelines UI', () => {
    let idToken: string;
    let fixture: SeededPipelines;
    let plan: ReturnType<typeof orderedPlan>;        // the Substrate plan
    let batchPlan: ReturnType<typeof orderedPlan>;   // the launch-batch plan

    /** Run the engine over a seeded model exactly as the detail page does. */
    const enginePlan = (model: SeededPipelines['models']['main']) =>
        orderedPlan(buildPipelineModel({
            pipeline: model.pipeline,
            steps: model.steps,
            stepRequirements: model.stepRequirements,
            stepDeps: model.stepDeps,
            requirements: model.requirements,
            features: model.features,
            epics: model.epics,
            machines: model.machines,
        }), { now: new Date() });

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(900_000);
        const context = await browser.newContext({ storageState: '.auth/user.json' });
        const page = await context.newPage();
        idToken = await getIdToken(page);
        await context.close();

        const sub = process.env.E2E_TEST_COGNITO_SUB;
        if (!sub) throw new Error('E2E_TEST_COGNITO_SUB is required to seed the plan fixture');

        fixture = await seedPipelineFixture(idToken, sub);

        // The engine over exactly what was seeded — the expectation every
        // ordering/labelling assertion below is measured against.
        plan = enginePlan(fixture.models.main);
        batchPlan = enginePlan(fixture.models.batch);
    });

    test.afterAll(async () => {
        // ~200 rows to unwind through the gateway; the 30s hook default is not
        // enough and a timed-out teardown leaks the whole fixture into darwin_dev.
        test.setTimeout(300_000);
        if (fixture) await fixture.teardown();
    });

    // ── helpers ─────────────────────────────────────────────────────────────

    // useViewPreference reads sessionStorage FIRST and falls back to
    // localStorage, so a test that wants a specific mode has to write both —
    // setting only localStorage loses to a sessionStorage value an earlier
    // navigation in the same tab already wrote.
    //
    // PIPE-11 computes canvas click coordinates from `computePlanLayout`, so its
    // options must be the values the component is ACTUALLY rendering — a
    // mismatch moves every coordinate and produces silent click misses rather
    // than a legible failure. `PLAN_VIEW_OPTIONS` below is that single source.
    //
    // `req-layout` and `step-label` are NO LONGER PINNED: the user removed both
    // controls (2026-08-01), so the page ignores whatever those keys hold. A pin
    // that no longer influences the page is worse than no pin — it reads as a
    // guarantee the page has stopped honouring.
    //
    // `addInitScript` accumulates and re-runs in registration order on every
    // navigation, so re-registering only when the requested mode CHANGES keeps
    // the last writer correct without stacking a copy per goto.
    // `viz` defaults to the pair the coordinate maths needs, but is a PARAMETER
    // since req #3204: PipelineDetail.jsx defaults the two visualizer
    // preferences to `vertical` + `title`, so a suite that pins horizontal/id
    // everywhere never exercises the view a real user opens. That gap hid a
    // real defect — the epic fit clipped its outermost step title, worst in the
    // default pair — so PIPE-18 asks for the defaults explicitly.
    type Viz = { reqLayout: 'horizontal' | 'vertical'; stepLabel: 'id' | 'title' };
    const VIZ_COORDS: Viz = { reqLayout: 'horizontal', stepLabel: 'id' };
    const VIZ_PRODUCTION_DEFAULT: Viz = { reqLayout: 'vertical', stepLabel: 'title' };

    const lastMode = new WeakMap<Page, string>();
    async function pinPreferences(
        page: Page, mode: 'table' | 'plan', viz: Viz = VIZ_COORDS,
    ): Promise<void> {
        const key = `${mode}:${viz.reqLayout}:${viz.stepLabel}`;
        if (lastMode.get(page) === key) return;
        lastMode.set(page, key);
        await page.addInitScript(([m, rl, sl]) => {
            const set = (k: string, v: string) => {
                sessionStorage.setItem(k, v);
                localStorage.setItem(k, v);
            };
            set('darwin-swarm-pipeline-detail-mode', m);
            // INERT for the visualizer since req #3168 removed the `Reqs:` and
            // `Step:` controls — the page no longer reads either key. Still
            // written so the `Viz` parameter keeps its meaning for any caller
            // that has not been re-pointed, and so a stale value from an older
            // session cannot be mistaken for the cause of a failure.
            set('darwin-pipeline-viz-req-layout', rl);
            set('darwin-pipeline-viz-step-label', sl);
            // Req #3168 — column width IS still a live preference, and it scales
            // every column, so it belongs in the pin: PIPE-11's coordinates are
            // computed from a layout, and a stale storage value would silently
            // move every one of them.
            set('darwin-pipeline-viz-step-width', 'compact');
            // Req #3168 — the colour key is TRI-STATE ('state' | 'machine' |
            // 'none'). Pinned to the default so PIPE-15's gesture starts from a
            // known position and no other test inherits a previous one.
            set('darwin-pipeline-viz-color-key', 'state');
        }, [mode, viz.reqLayout, viz.stepLabel] as const);
    }

    /** Open a plan's detail page in Table mode and wait for the table to paint. */
    async function openPlanTable(page: Page, pipelineId: number): Promise<void> {
        await pinPreferences(page, 'table');
        await page.goto(`/swarm/pipeline/${pipelineId}`);
        await expect(page.getByTestId('pipeline-plan-table')).toBeVisible({ timeout: 30000 });
    }

    /**
     * Open a plan's detail page in Plan (visualizer) mode.
     *
     * Returns the <canvas> locator, not the container: the Konva stage is sized
     * to the container's CONTENT box, so the canvas's own rect is the exact
     * world-to-screen frame the click-target maths in PIPE-11 needs. A one-pixel
     * border offset is a miss when a bead's hit radius is ~5 screen px.
     */
    async function openPlanVisualizer(
        page: Page, pipelineId: number, viz: Viz = VIZ_COORDS,
    ): Promise<Locator> {
        await pinPreferences(page, 'plan', viz);
        await page.goto(`/swarm/pipeline/${pipelineId}`);
        await expect(page.getByTestId('pipeline-plan-visualizer'))
            .toBeVisible({ timeout: 30000 });
        // The Stage only mounts once the ResizeObserver has reported a width.
        const canvas = page.getByTestId('pipeline-plan-visualizer').locator('canvas').first();
        await expect(canvas).toBeVisible({ timeout: 15000 });
        return canvas;
    }

    /** Step-row ids in RENDERED order (banner rows carry no step testid). */
    async function renderedStepIds(page: Page): Promise<number[]> {
        return page.evaluate(() => Array.from(
            document.querySelectorAll('[data-testid^="pipeline-step-row-"]'),
        ).map((el) => Number(el.getAttribute('data-testid')!.replace('pipeline-step-row-', ''))));
    }

    // ── PIPE-01: the list page ──────────────────────────────────────────────

    test('PIPE-01: cards|table switch renders, persists, and a row opens the plan',
        async ({ page }) => {
            await page.goto('/swarm/pipelines');
            await expect(page.getByTestId('pipelines-view-toggle')).toBeVisible({ timeout: 30000 });

            // Cards is the default view.
            await page.getByTestId('view-toggle-cards').click();
            await expect(page.getByTestId('pipelines-cards-view')).toBeVisible();
            await expect(page.getByTestId(`pipeline-card-${fixture.mainPipelineId}`))
                .toBeVisible();

            // The accounting line counts the WHOLE dataset (view-switchable-pages
            // V7). Asserted with the exact figure, not just the word "pipeline":
            // it is also the guard that the stale sweep worked, and therefore that
            // the DataGrid row targeted below is on page 1 of an `id: desc` sort.
            //
            // The call-to-action names the ACTIVE view's click target (req #3119):
            // "click a row" is wrong advice in Cards, where the target is a card.
            await expect(page.getByTestId('pipelines-accounting'))
                .toHaveText('3 of 3 pipelines — click a card for the plan');

            await page.getByTestId('view-toggle-table').click();
            await expect(page.getByTestId('pipelines-datagrid')).toBeVisible();

            // ...and it flips with the view. Asserted on BOTH sides because a
            // one-sided check passes just as well on a hardcoded noun.
            await expect(page.getByTestId('pipelines-accounting'))
                .toHaveText('3 of 3 pipelines — click a row for the plan');

            // useViewPreference persists the choice across a reload.
            await page.reload();
            await expect(page.getByTestId('pipelines-datagrid')).toBeVisible({ timeout: 30000 });
            await expect(page.getByTestId('view-toggle-table'))
                .toHaveAttribute('aria-pressed', 'true');

            // Row click → detail.
            await page.locator(`.MuiDataGrid-row[data-id="${fixture.mainPipelineId}"]`).click();
            await expect(page).toHaveURL(new RegExp(`/swarm/pipeline/${fixture.mainPipelineId}$`));
            await expect(page.getByTestId('pipeline-detail')).toBeVisible({ timeout: 30000 });
        });

    // ── PIPE-02: the load-bearing order assertion ───────────────────────────

    test('PIPE-02: rendered step order is EXACTLY the engine displayOrder, and clean',
        async ({ page }) => {
            // The engine's self-check must pass on the fixture before the page is
            // asked to match it — otherwise a green comparison would only mean
            // "the page renders the same bad order".
            expect(plan.violations, 'engine invariants on the seeded fixture').toEqual([]);
            expect(plan.cycleDetected).toBe(false);
            expect(plan.duplicateStepIds).toEqual([]);
            expect(plan.unresolvedReqIds).toEqual([]);
            expect(plan.rows).toHaveLength(fixture.models.main.steps.length);

            await openPlanTable(page, fixture.mainPipelineId);

            const rendered = await renderedStepIds(page);
            expect(rendered).toEqual(plan.rows.map((r) => r.id));

            // No violation banner on a healthy plan — the negative half of
            // design rule 3, whose positive half is PIPE-12.
            await expect(page.getByTestId('pipeline-order-violations')).toHaveCount(0);
        });

    // ── PIPE-03: state chips, epic/feature groups, machine column ───────────

    test('PIPE-03: state chips, contiguous epic/feature groups and machine labels',
        async ({ page }) => {
            await openPlanTable(page, fixture.mainPipelineId);

            const LABEL = { done: 'Complete', running: 'Running', pending: 'Scheduled' };

            // Every row's chip reads its DERIVED state (design rule 1) — nothing
            // in the schema stores it.
            for (const row of plan.rows) {
                await expect(page.getByTestId(`pipeline-state-chip-${row.id}`))
                    .toHaveText(LABEL[row.state as keyof typeof LABEL]);
            }
            expect(new Set(plan.rows.map((r) => r.state)).size,
                'the fixture must exercise more than one state').toBeGreaterThan(1);

            // Epic/Feature render ONCE per contiguous group: the first row of a
            // group carries the label, the rest carry an empty cell. Compared
            // against the ids the engine derived, never against display strings.
            let prevEpic: number | null | undefined;
            let prevFeature: number | null | undefined;
            for (const row of plan.rows) {
                const epicId = row.epicId ?? null;
                const featureId = row.featureId ?? null;
                const epicCell = page.getByTestId(`pipeline-epic-${row.id}`);
                const featureCell = page.getByTestId(`pipeline-feature-${row.id}`);
                await expect(epicCell).toHaveText(
                    epicId !== prevEpic ? (row.epic || '—') : '');
                await expect(featureCell).toHaveText(
                    featureId !== prevFeature ? (row.feature || '—') : '');
                prevEpic = epicId;
                prevFeature = featureId;
            }

            // Machine column: multi-machine steps join with ' / ', a step with no
            // requirements reads an em-dash.
            // Machine column: every row prints the label the engine derived from
            // its requirements' machine_fk, and a step with NO requirements
            // prints an em-dash. The fixture pins two distinct machines (the WSL
            // side-track really ran on machine 3), so this is not one label
            // repeated 34 times.
            const reqless = plan.rows.find((r) => !r.reqIds.length);
            expect(reqless, 'the fixture has a req-less step (step 7)').toBeTruthy();
            await expect(page.getByTestId(`pipeline-machine-${reqless!.id}`)).toHaveText('—');

            const distinct = new Set(plan.rows.flatMap((r) => r.machineLabels || []));
            expect(distinct.size, 'the fixture spans more than one machine')
                .toBeGreaterThan(1);
            // Against the MACHINE CELL specifically. A whole-row `toContainText`
            // would also be satisfied by the em-dash in the Requirement(s) or
            // Depends-on cells, which makes the req-less case unfalsifiable.
            for (const row of plan.rows) {
                await expect(page.getByTestId(`pipeline-machine-${row.id}`))
                    .toHaveText(rowMachineLabel(row));
            }
        });

    // ── PIPE-04: launch-batch banner + the exact /swarm-start ───────────────

    test('PIPE-04: the launch-batch banner carries the exact /swarm-start argument list',
        async ({ page }) => {
            await openPlanTable(page, fixture.batchPipelineId);

            const banner = page.getByTestId('pipeline-batch-banner-A');
            await expect(banner).toBeVisible();
            await expect(banner).toContainText('LAUNCH BATCH A');

            // Design rule 8: the launch unit is EXPLICIT — the exact command,
            // not an implication of adjacency. Requirement ids in display order.
            const command = page.getByTestId('pipeline-batch-command-A');
            await expect(command).toHaveText(
                `/swarm-start ${fixture.batchRequirementIds.join(' ')}`);

            // The banner sits immediately above its first member.
            const order = await page.evaluate(() => Array.from(
                document.querySelectorAll(
                    '[data-testid^="pipeline-step-row-"], [data-testid^="pipeline-batch-banner-"]'),
            ).map((el) => el.getAttribute('data-testid')!));
            const bannerAt = order.indexOf('pipeline-batch-banner-A');
            expect(bannerAt).toBeGreaterThanOrEqual(0);
            expect(order[bannerAt + 1]).toMatch(/^pipeline-step-row-/);

            // The wall-clock half of the gate renders through the SAME formatter
            // the Depends-on cell uses — the banner once shipped the raw UTC wire
            // value while the row eight lines below showed a localized one.
            await expect(banner).toContainText('after ');
            const firstMember = batchPlan.rows.find((r) => r.state === 'pending')!;
            await expect(page.getByTestId(`pipeline-deps-${firstMember.id}`))
                .toContainText('after ');

            // The legend key renders only when a batch exists (POC polish
            // directive, kept in the product).
            await expect(page.getByTestId('pipeline-batch-legend')).toBeVisible();

            // Design rule 2: co-gated steps are PROPOSED for condensation into one
            // multi-requirement step — a suggestion the page surfaces, never an
            // automatic edit (plan mutations belong to the Primary AI).
            expect(batchPlan.proposals).toHaveLength(1);
            const proposal = page.getByTestId('pipeline-condensation-proposals');
            await expect(proposal).toBeVisible();
            await expect(proposal).toContainText('condensed');
        });

    test('PIPE-04b: no banner and NO legend key on a plan without a launch batch',
        async ({ page }) => {
            // Precondition, asserted rather than assumed: the Substrate fixture's
            // co-gated pending steps differ in run mode or machine, so the engine
            // finds no batch. If a future fixture edit grows one, this fails here
            // — visibly — instead of silently voiding the negative case.
            expect(plan.batches, 'the Substrate fixture has no launch batch').toEqual([]);

            await openPlanTable(page, fixture.mainPipelineId);
            await expect(page.locator('[data-testid^="pipeline-batch-banner-"]')).toHaveCount(0);
            await expect(page.getByTestId('pipeline-batch-legend')).toHaveCount(0);
        });

    // ── PIPE-05: the cost toggle ───────────────────────────────────────────

    test('PIPE-05: the Time / Tokens toggle reveals a Cost cell on every row',
        async ({ page }) => {
            await openPlanTable(page, fixture.mainPipelineId);

            // Hidden by default (the POC shipped `<body class="hidecost">`).
            await expect(page.locator('td[data-testid^="pipeline-cost-"]')).toHaveCount(0);

            await page.getByTestId('pipeline-cost-toggle').click();
            await expect(page.getByTestId(`pipeline-cost-${plan.rows[0].id}`)).toBeVisible();
            await expect(page.locator('td[data-testid^="pipeline-cost-"]'))
                .toHaveCount(plan.rows.length);

            // Freshly seeded requirements have no sessions, so every cell is
            // fmtCost's em-dash. The assertion is deliberately the WEAKER "a dash
            // or a real figure": these tests must not fail the day the cost
            // rollup starts returning numbers for seeded data.
            for (const row of plan.rows.slice(0, 5)) {
                await expect(page.getByTestId(`pipeline-cost-${row.id}`))
                    .toHaveText(/^(—|\d+h \d+m|\d+m)/);
            }

            // The cost READ failing must not masquerade as "no cost recorded".
            await expect(page.getByTestId('pipeline-cost-error')).toHaveCount(0);
        });

    // ── PIPE-06: requirement links ─────────────────────────────────────────

    test('PIPE-06: a requirement id links to its own detail page', async ({ page }) => {
        await openPlanTable(page, fixture.mainPipelineId);

        const withReq = plan.rows.find((r) => r.reqIds.length > 0)!;
        const reqId = withReq.reqIds[0];
        const link = page.getByTestId(`pipeline-req-link-${reqId}`);
        await expect(link).toBeVisible();
        await expect(link).toHaveText(String(reqId));   // no '#'

        await link.click();
        await expect(page).toHaveURL(new RegExp(`/swarm/requirement/${reqId}$`));
    });

    // ── PIPE-07: the NO-'#' audit ──────────────────────────────────────────

    test("PIPE-07: no generated '#<digits>' label on either view", async ({ page }) => {
        // SCOPE, per pipelineViewModel.js § The no-'#' directive: the rule governs
        // labels the UI GENERATES — step ids, requirement links, machine labels,
        // gates, batch text, chips. It does NOT govern the plan's own stored
        // prose, and the fixture proves the distinction: step 22's title really
        // contains "#3077 R13". Rewriting stored content at render time would be
        // falsifying the user's record to satisfy a styling rule. So the sweep
        // excludes the prose column and the goal paragraph, and NOTHING else.
        const sweep = async (): Promise<string[]> => page.evaluate(() => {
            const root = document.querySelector('[data-testid="pipeline-detail"]');
            if (!root) return ['NO PIPELINE DETAIL ROOT'];
            const clone = root.cloneNode(true) as HTMLElement;
            // Stored plan content: the goal paragraph, the "What this step does"
            // column (always the second-to-last cell) and its notes line, and —
            // since req #3119 gave it its own column — the step NAME, which is
            // the plan's own `title` string and just as much stored prose as the
            // description it used to share a cell with.
            //
            // The goal strip is BELT-AND-BRACES since req #3179: the description
            // moved into a Dialog behind the header's info button, so it is both
            // outside this root (a Dialog is a portal into document.body) and
            // unmounted while shut. The line stays because the exclusion is about
            // WHAT the text is, not where it currently renders — a future inline
            // preview of the goal must not silently start failing this sweep.
            clone.querySelectorAll('[data-testid="pipeline-goal"]').forEach((n) => n.remove());
            clone.querySelectorAll('[data-testid^="pipeline-notes-"]').forEach((n) => n.remove());
            clone.querySelectorAll('[data-testid^="pipeline-name-"]').forEach((n) => n.remove());
            clone.querySelectorAll('tr').forEach((tr) => {
                const cells = tr.querySelectorAll('td');
                if (cells.length > 1) cells[cells.length - 2].remove();
            });
            const text = clone.textContent || '';
            return text.match(/#\d+/g) || [];
        });

        await openPlanTable(page, fixture.mainPipelineId);
        // A sweep over nothing returns [] too. Prove there is something to sweep
        // before believing the absence of a match.
        expect(await renderedStepIds(page), 'the table must have rows to sweep')
            .toHaveLength(plan.rows.length);
        expect(await sweep(), 'table view').toEqual([]);

        // Cost column on as well — it is another generated surface.
        await page.getByTestId('pipeline-cost-toggle').click();
        await expect(page.getByTestId(`pipeline-cost-${plan.rows[0].id}`)).toBeVisible();
        expect(await sweep(), 'table view with cost').toEqual([]);

        // The visualizer draws its labels into a <canvas>, so a DOM sweep cannot
        // see them; what IS in the DOM there is the toolbar, the legend and the
        // zoom chip. Sweep those, and rely on the engine-level guarantee for the
        // canvas: rowMachineLabel/batchMachineLabel strip the one generated '#'
        // the engine can emit, and pipelinePlanLayout builds every other label
        // from bare ids.
        await openPlanVisualizer(page, fixture.mainPipelineId);
        expect(await sweep(), 'plan visualizer chrome').toEqual([]);

        const layout = computePlanLayout(plan.rows, plan.batches,
            { reqLayout: 'horizontal', stepLabel: 'id' });
        type VizLabel = { kind: string; text: string; prose?: boolean };
        const labels = layout.labels as VizLabel[];

        // Same scope split as the DOM sweep, keyed on the label's OWN `prose`
        // flag rather than on its kind (req #3168). It used to filter
        // `kind !== 'title'`, which worked only while "stored content" and "the
        // per-step detail line" were the same set. Since a requirement mark can
        // now be EITHER a generated id or the requirement's stored NAME, kind no
        // longer decides it — so the layout module states which it is, and this
        // sweep reads that instead of inferring it.
        const generated = labels.filter((l) => !l.prose)
            .map((l) => l.text).join(' ');
        expect(generated.match(/#\d+/g), 'generated canvas labels').toBeNull();

        // And the exclusion is EVIDENCED, not assumed: the fixture really does
        // carry a '#' inside stored prose (step 22's title names "#3077 R13"), so
        // a sweep that covered it would fail on content it must not rewrite.
        const prose = labels.filter((l) => l.prose).map((l) => l.text).join(' ');
        expect(prose, 'the fixture exercises the prose exclusion').toMatch(/#\d/);
    });

    // ── PIPE-08 / 09 / 10 / 11: the Plan visualizer ────────────────────────

    test('PIPE-08: the visualizer mounts, drags, and shows no horizontal scrollbar',
        async ({ page }) => {
            // The BATCH plan, not the Substrate one: it has no running step, so
            // no bead is pulsing and a pixel diff can only come from the pan.
            const canvas = await openPlanVisualizer(page, fixture.batchPipelineId);

            // The transform is read from `data-transform`, NOT inferred from a
            // pixel diff. Hovering a bead pops the datacard, which changes pixels
            // on its own — so a screenshot comparison would go green even if
            // d3-zoom swallowed the gesture and nothing panned.
            const container = page.getByTestId('pipeline-plan-visualizer');
            const before = await container.getAttribute('data-transform');
            expect(before, 'the visualizer publishes its world transform').toBeTruthy();

            const box = (await canvas.boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 - 60,
                { steps: 12 });
            await page.mouse.up();
            await expect(container).not.toHaveAttribute('data-transform', before!);

            // And it moved by a PAN, not a zoom: x and y change, k does not.
            const after = (await container.getAttribute('data-transform'))!;
            const [bx, by, bk] = before!.split(',').map(Number);
            const [ax, ay, ak] = after.split(',').map(Number);
            expect(ak, 'a drag must not change the scale').toBeCloseTo(bk, 3);
            expect(Math.hypot(ax - bx, ay - by),
                'the world must translate by roughly the drag distance')
                .toBeGreaterThan(50);

            // Production directive: NO visible horizontal scrollbar. The canvas
            // container clips, and the page itself must not overflow either.
            const overflow = await page.evaluate(() => {
                const el = document.querySelector(
                    '[data-testid="pipeline-plan-visualizer"]') as HTMLElement;
                return {
                    container: el.scrollWidth - el.clientWidth,
                    containerOverflowX: getComputedStyle(el).overflowX,
                    document: document.documentElement.scrollWidth
                        - document.documentElement.clientWidth,
                };
            });
            expect(overflow.containerOverflowX).toBe('hidden');
            expect(overflow.container).toBeLessThanOrEqual(0);
            expect(overflow.document).toBeLessThanOrEqual(0);

            // Req #3156: the canvas must BLEED to the same edges as
            // `pipeline-detail` — the negative `mx`/`mb` margins on the
            // container (PipelinePlanVisualizer.jsx) cancel PipelineDetail's
            // ancestor `p: 3` so the visualizer uses the full available space,
            // matching the swarm/requirements visualizer instead of sitting in
            // a padded, visibly boxed rectangle. A future edit that changes
            // either side's spacing token without the other breaks this.
            const detailBox = (await page.getByTestId('pipeline-detail').boundingBox())!;
            const vizBox = (await container.boundingBox())!;
            expect(vizBox.x, 'canvas left edge matches the page container'
                + ' left edge (no left gutter)').toBeCloseTo(detailBox.x, 0);
            expect(vizBox.x + vizBox.width,
                'canvas right edge matches the page container right edge'
                + ' (no right gutter)')
                .toBeCloseTo(detailBox.x + detailBox.width, 0);
            expect(vizBox.y + vizBox.height,
                'canvas bottom edge matches the page container bottom edge'
                + ' (no trailing dead space / page scrollbar)')
                .toBeCloseTo(detailBox.y + detailBox.height, 0);
        });

    test('PIPE-09: zoom crosses all three semantic levels and redraws each time',
        async ({ page }) => {
            const canvas = await openPlanVisualizer(page, fixture.batchPipelineId);
            const container = page.getByTestId('pipeline-plan-visualizer');
            const scale = async () =>
                Number((await container.getAttribute('data-transform'))!.split(',')[2]);
            const box = (await canvas.boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

            // Fit-to-width is ratio 1 → 'mid' (konvaSwarmModel's semanticLevel,
            // the same ladder the swarm canvas uses). `data-level` is what the
            // bottom-right status chip used to say in words before it was
            // deleted outright (req #3216 D2) — the canvas still publishes the
            // fact, just not as a permanent caption over the plan.
            await expect(container).toHaveAttribute('data-level', 'mid');
            const kMid = await scale();
            const atMid = await canvas.screenshot();

            // ratio < 0.5 → 'out'. d3-zoom's wheel factor is 2^(-deltaY/500),
            // so +800 more than halves; scaleExtent clamps at ratio 0.25.
            for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 800);
            await expect(container).toHaveAttribute('data-level', 'out');
            const kOut = await scale();
            expect(kOut).toBeLessThan(kMid);
            const atOut = await canvas.screenshot();
            expect(Buffer.compare(atMid, atOut), 'the canvas redraws at the new level')
                .not.toBe(0);

            // ratio >= 1.9 → 'in'; clamps at 8.
            for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -800);
            await expect(container).toHaveAttribute('data-level', 'in');
            const kIn = await scale();
            expect(kIn).toBeGreaterThan(kMid);
            const atIn = await canvas.screenshot();
            expect(Buffer.compare(atOut, atIn)).not.toBe(0);

            // "with detail changes": the level does not merely relabel a chip —
            // it changes WHAT IS DRAWN. Per-step title lines are the slot that
            // opens at 'in' and at no other level, so their presence in the
            // layout is the detail the ladder gates.
            const layout = computePlanLayout(batchPlan.rows, batchPlan.batches,
                { reqLayout: 'horizontal', stepLabel: 'id' });
            const kinds = new Set(layout.labels.map((l: { kind: string }) => l.kind));
            expect(kinds.has('title'), "the 'in' level has title labels to reveal").toBe(true);
            expect(kinds.has('step'), "the 'out' level has step labels to suppress").toBe(true);
        });

    test('PIPE-10: the dashed batch box is drawn only on a plan that has a batch',
        async ({ page }) => {
            // RE-ANCHORED (req #3168). The box is canvas geometry, so this test
            // used to prove it through the visualizer legend's conditional batch
            // KEY — the only thing in the DOM that tracked it. The user directive
            // stripping the key back to step marks + the requirement scale
            // removed that proxy, so the component now publishes what it actually
            // drew: `data-batch-boxes`, the same device and the same reasoning as
            // `data-transform` beside it.
            //
            // This is STRICTLY BETTER evidence than the legend key was. The key
            // was a second thing derived from the same flag, so a bug between the
            // flag and the drawn rect was invisible to it; the count is the
            // length of the array the canvas iterates to draw the boxes.
            const batchLayout = computePlanLayout(batchPlan.rows, batchPlan.batches,
                { reqLayout: 'horizontal', stepLabel: 'id' });
            expect(batchPlan.batches).toHaveLength(1);
            expect(batchLayout.batchBoxes).toHaveLength(1);
            expect(batchLayout.batchBoxes[0].letter).toBe('A');

            await openPlanVisualizer(page, fixture.batchPipelineId);
            await expect(page.getByTestId('pipeline-plan-visualizer'))
                .toHaveAttribute('data-batch-boxes', '1');

            const mainLayout = computePlanLayout(plan.rows, plan.batches,
                { reqLayout: 'horizontal', stepLabel: 'id' });
            expect(mainLayout.batchBoxes).toEqual([]);

            await openPlanVisualizer(page, fixture.mainPipelineId);
            await expect(page.getByTestId('pipeline-plan-visualizer'))
                .toHaveAttribute('data-batch-boxes', '0');

            // The TABLE view's batch legend is untouched by the directive and
            // still carries the conditional key — asserted in PIPE-04/04b. The
            // two surfaces are checked separately on purpose: they are different
            // renderings of one plan and a shared assertion would hide a
            // regression in either.
        });

    test('PIPE-10b: the time ruler draws a tick per slot, thinning labels not overlapping them',
        async ({ page }) => {
            // Req #3207. Same device and same reasoning as `data-batch-boxes`
            // above: the ruler is canvas geometry, so the DOM carries what the
            // canvas actually drew rather than a second thing derived from the
            // same flag.
            //
            // TWO numbers, because the DEGRADATION rule is the half a screenshot
            // cannot check. A pixel diff cannot tell a ruler that thinned three
            // dates away from a plan that simply had three fewer days; `slots`
            // against `labelled` can, and their being EQUAL here is itself the
            // assertion — these fixtures are short enough that nothing should
            // thin, so a labelled count below the slot count would mean the pass
            // is firing where there is room.
            for (const pipelineId of [fixture.batchPipelineId, fixture.mainPipelineId]) {
                const p = pipelineId === fixture.batchPipelineId ? batchPlan : plan;
                const L = computePlanLayout(p.rows, p.batches,
                    { ...PLAN_VIEW_OPTIONS, timeAxis: p.timeAxis || null });
                expect(L.ruler.slots.length).toBeGreaterThan(0);
                const labelled = L.ruler.slots.filter(
                    (s: { showLabel: boolean }) => s.showLabel).length;

                await openPlanVisualizer(page, pipelineId);
                await expect(page.getByTestId('pipeline-plan-visualizer'))
                    .toHaveAttribute('data-ruler', `${L.ruler.slots.length},${labelled}`);
            }
        });

    test('PIPE-11: bead, requirement and epic click targets navigate', async ({ page }) => {
        // The BATCH plan, on purpose. Canvas hit targets are world-space and the
        // stage is fit to width, so the screen-space tolerance is
        // (radius)·containerWidth/layout.width — on a four-step plan that is tens
        // of pixels, on the 34-step plan it is a handful. This test is about the
        // click TARGETS existing and routing, not about the layout's density.
        const layout = computePlanLayout(batchPlan.rows, batchPlan.batches,
            // `timeAxis` is part of the geometry since req #3201 — the page
            // passes `plan.timeAxis`, and a layout computed without it puts the
            // columns somewhere else, so every derived click coordinate misses.
            { ...PLAN_VIEW_OPTIONS, timeAxis: batchPlan.timeAxis || null });

        // The world-to-screen frame is READ from `data-transform`, not derived
        // from the canvas width (req #3168). It used to be `k = width / world`,
        // which was only true while the default view was fit-to-width; the
        // default is now `max(fit, K_READABLE)`, so on a narrow panel the
        // component legitimately starts zoomed in and every derived coordinate
        // would miss its target by a growing margin. The attribute is the
        // component's own answer and cannot disagree with what it drew.
        const frame = async () => {
            const canvas = await openPlanVisualizer(page, fixture.batchPipelineId);
            const box = (await canvas.boundingBox())!;
            const container = page.getByTestId('pipeline-plan-visualizer');
            const [tx, ty, k] = (await container.getAttribute('data-transform'))!
                .split(',').map(Number);
            return (x: number, y: number) =>
                ({ x: box.x + tx + x * k, y: box.y + ty + y * k });
        };

        // Bead → Table mode, scrolled to and highlighting that row.
        let at = await frame();
        const target = batchPlan.rows[0];
        const node = layout.nodes.get(target.id) as { x: number; y: number };
        expect(node, 'every plan row has a bead').toBeTruthy();
        const beadPt = at(node.x, node.y);
        await page.mouse.click(beadPt.x, beadPt.y);
        await expect(page.getByTestId('pipeline-plan-table')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId(`pipeline-step-row-${target.id}`))
            .toHaveAttribute('data-focused', 'true');

        // Requirement label → /swarm/requirement/:id.
        at = await frame();
        const reqLabel = layout.labels.find(
            (l: { kind: string }) => l.kind === 'req') as
            { x: number; y: number; reqId: number; text: string };
        expect(reqLabel, 'the plan renders requirement labels').toBeTruthy();
        const reqPt = at(reqLabel.x + 3, reqLabel.y + 3);
        await page.mouse.click(reqPt.x, reqPt.y);
        await expect(page).toHaveURL(new RegExp(`/swarm/requirement/${reqLabel.reqId}$`),
            { timeout: 15000 });

        // Epic band label → the features view filtered to that epic. Since
        // req #3204 the chip's NAME focuses the band (PIPE-14) and this
        // navigation — the req #3119 production directive — lives on the chip's
        // own ↗ control. It moved; it did not disappear, and it is a visible
        // control rather than a modifier-key secret.
        //
        // Located by testid rather than by canvas coordinates: the ↗ is an HTML
        // node, so there is no world-to-screen conversion to get wrong.
        await openPlanVisualizer(page, fixture.batchPipelineId);
        const epicBand = layout.bands.find(
            (b: { epicId: number | null }) => b.epicId != null) as { epicId: number };
        expect(epicBand, 'the plan renders epic bands').toBeTruthy();
        const openEpic = page.getByTestId(`pipeline-viz-epic-open-${epicBand.epicId}`);
        await expect(openEpic).toBeVisible({ timeout: 15000 });
        await openEpic.click();
        await expect(page).toHaveURL(new RegExp(`/swarm/features\\?epic=${epicBand.epicId}$`),
            { timeout: 15000 });
    });

    // ── PIPE-14: epic focus (req #3204) ────────────────────────────────────

    test('PIPE-14: clicking an epic name fits that epic, and enters no mode',
        async ({ page }) => {
            // The MAIN plan: four epic bands, one of them spanning non-contiguous
            // columns, so the fit rectangle is a real one rather than the whole
            // world by coincidence.
            //
            // In the PRODUCTION DEFAULT view (vertical + title), not the
            // horizontal/id pair the rest of this file pins. Title mode is where
            // step labels are longest and where they overflow their own columns
            // furthest, so it is the mode that actually tests "with margin on
            // all four sides". The first cut of this feature passed every other
            // mode and clipped in this one.
            const viz = VIZ_PRODUCTION_DEFAULT;
            // The page renders with the WHOLE option set the merge produced:
            // req #3201's time axis AND req #3168's width / label choices. A
            // layout computed from `viz` alone puts the bands at different y,
            // so the focus rectangle this test derives is for a plan the
            // component is not drawing.
            const layout = computePlanLayout(plan.rows, plan.batches,
                { ...PLAN_VIEW_OPTIONS, ...viz, timeAxis: plan.timeAxis || null });
            const canvas = await openPlanVisualizer(page, fixture.mainPipelineId, viz);
            const container = page.getByTestId('pipeline-plan-visualizer');
            const read = async () =>
                (await container.getAttribute('data-transform'))!.split(',').map(Number);
            // The focus is a 420ms ANIMATION, so "has it arrived" is not a
            // single read. Polling on the target value alone is not enough
            // either: any finite tolerance can be satisfied a frame or two
            // early, and the next gesture then interrupts the transition at a
            // slightly later interpolation point — which reads as a drag that
            // changed the scale. Wait for the transform to stop moving.
            const settle = async () => {
                let prev = '';
                await expect.poll(async () => {
                    const cur = (await container.getAttribute('data-transform'))!;
                    const unchanged = cur === prev;
                    prev = cur;
                    return unchanged;
                }, { timeout: 10000, intervals: [100] }).toBe(true);
            };

            // The component's own viewport, as the ResizeObserver rounds it.
            const box = (await canvas.boundingBox())!;
            const size = { w: Math.round(box.width), h: Math.round(box.height) };
            // THE OPENING SCALE IS `max(fit, K_READABLE)`, not fit-to-width.
            // This test was written against the fit default and req #3168's
            // "Default size = readable" replaced it: fit is a scale divided by
            // plan size, so the bigger the plan the smaller the type, and the
            // live plan opened illegible. The focus clamp reads the SAME anchor
            // the zoom extent does (`kDefault`), so the value below is what
            // `epicFocusTransform` must be handed — passing the fit scale here
            // would test a camera the component never uses.
            const kFit = size.w / layout.width;
            const kBase = Math.max(kFit, K_READABLE);

            const [, , k0] = await read();
            expect(k0, 'the plan opens at the readable default').toBeCloseTo(kBase, 2);

            // The band whose chip is on screen at the opening transform. The
            // floating chip hides itself when its band is off-screen, so this
            // picks a target rather than assuming band 0 is visible.
            let band: any = null;
            for (const b of layout.bands) {
                if (b.epicId == null) continue;
                if (await page.getByTestId(`pipeline-viz-epic-${b.key}`).count()) { band = b; break; }
            }
            expect(band, 'at least one epic chip is on screen at the default view').toBeTruthy();

            const want = epicFocusTransform(layout, band, size, kBase)!;
            expect(want, 'the band has a fit transform').toBeTruthy();

            // Click the NAME, not the ↗ beside it.
            await page.getByTestId(`pipeline-viz-epic-${band.key}`)
                .locator('.pipeline-viz-epic-name').click();

            await settle();
            const [fx, fy, fk] = await read();
            expect(fx, 'x').toBeCloseTo(want.x, -1);   // within 5px
            expect(fy, 'y').toBeCloseTo(want.y, -1);
            expect(fk, 'k').toBeCloseTo(want.k, 3);

            // The ceiling holds — "as close as possible" never means absurd.
            expect(fk).toBeLessThanOrEqual(kBase * FOCUS_MAX_RATIO + 1e-6);

            // Margin on ALL FOUR sides, measured from the transform the page
            // actually published against every mark the band DRAWS — beads and
            // labels, not the columns they nominally sit in. Since req #3119 a
            // step label is centred on its column and sized to a budget that
            // reaches 40% into each neighbour, so an outermost label draws
            // outside the column extent and a column-based assertion here would
            // pass while the user watches a title get cut off.
            const ids = new Set<number>(band.stepIds);
            let wl = Infinity;
            let wr = -Infinity;
            for (const id of ids) {
                const n = layout.nodes.get(id)!;
                wl = Math.min(wl, n.x - 10);      // BEAD_RADIUS
                wr = Math.max(wr, n.x + 10);
            }
            for (const l of layout.labels as Array<
                { stepId?: number; x: number; w?: number }>) {
                if (l.stepId == null || !ids.has(l.stepId)) continue;
                wl = Math.min(wl, l.x);
                wr = Math.max(wr, l.x + (l.w || 0));
            }
            const screen = {
                left: fx + wl * fk, right: fx + wr * fk,
                top: fy + band.y * fk, bottom: fy + (band.y + band.height) * fk,
            };
            const slack = 2;   // the published transform is rounded to 2 decimals
            expect(screen.left, 'left margin').toBeGreaterThanOrEqual(FOCUS_PAD - slack);
            expect(screen.top, 'top margin').toBeGreaterThanOrEqual(FOCUS_PAD - slack);
            expect(size.w - screen.right, 'right margin')
                .toBeGreaterThanOrEqual(FOCUS_PAD - slack);
            expect(size.h - screen.bottom, 'bottom margin')
                .toBeGreaterThanOrEqual(FOCUS_PAD - slack);

            // ── NOT A MODE ──────────────────────────────────────────────────
            // A drag immediately afterwards continues from the focused view
            // rather than snapping back to where d3-zoom last thought it was.
            // This is the assertion that the transform went through the BEHAVIOR
            // and not through React state alone: with a stale internal
            // transform, this drag would jump to (k0-based) coordinates.
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2 - 50,
                { steps: 10 });
            await page.mouse.up();
            const [dx, dy, dk] = await read();
            expect(dk, 'a drag after the focus must not change the scale')
                .toBeCloseTo(fk, 3);
            expect(dx - fx, 'the drag continues from the focused view, no snap-back')
                .toBeCloseTo(-90, -1);
            expect(dy - fy).toBeCloseTo(-50, -1);

            // Clicking the SAME epic again re-fits to the SAME transform. A
            // toggle would have un-zoomed here, and a stored "focused epic"
            // would have branched. There is nothing to un-zoom.
            await page.getByTestId(`pipeline-viz-epic-${band.key}`)
                .locator('.pipeline-viz-epic-name').click();
            await settle();
            const [ax, ay, ak] = await read();
            expect(ax, 'the second click lands on the same fit').toBeCloseTo(fx, -1);
            expect(ay).toBeCloseTo(fy, -1);
            expect(ak).toBeCloseTo(fk, 3);

            // A wheel zoom likewise continues from the focused scale rather than
            // from the fit-to-width one the page opened at.
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.wheel(0, -400);
            await expect.poll(async () => (await read())[2], { timeout: 5000 })
                .toBeGreaterThan(ak);

            // A click that lands DURING the 420ms transition must not hit-test
            // the moving world. Without the guard it resolves against a
            // half-interpolated transform and can hit a bead — which switches the
            // page to Table mode — or a requirement id, which navigates away.
            // No `waitFor` between the two clicks: that is the point.
            await openPlanVisualizer(page, fixture.mainPipelineId, viz);
            const url = page.url();
            await page.getByTestId(`pipeline-viz-epic-${band.key}`)
                .locator('.pipeline-viz-epic-name').click();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await expect(page.getByTestId('pipeline-plan-visualizer')).toBeVisible();
            await expect(page.getByTestId('pipeline-plan-table')).toHaveCount(0);
            expect(page.url(), 'a mid-transition click navigates nowhere').toBe(url);
        });

    // ── PIPE-12: the loud-failure path ─────────────────────────────────────

    test('PIPE-12: a corrupted plan raises the invariant banner on BOTH views',
        async ({ page }) => {
            // Design rule 3: a bad order must fail LOUDLY, never ship in silence.
            // The POC raised SystemExit; a web page renders the failure instead.
            await openPlanTable(page, fixture.cyclePipelineId);
            const banner = page.getByTestId('pipeline-order-violations');
            await expect(banner).toBeVisible();
            await expect(banner).toContainText('Plan order failed its own invariant checks');
            await expect(banner).toContainText('cycle');

            // It is not dismissible and it renders on the visualizer too — both
            // surfaces compute the same order and owe the same loudness.
            await expect(banner.locator('button')).toHaveCount(0);
            await openPlanVisualizer(page, fixture.cyclePipelineId);
            await expect(page.getByTestId('pipeline-order-violations')).toBeVisible();
        });

    // ── PIPE-13: the description is chrome-free (req #3179) ────────────────

    test('PIPE-13: the description lives behind the header button, not in the column',
        async ({ page }) => {
            // Req #3179 moved the plan's goal text out of the render column and
            // into a Dialog behind an info button at the right end of the title
            // row — the Telemetry page's Glossary affordance. Two claims, and the
            // second is the one the requirement was actually about: the prose is
            // still reachable AND it no longer charges the plan any viewport.
            //
            // Tall enough that `availH`'s 480px floor is never the binding
            // constraint on the canvas height, and wide enough to be a realistic
            // desktop. The header row is `nowrap` since req #3241 so it is one
            // line at every width, but every claim below is still written to be
            // WIDTH-INVARIANT — DOM containment and sibling order, never a
            // y-coordinate — because a test that only holds at one viewport is a
            // test about that viewport.
            await page.setViewportSize({ width: 1800, height: 1000 });
            const canvas = await openPlanVisualizer(page, fixture.mainPipelineId);

            // 1. Nothing in the page column. Not "hidden" — ABSENT: MUI unmounts a
            //    closed Dialog's children, so the field is not in the DOM at all.
            await expect(page.getByTestId('pipeline-goal')).toHaveCount(0);

            // 2. The button is IN the header row (not merely somewhere on the
            //    page) and it is the LAST thing in it.
            //
            //    ANCHORED ON DOM ORDER, not on a neighbour's box. The status and
            //    machine chips it used to be measured against were removed on the
            //    user's directive (2026-08-01), and a positional assertion
            //    against whatever happens to precede it would have to be rewritten
            //    every time that row changes — which it has, three times. "Last
            //    child of the header row" is the claim the requirement actually
            //    makes, and it is wrap-invariant for free.
            await expect(page.locator('[data-testid="pipeline-header-row"]'
                + ' [data-testid="pipeline-description-btn"]')).toHaveCount(1);
            const btn = page.getByTestId('pipeline-description-btn');
            await expect(btn).toBeVisible();
            const isLast = await page.evaluate(() => {
                const row = document.querySelector('[data-testid="pipeline-header-row"]')!;
                const b = row.querySelector('[data-testid="pipeline-description-btn"]')!;
                // The button is wrapped in a Tooltip, so compare against the
                // last ELEMENT child's subtree rather than the button itself.
                return row.lastElementChild!.contains(b);
            });
            expect(isLast, 'the description button is the last control on the row')
                .toBe(true);
            // And the removed chips are really gone, not merely unqueried.
            await expect(page.getByTestId('pipeline-status-chip')).toHaveCount(0);
            await expect(page.getByTestId('pipeline-machine-chip')).toHaveCount(0);

            // 3. It opens the goal, editable, with the seeded text.
            await btn.click();
            const dialog = page.getByTestId('pipeline-description-dialog');
            await expect(dialog).toBeVisible();
            const field = page.getByTestId('pipeline-goal').locator('textarea').first();
            await expect(field).toHaveValue(/eliminate the shared-clone corruption class/);

            // 4. And closing it puts the field back out of the DOM — a Dialog left
            //    mounted behind the plan would re-introduce exactly the DOM the
            //    requirement removed, even if it painted nothing.
            await dialog.getByRole('button', { name: 'Close' }).click();
            await expect(dialog).toHaveCount(0);
            await expect(page.getByTestId('pipeline-goal')).toHaveCount(0);

            // 5. THE POINT: the canvas starts immediately under the last row of
            //    chrome and runs to the bottom of the viewport. The gate is that
            //    row's own `mb: 1` (8px) plus slack — the ~90px description block
            //    this replaced could not fit inside it, so this is a real
            //    regression guard and not a tautology.
            //
            //    RE-ANCHORED BACK onto `pipeline-header-row` (user directive
            //    2026-08-01). Req #3168 briefly split the chrome into a pipeline
            //    bar and a view bar and this assertion moved to the lower one;
            //    the user rejected the split against production, so there is one
            //    row again and it is the one that touches the panel. The claim
            //    never changed — only which row has to satisfy it.
            //
            //    Both boxes are read AFTER the dialog has closed, never from a
            //    measurement taken before it opened: a modal that perturbed the
            //    layout would otherwise be compared against a stale header.
            const headerBox = (await page.getByTestId('pipeline-header-row')
                .boundingBox())!;
            const vizBox = (await page.getByTestId('pipeline-plan-visualizer')
                .boundingBox())!;
            expect(vizBox.y - (headerBox.y + headerBox.height),
                'no chrome between the view row and the canvas')
                .toBeLessThanOrEqual(16);
            expect(vizBox.y + vizBox.height,
                'the canvas runs to the bottom of the viewport')
                .toBeGreaterThan(page.viewportSize()!.height - 24);
            // The canvas the Konva stage actually paints is the same height — a
            // container that grew while the stage stayed small would satisfy the
            // checks above and still render a letterboxed plan. (The stage is
            // sized to the container's CONTENT box, so it is short by the 1px
            // border on each edge.)
            const canvasBox = (await canvas.boundingBox())!;
            expect(canvasBox.height, 'the Konva stage fills the container')
                .toBeCloseTo(vizBox.height, -1);
        });

    // ── PIPE-18: the polish pass (req #3168) ───────────────────────────────
    // Renumbered from PIPE-14 in the merge: req #3204 landed its own PIPE-14
    // (epic focus) on main first, and two tests sharing an id makes a failure
    // report ambiguous about which one broke.

    test('PIPE-18: ONE header row, the width control, the next-step readout and reset',
        async ({ page }) => {
            await page.setViewportSize({ width: 1800, height: 1000 });
            await openPlanVisualizer(page, fixture.mainPipelineId);

            // 1. ONE ROW (user directive 2026-08-01). Req #3168 split the chrome
            //    into a pipeline bar and a view bar; looked at against
            //    production it read as three rows of chrome before any plan, and
            //    the user rejected it. So the claims invert: there is no second
            //    row, and EVERYTHING lives on `pipeline-header-row` — mode
            //    switch first, description button last.
            //
            //    WIDTH-INVARIANT, like every other assertion about this row: DOM
            //    containment and sibling order say the same thing at every
            //    width, which a y-coordinate comparison would not. Since req
            //    #3241 the row is also literally one LINE at every width — that
            //    is asserted separately in 1b, by measurement, because it is now
            //    a requirement rather than an observation.
            const headerRow = page.getByTestId('pipeline-header-row');
            await expect(headerRow).toBeVisible();
            await expect(page.getByTestId('pipeline-view-row'),
                'the view row is gone, not hidden').toHaveCount(0);
            for (const id of ['pipeline-detail-mode-toggle', 'pipeline-title',
                'pipeline-viz-level-control', 'pipeline-viz-stepwidth-toggle',
                'pipeline-viz-colorkey-toggle', 'pipeline-viz-reset',
                'pipeline-description-btn']) {
                await expect(page.locator(`[data-testid="pipeline-header-row"]`
                    + ` [data-testid="${id}"]`), `${id} is on the one row`)
                    .toHaveCount(1);
            }
            // What the 2026-08-01 directives (and req #3216) took OFF this row
            // or off the canvas entirely, asserted as gone rather than merely
            // unlisted — an element that quietly came back would otherwise
            // re-crowd the row, or the canvas corner, with nothing to notice
            // it by. The `Reqs:` and `Step:` controls were removed outright;
            // the status chip (zoom level name, "pinned", the drag/scroll hint)
            // was DELETED, not moved — nowhere replaces it, by design (D2).
            for (const id of ['pipeline-viz-reqlayout-toggle',
                'pipeline-viz-steplabel-toggle', 'pipeline-status-chip',
                'pipeline-machine-chip', 'pipeline-viz-zoom-level']) {
                await expect(page.getByTestId(id), `${id} is gone`).toHaveCount(0);
            }
            // ── THE MOVE req #3214's TITLE PROMISED, delivered by req #3241 ──
            //    These two assertions are INVERTED from what they said before:
            //    the level selector was in the key, and the earlier work left it
            //    there. It is in the header now, LEFT OF WIDTH, and the key no
            //    longer carries it — asserted from both ends, because "present
            //    in the header" alone would also pass on a duplicate.
            await expect(page.locator('[data-testid="pipeline-viz-legend"]'
                + ' [data-testid="pipeline-viz-level-control"]'),
            'the level selector left the key').toHaveCount(0);
            await expect(page.getByTestId('pipeline-viz-level-control'),
                'there is exactly one level selector on the page').toHaveCount(1);
            const leftOfWidth = await page.evaluate(() => {
                const row = document.querySelector(
                    '[data-testid="pipeline-header-row"]')!;
                const kids = Array.from(row.children);
                const idx = (sel: string) =>
                    kids.findIndex((el) => el.matches(sel) || !!el.querySelector(sel));
                return {
                    level: idx('[data-testid="pipeline-viz-level-control"]'),
                    width: idx('[data-testid="pipeline-viz-stepwidth-toggle"]'),
                };
            });
            expect(leftOfWidth.level, 'the level selector is a child of the row')
                .toBeGreaterThanOrEqual(0);
            expect(leftOfWidth.level,
                'the level selector sits immediately LEFT of the Width control')
                .toBe(leftOfWidth.width - 1);
            // And the pan exemption really travelled with it: the key's own
            // `data-viz-chrome="level"` wrapper is gone, and the ONE remaining
            // exemption over the canvas is the key's collapse button. A stray
            // exemption left behind would silently make a dead region of the
            // canvas unpannable.
            const vizChrome = await page.evaluate(() => Array.from(
                document.querySelectorAll('[data-viz-chrome]'))
                .map((el) => el.getAttribute('data-viz-chrome')));
            expect(vizChrome, 'the collapse button is the only canvas chrome left')
                .toEqual(['legend']);
            // The accounting line is what LEFT the row to pay for the selector
            // (req #3241). It is not deleted — it is on the breadcrumb line
            // above, which already existed and had the width to spare. Asserted
            // from both ends for the same reason as the selector.
            await expect(page.locator('[data-testid="pipeline-header-row"]'
                + ' [data-testid="pipeline-accounting"]'),
            'the accounting line left the header row').toHaveCount(0);
            await expect(page.locator('[data-testid="pipeline-subheader-row"]'
                + ' [data-testid="pipeline-accounting"]'),
            'the accounting line is on the breadcrumb line').toHaveCount(1);
            await expect(page.getByTestId('pipeline-accounting'),
                'and it still says what it always said')
                .toContainText(/\d+ steps? — \d+ complete · \d+ running/);
            // Production's order at the two ends that the user reads by: the mode
            // switch opens the row and the description button closes it. Asserted
            // by DOM position among the row's own children, so a wrap cannot
            // change the answer.
            const ends = await page.evaluate(() => {
                const row = document.querySelector('[data-testid="pipeline-header-row"]')!;
                const ids = Array.from(row.children).map((el) => {
                    const own = (el as HTMLElement).dataset.testid;
                    if (own) return own;
                    const inner = el.querySelector('[data-testid]');
                    return inner ? inner.getAttribute('data-testid') : null;
                });
                return { first: ids[0], last: ids[ids.length - 1] };
            });
            expect(ends.first, 'the mode switch opens the row')
                .toBe('pipeline-detail-mode-toggle');
            expect(ends.last, 'the description button closes the row')
                .toBe('pipeline-description-btn');

            // 1b. ONE ROW IS NOW A PROPERTY, NOT AN OBSERVATION (req #3241).
            //     Before this it was a `flexWrap: 'wrap'` row measured to wrap
            //     below ~2180px, and every claim about it was written to be
            //     wrap-invariant so the suite passed on both sides of that
            //     threshold — which is another way of saying nothing asserted
            //     the thing the user asked for. It does now.
            //
            //     THE MEASUREMENT IS RATIO, NOT ABSOLUTE: a wrapped flex row is
            //     N line-boxes tall, so the row's own height against its tallest
            //     CHILD's height answers "how many lines?" exactly, at any
            //     viewport and under any future type-scale change. An absolute
            //     px bound would be a test about MUI's small-control height.
            const rowMetrics = async () => page.evaluate(() => {
                const row = document.querySelector(
                    '[data-testid="pipeline-header-row"]') as HTMLElement;
                const gap = parseFloat(getComputedStyle(row).gap) || 0;
                const kids = Array.from(row.children) as HTMLElement[];
                let content = 0;
                let n = 0;
                let tallest = 0;
                for (const k of kids) {
                    const r = k.getBoundingClientRect();
                    if (r.width < 0.5) continue;
                    n += 1;
                    tallest = Math.max(tallest, r.height);
                    // The flexGrow spacer absorbs slack and is not content.
                    if (!k.dataset.testid && !k.textContent?.trim()
                        && k.children.length === 0) continue;
                    content += r.width;
                }
                // THE ROW'S INCOMPRESSIBLE WIDTH: everything that declares
                // `flex-shrink: 0`, plus the gaps. This is the figure that
                // decides whether the page gains a horizontal scrollbar, and it
                // is INDEPENDENT of the fixture — whose plan title is a long
                // `e2e-<stamp>-…` string, i.e. a large elastic member that
                // would mask a too-wide control set at any viewport a sweep
                // happens to pick.
                const incompressible = kids
                    .filter((k) => k.getBoundingClientRect().width >= 0.5
                        && getComputedStyle(k).flexShrink === '0')
                    .reduce((sum, k) => sum + k.getBoundingClientRect().width, 0);
                return {
                    content: Math.round(content + gap * Math.max(0, n - 1)),
                    incompressible: Math.round(
                        incompressible + gap * Math.max(0, n - 1)),
                    chrome: Math.round(window.innerWidth
                        - row.getBoundingClientRect().width),
                    rowHeight: Math.round(row.getBoundingClientRect().height),
                    tallestChild: Math.round(tallest),
                    // The one elastic member. Its measured width vs. its own
                    // scrollWidth is what "it ellipsized" means.
                    titleClipped: (() => {
                        const t = row.querySelector(
                            '[data-testid="pipeline-title"]') as HTMLElement | null;
                        return t ? t.scrollWidth > t.clientWidth + 1 : false;
                    })(),
                    docOverflow: document.documentElement.scrollWidth
                        - document.documentElement.clientWidth,
                };
            });
            const at1800 = await rowMetrics();
            // eslint-disable-next-line no-console
            console.log(`[PIPE-18] header row @1800px: content=${at1800.content}px `
                + `incompressible=${at1800.incompressible}px `
                + `chrome=${at1800.chrome}px height=${at1800.rowHeight}px `
                + `(tallest child ${at1800.tallestChild}px) `
                + `→ page scrolls sideways below `
                + `~${at1800.incompressible + at1800.chrome}px viewport`);
            expect(at1800.rowHeight,
                'the header is ONE line at 1800px — not two, not three')
                .toBeLessThanOrEqual(at1800.tallestChild + 2);
            expect(at1800.titleClipped,
                'at 1800px there is room for the whole plan name').toBe(false);
            // THE BUDGET. `nowrap` converts what used to be a wrap into page
            // overflow, so the controls now have a width CEILING rather than a
            // soft cost — and this is the number that expresses it. 780px is the
            // row's own width at a 1024px viewport with the sidebar expanded
            // (1024 − 180 sidebar − 48 padding − 16 scrollbar), so holding under
            // it is what makes "one row, no sideways scroll" true across the
            // whole desktop range this page is used at. Measured 763px today;
            // a new control on this row that breaks the promise fails HERE,
            // with the arithmetic in front of whoever added it, instead of
            // silently on somebody's 1152px window.
            //
            // IT EXCLUDES THE ORCHESTRATION CHIP, which is `flexShrink: 1` and
            // therefore not "incompressible" — and that exclusion is safe rather
            // than merely convenient, which is worth recording because the
            // arithmetic suggests otherwise. A small MUI Chip carries 8px of
            // label padding a side, so a chip "floor" of ~18px is the natural
            // guess; measured, the label's `overflow: hidden` collapses that
            // padding along with the root, and the chip renders 6px at a 1024px
            // viewport and 0-2px below it (2px being the `stale` variant's
            // border). Under 8px at the width this budget is about — inside the
            // 17px of headroom, in a fixture that never renders one anyway
            // because it seeds no orchestration claim.
            expect(at1800.incompressible,
                "the row's controls fit a 1024px viewport with the title at zero")
                .toBeLessThanOrEqual(780);

            // 2. The step-width control widens the WORLD, read from `data-world`.
            //
            //    Deliberately NOT `data-transform`: on this plan the default
            //    scale is already the readable floor (measured 0.8, i.e.
            //    fit-to-width is BELOW it), so widening the columns lowers the
            //    fit scale further and the transform does not move at all. That
            //    is the readable default behaving correctly, and it makes the
            //    transform blind to this control. The scroll rail used to be this
            //    observable; the rails were removed on the user's directive
            //    (2026-08-01), so the component publishes the world instead.
            const container = page.getByTestId('pipeline-plan-visualizer');
            await expect(page.getByTestId('pipeline-viz-rail-h'),
                'the scroll rails are gone, not hidden').toHaveCount(0);
            await expect(page.getByTestId('pipeline-viz-rail-v')).toHaveCount(0);
            const worldW = async () => Number(
                (await container.getAttribute('data-world'))!.split(',')[0]);
            const beforeW = await worldW();
            expect(beforeW, 'the world is published').toBeGreaterThan(0);
            const widthToggle = page.getByTestId('pipeline-viz-stepwidth-toggle');
            await expect(widthToggle).toBeVisible();
            // By VALUE, not by accessible name: the buttons read "Width: S",
            // "M", "L" and Playwright's name match is a case-insensitive
            // substring, so `name: 'L'` also matches "Column width — compact".
            await widthToggle.locator('button[value="wide"]').click();
            await expect.poll(worldW,
                { message: 'Width: L must widen the world' })
                .toBeGreaterThan(beforeW);

            // 3. The next-step readout is GONE (user directive 2026-08-01). The
            //    halo on the beads is the whole mark; a corner chip restating it
            //    in text was chrome over the plan. Asserted as absent so it
            //    cannot creep back in.
            await expect(page.getByTestId('pipeline-viz-next-steps')).toHaveCount(0);

            // 4. Reset is the FACTORY DEFAULT (req #3216 D1), not a return to
            //    the readable landing scale: fully zoomed out, the whole
            //    plan's vertical extent visible, from any pan OR zoom — "reset
            //    that lands somewhere the user still has to zoom out from is
            //    not reset" (the requirement's own words). It also moved into
            //    the header's zoom control group, out of the canvas's
            //    bottom-right corner it used to float in — the click below
            //    reaches the same test id in its new home with no locator
            //    change (D1 acceptance: "re-point anything asserting on the
            //    reset button at its new home").
            const canvas = container.locator('canvas').first();
            const box = (await canvas.boundingBox())!;
            const worldH = async () => Number(
                (await container.getAttribute('data-world'))!.split(',')[1]);
            const atDefault = (await container.getAttribute('data-transform'))!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 - 150,
                { steps: 10 });
            await page.mouse.up();
            for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -400);   // zoom IN too
            await expect(container, 'the pan/zoom actually moved the view')
                .not.toHaveAttribute('data-transform', atDefault);
            await page.getByTestId('pipeline-viz-reset').click();
            const [rx, ry, rk] = (await container.getAttribute('data-transform'))!
                .split(',').map(Number);
            expect(rx, 'reset re-centres the world origin to the panel (x)').toBeCloseTo(0, 1);
            expect(ry, 'reset re-centres the world origin to the panel (y)').toBeCloseTo(0, 1);
            // THE ACCEPTANCE BAR ITSELF, not a proxy for it: the whole
            // vertical extent must be ON SCREEN at the scale reset lands on,
            // the exact property `kDefault` (fit-to-width floored for
            // legibility) does not guarantee on a tall plan.
            expect(rk * (await worldH()),
                "reset shows the plan's whole vertical extent, nothing left to "
                + 'zoom out for').toBeLessThanOrEqual(box.height + 1);

            // 4b. Reset's neighbour in the same header group must not undo
            //     it (code review finding on req #3216): Width re-centres on
            //     every change because it rescales every column, and before
            //     this was fixed that re-centre was hard-coded to the
            //     readable landing scale — so clicking Width right after
            //     Reset silently snapped the camera back to a view that may
            //     no longer show the whole plan. The fit-to-height property
            //     Width does not touch (only column width changes, not band
            //     height) must survive the click.
            await widthToggle.locator('button[value="medium"]').click();
            const [, , rk2] = (await container.getAttribute('data-transform'))!
                .split(',').map(Number);
            expect(rk2 * (await worldH()),
                'Width must recentre onto the SAME factory-default view Reset '
                + 'landed on, not the readable landing scale')
                .toBeLessThanOrEqual(box.height + 1);

            // 5. And the panel still clips — the rails are an overlay, not a
            //    scrollbar, so the PIPE-08 directive is untouched by them.
            const overflow = await page.evaluate(() => {
                const el = document.querySelector(
                    '[data-testid="pipeline-plan-visualizer"]') as HTMLElement;
                return {
                    overflowX: getComputedStyle(el).overflowX,
                    document: document.documentElement.scrollWidth
                        - document.documentElement.clientWidth,
                };
            });
            expect(overflow.overflowX).toBe('hidden');
            expect(overflow.document).toBeLessThanOrEqual(0);

            // 6. ONE ROW ON A REAL LAPTOP, TOO (req #3241). The old row wrapped
            //    below ~2180px, so a 1440px MacBook saw two lines and a 1280px
            //    window saw three — i.e. the width that mattered was the one
            //    nothing asserted. This runs LAST in the test on purpose: a
            //    viewport change re-fits the canvas, so it must not land in the
            //    middle of the transform claims above.
            //
            //    The title is allowed to ellipsize here — that is the declared
            //    cost of the choice, and it is CHECKED rather than assumed, so a
            //    future change that clips a CONTROL instead cannot pass by
            //    quietly satisfying the height bound.
            //
            //    Down to 1024, the narrowest viewport that still gets the 180px
            //    sidebar and therefore the worst ratio of chrome to content this
            //    page ever sees. Note the height check is nearly tautological
            //    under `nowrap` — it guards a future revert to `wrap`, nothing
            //    more. `docOverflow` and the per-control clip check are the two
            //    claims with teeth here, and the `incompressible` budget above
            //    is what makes them fixture-independent.
            for (const width of [1440, 1280, 1152, 1024]) {
                await page.setViewportSize({ width, height: 1000 });
                await expect(page.getByTestId('pipeline-header-row')).toBeVisible();
                const m = await rowMetrics();
                // eslint-disable-next-line no-console
                console.log(`[PIPE-18] header row @${width}px: `
                    + `content=${m.content}px incompressible=${m.incompressible}px `
                    + `height=${m.rowHeight}px `
                    + `(tallest child ${m.tallestChild}px, `
                    + `title ellipsized=${m.titleClipped})`);
                expect(m.rowHeight, `the header is ONE line at ${width}px`)
                    .toBeLessThanOrEqual(m.tallestChild + 2);
                expect(m.docOverflow,
                    `the one row does not drag the page sideways at ${width}px`)
                    .toBeLessThanOrEqual(0);
                // Every CONTROL keeps its natural size — only the title gives.
                for (const id of ['pipeline-detail-mode-toggle',
                    'pipeline-viz-level-control', 'pipeline-viz-stepwidth-toggle',
                    'pipeline-viz-colorkey-toggle', 'pipeline-viz-reset',
                    'pipeline-reqcounts-toggle', 'pipeline-description-btn']) {
                    const el = page.getByTestId(id);
                    await expect(el, `${id} is still visible at ${width}px`)
                        .toBeVisible();
                    const clipped = await el.evaluate(
                        (n: HTMLElement) => n.scrollWidth > n.clientWidth + 1);
                    expect(clipped, `${id} is not compressed at ${width}px`)
                        .toBe(false);
                }
            }
        });

    // ── PIPE-20: the met/total counts are ON without being asked (req #3241) ─
    //
    // Req #3225 built this correctly on both surfaces and defaulted it OFF, so
    // the user who asked to SEE the numbers had to find a toggle first. Req
    // #3241 flipped the default. NOTHING HERE TOUCHES A PREFERENCE before the
    // first assertion — that is the whole claim, and pinning the key would
    // silently make this a test of the pinned value instead.

    test('PIPE-20: met/total shows on the plan name and epic bands by default',
        async ({ page }) => {
            const counts = plan.requirementCounts.overall;
            expect(counts.total, 'the fixture has requirements to count')
                .toBeGreaterThan(0);
            const title = String(fixture.models.main.pipeline.title);

            // 1. THE LIST PAGE, arrived at cold. It carries no control for this
            //    preference at all — it only reads what the detail page's toggle
            //    last wrote — so a default of `off` made the numbers unreachable
            //    from here without visiting another page first.
            await page.goto('/swarm/pipelines');
            await expect(page.getByTestId('pipelines-cards-view'))
                .toBeVisible({ timeout: 30000 });
            await expect(page.getByTestId(`pipeline-card-${fixture.mainPipelineId}`),
                'the card names the plan AND its met/total, with nothing enabled')
                .toContainText(`${title} ${counts.met}/${counts.total}`);

            // 2. THE PLAN PAGE, same cold start: the header title and the
            //    breadcrumb both carry it, and the toggle reports itself ON
            //    rather than merely behaving as though it were.
            await page.setViewportSize({ width: 1800, height: 1000 });
            await openPlanVisualizer(page, fixture.mainPipelineId);
            await expect(page.getByTestId('pipeline-title'))
                .toHaveText(`${title} ${counts.met}/${counts.total}`);
            await expect(page.getByTestId('pipeline-reqcounts-toggle'))
                .toHaveClass(/MuiButton-contained/);

            // 3. THE EPIC BAND LABELS — the surface the req #3225 header-width
            //    argument never applied to, since they are drawn on the canvas.
            //    The floating chips are the DOM half of that label and carry the
            //    same `epicLabel` the canvas draws, so they are assertable text.
            //    POLLED, not read once: chip placement depends on the
            //    ResizeObserver's first report AND on the key's measured rect
            //    (`legendSize`), which lands on a later commit and displaces
            //    chips — so a single `allInnerTexts()` taken the moment the
            //    canvas turns visible can legitimately see zero of them.
            const chipTexts = async () => page.locator(
                '.pipeline-viz-epic-name').allInnerTexts();
            const countedChips = async () =>
                (await chipTexts()).filter((t) => /\s\d+\/\d+$/.test(t)).length;
            //    "no chips at all" and "chips without counts" are DIFFERENT
            //    failures and must not share a message — and without this,
            //    step 4's `.toBe(0)` would also pass vacuously on a plan that
            //    rendered no chips.
            await expect.poll(async () => (await chipTexts()).length,
                { message: 'the fixture draws epic chips to read' })
                .toBeGreaterThan(0);
            await expect.poll(countedChips,
                { message: 'at least one epic band label carries its met/total' })
                .toBeGreaterThan(0);

            // 4. AND IT IS STILL A CHOICE, not a hardcode: turning it off takes
            //    the numbers off BOTH surfaces. Without this, a default-on that
            //    ignored the toggle entirely would pass every check above.
            await page.getByTestId('pipeline-reqcounts-toggle').click();
            await expect(page.getByTestId('pipeline-reqcounts-toggle'))
                .toHaveClass(/MuiButton-outlined/);
            await expect(page.getByTestId('pipeline-title')).toHaveText(title);
            await expect.poll(countedChips,
                { message: 'turning Counts off clears the band labels too' })
                .toBe(0);
        });

    // ── PIPE-15: the key and the tri-state colour control (req #3168) ───────

    test('PIPE-15: the key defines both channels at ONE size, and the colour key is tri-state',
        async ({ page }) => {
            await page.setViewportSize({ width: 1800, height: 1000 });
            await openPlanVisualizer(page, fixture.mainPipelineId);

            const key = page.getByTestId('pipeline-viz-legend');
            const reqScale = page.getByTestId('pipeline-viz-legend-reqscale');
            const toggle = page.getByTestId('pipeline-viz-colorkey-toggle');
            const stateBtn = toggle.locator('button[value="state"]');
            const machineBtn = toggle.locator('button[value="machine"]');
            const scaleOf = (name: string) =>
                page.getByTestId(`pipeline-viz-legend-scale-${name}`);

            // 1. THE KEY IS THE TWO CHANNELS A READER DECODES, and nothing else.
            //    The user's second pass removed the heading, the small-print
            //    footer and the plan-level rows; what remains must still cover
            //    every mark on the canvas that carries meaning.
            await expect(key).toBeVisible();
            const keyBox = (await key.boundingBox())!;
            const panelBox = (await page.getByTestId('pipeline-plan-visualizer')
                .boundingBox())!;
            expect(keyBox.x - panelBox.x, 'the key is in the RIGHT half of the panel')
                .toBeGreaterThan(panelBox.width / 2);
            expect(keyBox.y - panelBox.y, 'the key is at the TOP of the panel')
                .toBeLessThan(40);
            for (const mark of ['Complete', 'Running', 'Scheduled', 'Manual', 'next up']) {
                await expect(key, `the key names "${mark}"`).toContainText(mark);
            }
            // …and the removals are asserted as ABSENT so they cannot creep back.
            await expect(key).not.toContainText('band = epic');
            await expect(key).not.toContainText('/swarm-start');
            await expect(key).not.toContainText('size carries no meaning');
            await expect(key).not.toContainText('motion = live');
            // The heading is gone; the requirement group is labelled plainly.
            // CASE-INSENSITIVE: the caption is uppercased by `text-transform`,
            // so its rendered case and its text content are different things.
            // Asserting the styled form pins a CSS choice, not the content.
            await expect(reqScale).toContainText(/requirement/i);
            await expect(reqScale).not.toContainText('Requirement id');

            // 2. THE SWATCH IS THE WORD. Each status name is drawn in its own
            //    colour rather than beside a sample id — asserted through the
            //    fixture's own statuses and through the absence of the sample.
            await expect(stateBtn).toHaveAttribute('aria-pressed', 'true');
            const seededStatuses = [...new Set(fixture.models.main.requirements
                .map((r) => String(r.requirement_status)))];
            expect(seededStatuses.length,
                'the fixture exercises more than one requirement status')
                .toBeGreaterThan(1);
            for (const st of seededStatuses) {
                await expect(scaleOf('state'), `the scale lists "${st}"`)
                    .toContainText(st.replace('_', '-'));
            }
            await expect(scaleOf('state')).not.toContainText('42');
            // Each name really is coloured, and no two share a colour.
            const colors = await scaleOf('state').locator('span, p').evaluateAll(
                (els) => els.map((el) => getComputedStyle(el).color)
                    .filter((c) => c && c !== 'rgba(0, 0, 0, 0)'));
            expect(new Set(colors).size, 'each status name has its own colour')
                .toBe(colors.length);

            // 3. ONE FOOTPRINT ACROSS MODES — the user's complaint was that "when
            //    I select machine view the key gets too small". All three scales
            //    occupy one grid cell, so the box cannot change size when the
            //    mode does. Measured, not assumed.
            const sizeNow = async () => {
                const b = (await key.boundingBox())!;
                return { w: Math.round(b.width), h: Math.round(b.height) };
            };
            const atState = await sizeNow();
            await machineBtn.click();
            await expect(machineBtn).toHaveAttribute('aria-pressed', 'true');
            await expect(scaleOf('machine')).toBeVisible();
            expect(await sizeNow(), 'machine mode must not resize the key')
                .toEqual(atState);

            // 4. THE TRI-STATE GESTURE, exactly as the directive states it:
            //    click Machine again → no colouring at all.
            await machineBtn.click();
            await expect(machineBtn).toHaveAttribute('aria-pressed', 'false');
            await expect(stateBtn).toHaveAttribute('aria-pressed', 'false');
            await expect(scaleOf('none')).toContainText('no colour key');
            expect(await sizeNow(), 'the neutral mode must not resize the key either')
                .toEqual(atState);
            //    …and the third position is reachable from either button.
            await stateBtn.click();
            await expect(stateBtn).toHaveAttribute('aria-pressed', 'true');
            await stateBtn.click();
            await expect(stateBtn).toHaveAttribute('aria-pressed', 'false');

            // 5. It still costs the epic labels no chip — the key's measured rect
            //    is their keep-out, and collapsing it is the control for that
            //    claim: a key that were stealing the corner would let MORE chips
            //    draw once collapsed.
            await stateBtn.click();
            const chips = page.locator('[data-testid^="pipeline-viz-epic-"]');
            const withKeyOpen = await chips.count();
            expect(withKeyOpen, 'the fixture draws epic chips to protect')
                .toBeGreaterThan(0);
            await page.getByTestId('pipeline-viz-legend-toggle').click();
            await expect(reqScale).toHaveCount(0);
            await expect.poll(async () => (await key.boundingBox())!.height,
                { message: 'collapsing the key shrinks its measured rect' })
                .toBeLessThan(keyBox.height);
            await expect(key).toBeVisible();
            await expect(chips,
                'the key costs the epic labels no chip vs. the collapsed one')
                .toHaveCount(withKeyOpen);
            await page.getByTestId('pipeline-viz-legend-toggle').click();
            await expect(reqScale).toBeVisible();
        });

    // ── PIPE-16: what's drawn is gated by level, and the L1/L2/L3/Auto selector ──

    test('PIPE-16: the level selector pins what is DRAWN without moving the camera',
        async ({ page }) => {
            await page.setViewportSize({ width: 1800, height: 1000 });
            const canvas = await openPlanVisualizer(page, fixture.mainPipelineId);
            const container = page.getByTestId('pipeline-plan-visualizer');
            const control = page.getByTestId('pipeline-viz-level-control');

            // 1. It is the Build Visualizer's control, reused — same shape, same
            //    labels, same Auto-is-a-position behaviour, one component.
            //    `aria-pressed` on its own chips is what NAMES the pinned state
            //    (req #3216 D2 — the status chip that used to restate it in
            //    words, "· pinned", was deleted outright; this control was
            //    already the thing a reader pins or clears a level FROM, so
            //    removing the caption removed no signal without another home).
            //
            //    Its HOME is the page header since req #3241 (PIPE-18 owns that
            //    claim). Not one locator here changed with the move, which is
            //    the point of `testIdPrefix`: the control's behaviour is the
            //    same control's behaviour wherever it is mounted.
            await expect(control).toBeVisible();
            await expect(control).toContainText('Detail:');
            for (const id of ['auto', '1', '2', '3']) {
                await expect(page.getByTestId(`pipeline-viz-level-${id}`)).toBeVisible();
            }
            await expect(page.getByTestId('pipeline-viz-level-auto'))
                .toHaveAttribute('aria-pressed', 'true');
            await expect(container).toHaveAttribute('data-level', 'mid');

            // 2. PINNING CHANGES WHAT IS DRAWN, NOT WHERE THE CAMERA IS. The
            //    transform must be byte-identical across a pin — that is the
            //    whole distinction between this control and a zoom button.
            const before = (await container.getAttribute('data-transform'))!;
            const atMid = await canvas.screenshot();

            await page.getByTestId('pipeline-viz-level-1').click();
            await expect(page.getByTestId('pipeline-viz-level-1'))
                .toHaveAttribute('aria-pressed', 'true');
            await expect(container).toHaveAttribute('data-level', 'out');
            expect(await container.getAttribute('data-transform'),
                'pinning a level must not move the camera').toBe(before);
            const atOut = await canvas.screenshot();
            expect(Buffer.compare(atMid, atOut),
                'pinning redraws the canvas at the new level').not.toBe(0);

            await page.getByTestId('pipeline-viz-level-3').click();
            await expect(page.getByTestId('pipeline-viz-level-3'))
                .toHaveAttribute('aria-pressed', 'true');
            await expect(container).toHaveAttribute('data-level', 'in');
            expect(await container.getAttribute('data-transform')).toBe(before);

            // 3. Clicking the pinned level again returns to Auto — the Build
            //    Visualizer's own escape hatch, so a pin is never a trap.
            await page.getByTestId('pipeline-viz-level-3').click();
            await expect(page.getByTestId('pipeline-viz-level-auto'))
                .toHaveAttribute('aria-pressed', 'true');
            await expect(page.getByTestId('pipeline-viz-level-3'))
                .toHaveAttribute('aria-pressed', 'false');
            await expect(container).toHaveAttribute('data-level', 'mid');

            // 4. STEP/REQ/TITLE ARE GATED, EACH ON ITS OWN CONDITION (req #3221).
            //    `data-drawn` only ever enumerates these three kinds — the ruler's
            //    slot ticks, the batch letters and the epic band names are NOT
            //    level-gated and draw at every level regardless (see `drawsKind`'s
            //    `return true` fallback), so this attribute proves the ladder for
            //    the three kinds it tracks, not "Overview draws nothing" in
            //    absolute terms. The canvas is a bitmap, so the component
            //    publishes which of the three it drew — `data-drawn`, the same
            //    device as `data-transform` beside it and for the same reason: a
            //    screenshot at Overview looks identical whether the step label is
            //    there or not unless you already hold the other version, so a
            //    pixel comparison here would prove nothing.
            //
            //    The ladder itself is asserted whole, because "gated at L1" is
            //    only meaningful next to the kinds that draw at every level.
            const drawnAt = async (lvl: string, expected: string, message: string) => {
                await page.getByTestId(`pipeline-viz-level-${lvl}`).click();
                await expect(container, message).toHaveAttribute('data-drawn', expected);
            };
            await drawnAt('1', '', 'Overview draws none of the three gated kinds');
            await drawnAt('2', 'step,req', 'Plan adds the step name and requirement marks');
            await drawnAt('3', 'step,req,title', 'Detail adds the per-step title slot');
            // And the plan really has step labels to draw, or the attribute
            // above would be describing an empty set.
            const layout = computePlanLayout(plan.rows, plan.batches,
                { reqLayout: 'horizontal', stepLabel: 'id' });
            expect(layout.labels.filter((l: { kind: string }) => l.kind === 'step').length,
                'the plan has one step label per row').toBe(plan.rows.length);
        });

    // ── PIPE-17: requirement titles under the bead (req #3168) ──────────────

    test('PIPE-17: requirement marks become TITLES at L3, and the camera does not move',
        async ({ page }) => {
            // The `Reqs:` control is GONE (user directive 2026-08-01) — the marks
            // are always the vertical stack, and the id/title choice is no longer
            // a control at all: it is the LEVEL. "L3 can have the req titles on
            // by default", so L1/L2 draw the id and L3 draws the name.
            await page.setViewportSize({ width: 1800, height: 1000 });
            const canvas = await openPlanVisualizer(page, fixture.mainPipelineId);
            const container = page.getByTestId('pipeline-plan-visualizer');

            await expect(page.getByTestId('pipeline-viz-reqlayout-toggle'),
                'the Reqs control is gone, not hidden').toHaveCount(0);

            // L2 — ids under the beads.
            await page.getByTestId('pipeline-viz-level-2').click();
            await expect(container).toHaveAttribute('data-level', 'mid');
            const beforeTransform = (await container.getAttribute('data-transform'))!;
            const withIds = await canvas.screenshot();

            // L3 — the same marks, now naming their requirements.
            await page.getByTestId('pipeline-viz-level-3').click();
            await expect(container).toHaveAttribute('data-level', 'in');
            const withTitles = await canvas.screenshot();

            // THE MARKS CHANGED…
            expect(Buffer.compare(withIds, withTitles),
                'the requirement marks must actually change at L3').not.toBe(0);
            // …AND THE CAMERA DID NOT. This is the invariant that made the
            // layout reserve the TITLE's box at every level and let the renderer
            // choose the text: a level change is a pure redraw, never a re-fit,
            // so nothing under the pointer moves as the reader crosses L2→L3.
            expect(await container.getAttribute('data-transform'),
                'crossing a level must not re-fit the plan').toBe(beforeTransform);

            // The geometry the page renders from is ONE layout — the title's —
            // at every level, which is what the camera assertion above depends
            // on. Against the id layout it is identical HORIZONTALLY (the user's
            // "I do not want any other spacing to have to change") and taller by
            // exactly the swim lane the later directive asked for: one line per
            // lane, so a lone title can alternate clear of its neighbours.
            const asTitles = computePlanLayout(plan.rows, plan.batches, {
                ...PLAN_VIEW_OPTIONS,
                reqTitles: new Map(fixture.models.main.requirements.map(
                    (r) => [r.id, `Requirement ${r.id}`])),
            });
            const asIds = computePlanLayout(plan.rows, plan.batches,
                { ...PLAN_VIEW_OPTIONS, reqLabel: 'id' });
            expect(asTitles.colW).toEqual(asIds.colW);
            expect(asTitles.width).toBe(asIds.width);
            const lanes = asIds.bands.reduce((sum, b) => sum + b.sub, 0);
            expect(asTitles.height - asIds.height).toBe(lanes * REQ_LINE_H);
        });

    // ── PIPE-19: the hover datacards (req #3213) ───────────────────────────
    //
    // The whole of #3213's acceptance is a HOVER claim — "hovering a step name,
    // a bead, a requirement number, a batch box and an epic chip each produces
    // the card for the thing under the cursor, first try, with no dead zones
    // and no wrong card" — and no test at any level asserted a datacard before
    // this one. The unit suite can only prove the GEOMETRY leaves room; which
    // card actually appears is a question about Konva's hit graph and the order
    // the renderer pushes its nodes, and only a browser can answer it.
    test('PIPE-19: every hover target answers with its own card, and the cards lead with a name',
        async ({ page }) => {
            // The BATCH plan, because half of what is under test is D2 — a step
            // name drawn OVER a dashed batch rectangle must beat it — and the
            // Substrate plan draws no boxes at all.
            const layout = computePlanLayout(batchPlan.rows, batchPlan.batches,
                { ...PLAN_VIEW_OPTIONS, timeAxis: batchPlan.timeAxis || null,
                    epicCounts: epicCountsOf(batchPlan) });
            const canvas = await openPlanVisualizer(page, fixture.batchPipelineId);
            const container = page.getByTestId('pipeline-plan-visualizer');
            const box = (await canvas.boundingBox())!;
            // Same world-to-screen frame PIPE-11 derives, and for the same
            // reason: read the component's own transform rather than assuming
            // fit-to-width. Hovering never navigates, so one frame serves the
            // whole test.
            const [tx, ty, k] = (await container.getAttribute('data-transform'))!
                .split(',').map(Number);
            const at = (x: number, y: number) =>
                ({ x: box.x + tx + x * k, y: box.y + ty + y * k });
            const mid = (l: { x: number; y: number; w: number; h: number }) =>
                at(l.x + l.w / 2, l.y + l.h / 2);

            const card = page.getByTestId('pipeline-viz-datacard');
            /** Hover a screen point and read the card that appears. */
            const hover = async (pt: { x: number; y: number }) => {
                // Off-target first: without it a card left over from the
                // previous hover satisfies the wait and the test passes on a
                // stale reading rather than a new one.
                await page.mouse.move(box.x + 2, box.y + box.height - 2);
                await expect(card).toHaveCount(0, { timeout: 5000 });
                await page.mouse.move(pt.x, pt.y);
                await expect(card).toBeVisible({ timeout: 5000 });
                return card.evaluate((el) => ({
                    kind: el.getAttribute('data-kind'),
                    title: el.querySelector('.ts-datacard-title')!.textContent!.trim(),
                    rows: Object.fromEntries(
                        Array.from(el.querySelectorAll('.ts-datacard-row')).map((r) => [
                            r.querySelector('.ts-datacard-key')!.textContent!.trim(),
                            (r.querySelector('.ts-datacard-key')!
                                .nextElementSibling?.textContent ?? '').trim(),
                        ])),
                }));
            };

            // ── D1 + D2: the step NAME, and it must beat the box beneath it ──
            // Chosen as a label that genuinely OVERLAPS a batch rectangle where
            // the plan offers one, so the assertion is about competition rather
            // than about empty canvas.
            const stepLabels = layout.labels.filter(
                (l: { kind: string }) => l.kind === 'step') as Array<
                    { x: number; y: number; w: number; h: number; stepId: number }>;
            expect(stepLabels.length, 'the plan draws step labels').toBeGreaterThan(0);
            const overBox = stepLabels.find((l) => layout.batchBoxes.some(
                (b: { x: number; y: number; width: number; height: number }) =>
                    l.x < b.x + b.width && b.x < l.x + l.w
                    && l.y < b.y + b.height && b.y < l.y + l.h));
            const stepLabel = overBox ?? stepLabels[0];
            const stepRow = batchPlan.rows.find(
                (r: { id: number }) => r.id === stepLabel.stepId)!;
            const stepCard = await hover(mid(stepLabel));
            expect(stepCard.kind,
                overBox
                    ? 'a step name drawn over a batch box answers with the STEP card'
                    : 'a step name answers with the step card').toBe('step');
            // D3 — the NAME alone is the heading and the id is a field. The
            // heading used to be `Step <id> — <title>`, so asserting the title
            // is the whole string is what pins the split.
            expect(stepCard.title).toBe(stepRow.title);
            expect(stepCard.rows.Step).toBe(String(stepRow.id));

            // The BEAD still answers with the same card — the name did not take
            // the hover away from the mark it was added beside.
            const node = layout.nodes.get(stepLabel.stepId) as { x: number; y: number };
            const beadCard = await hover(at(node.x, node.y));
            expect(beadCard.kind).toBe('step');
            expect(beadCard.title).toBe(stepRow.title);

            // ── D4 + D5: the requirement mark ───────────────────────────────
            const reqLabel = layout.labels.find(
                (l: { kind: string }) => l.kind === 'req') as
                { x: number; y: number; w: number; h: number; reqId: number };
            expect(reqLabel, 'the plan draws requirement marks').toBeTruthy();
            const seeded = fixture.models.batch.requirements.find(
                (r: { id: number }) => r.id === reqLabel.reqId)!;
            const reqCard = await hover(mid(reqLabel));
            expect(reqCard.kind).toBe('req');
            // The TITLE leads and the number is a field — exactly inverted from
            // what shipped before #3213.
            expect(reqCard.title).toBe(seeded.title);
            expect(reqCard.rows.Requirement).toBe(String(reqLabel.reqId));
            expect(reqCard.rows.Status).toBe(seeded.requirement_status);
            // Autonomy is the end-to-end proof that the projection reaches the
            // card: it is seeded PER REQUIREMENT, so a wrong or missing field
            // cannot coincide with the fixture's value.
            expect(reqCard.rows.Autonomy).toBe(COORDINATION_LABELS[
                seeded.coordination_type as keyof typeof COORDINATION_LABELS]);
            // Model and Effort are the two columns PLAN_REQUIREMENT_FIELDS
            // gained. The fixture seeds them explicitly and OFF the defaults, so
            // these two assertions can only pass if the widened projection
            // travelled: a dropped column renders '—', and the label helpers'
            // own fallbacks are 'Opus' and 'High'. Neither is what is asserted.
            expect(reqCard.rows.Model).toBe(aiModelLabel(seeded.ai_model));
            expect(reqCard.rows.Model).toBe('Sonnet');
            expect(reqCard.rows.Effort).toBe(effortLabel(seeded.effort));
            expect(reqCard.rows.Effort).toBe('XHigh');

            // ── D2 acceptance: the batch stays reachable, both ways ─────────
            const batchBox = layout.batchBoxes[0] as
                { x: number; y: number; width: number; height: number; letter: string };
            expect(batchBox, 'the batch plan draws a box').toBeTruthy();
            // By its LETTER — the label sits in the band header strip, often
            // above the box's own top edge, so this is not the same target.
            const batchLabel = layout.labels.find(
                (l: { kind: string; letter?: string }) =>
                    l.kind === 'batch' && l.letter === batchBox.letter) as
                { x: number; y: number; w: number; h: number };
            expect(await hover(mid(batchLabel))).toMatchObject({ kind: 'batch' });
            // And by the BOX ITSELF — at a point inside it that no label covers,
            // found rather than assumed, because a hard-coded corner would drift
            // with the layout.
            const covers = layout.labels.filter(
                (l: { kind: string }) => ['step', 'title', 'batch'].includes(l.kind));
            let free: { x: number; y: number } | null = null;
            for (let i = 1; i < 12 && !free; i++) {
                for (let j = 1; j < 12 && !free; j++) {
                    const px = batchBox.x + (batchBox.width * i) / 12;
                    const py = batchBox.y + (batchBox.height * j) / 12;
                    const covered = covers.some(
                        (l: { x: number; y: number; w: number; h: number }) =>
                            px >= l.x && px <= l.x + l.w && py >= l.y && py <= l.y + l.h);
                    // Not on a bead either — that is the step's hit circle, and
                    // it is legitimately above the box.
                    const onBead = [...layout.nodes.values()].some(
                        (n: { x: number; y: number }) =>
                            Math.hypot(n.x - px, n.y - py) < BEAD_HIT_RADIUS + 2);
                    if (!covered && !onBead) free = { x: px, y: py };
                }
            }
            expect(free, 'the batch box keeps an uncovered interior').toBeTruthy();
            expect(await hover(at(free!.x, free!.y))).toMatchObject({ kind: 'batch' });

            // ── D6: the epic chip names what its click does ─────────────────
            //
            // Against `epicLabel`, NOT `epic` (req #3241). Both attributes below
            // are interpolated from the chip's RENDERED text, and since the
            // Counts toggle defaults on that text is `${epic} ${met}/${total}`.
            // Reading the bare name here would assert a label the page stopped
            // producing — and `epicLabel` is exactly `epic` whenever the counts
            // are off, so this reads correctly in both states rather than
            // hard-coding the current default.
            const epicBand = layout.bands.find(
                (b: { epicId: number | null }) => b.epicId != null) as
                { epicId: number; epic: string; epicLabel: string };
            const epicText = epicBand.epicLabel || epicBand.epic;
            // The precondition guards that the FIXTURE exercises the counted
            // path, not that this particular band shows a number. Asserting the
            // suffix on `epicText` would contradict the comment above and would
            // fail on CORRECT behaviour: `requirementCounts` skips `tracking`
            // requirements, so an epic whose requirements are all containers
            // legitimately gets a band with no bucket and `epicBandLabelText`
            // degrades it to the plain name.
            expect(epicCountsOf(batchPlan).size,
                'the fixture exercises the counted band label').toBeGreaterThan(0);
            const chip = page.getByTestId(`pipeline-viz-epic-${epicBand.epicId}`);
            await expect(chip).toHaveAttribute('title', 'Zoom pipeline epic');
            // The accessible name still carries WHICH epic — a tooltip that
            // named only the gesture would be a regression for a screen reader.
            await expect(chip).toHaveAttribute(
                'aria-label', `Zoom pipeline epic ${epicText}`);
            // …and the ↗ beside it still names itself distinctly, which is what
            // makes the chip two controls rather than one ambiguous one.
            await expect(page.getByTestId(`pipeline-viz-epic-open-${epicBand.epicId}`))
                .toHaveAttribute('title', `Open “${epicText}” in the features view`);
        });
});
