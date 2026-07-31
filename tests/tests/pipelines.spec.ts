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
import { computePlanLayout } from '../../src/SwarmView/pipelines/pipelinePlanLayout.js';

// UTC so the seeded naive timestamps and the rendered ones agree on any host.
test.use({ timezoneId: 'UTC' });

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
    // The two VISUALIZER preferences are pinned alongside the mode, because
    // PIPE-11 computes canvas click coordinates from
    // `computePlanLayout(..., {reqLayout: 'horizontal', stepLabel: 'id'})` and
    // those must be the values the component is actually rendering. A stale
    // storage value would move every coordinate and produce silent click misses
    // rather than a legible failure.
    //
    // `addInitScript` accumulates and re-runs in registration order on every
    // navigation, so re-registering only when the requested mode CHANGES keeps
    // the last writer correct without stacking a copy per goto.
    const lastMode = new WeakMap<Page, string>();
    async function pinPreferences(page: Page, mode: 'table' | 'plan'): Promise<void> {
        if (lastMode.get(page) === mode) return;
        lastMode.set(page, mode);
        await page.addInitScript((m) => {
            const set = (k: string, v: string) => {
                sessionStorage.setItem(k, v);
                localStorage.setItem(k, v);
            };
            set('darwin-swarm-pipeline-detail-mode', m as string);
            set('darwin-pipeline-viz-req-layout', 'horizontal');
            set('darwin-pipeline-viz-step-label', 'id');
        }, mode);
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
    async function openPlanVisualizer(page: Page, pipelineId: number): Promise<Locator> {
        await pinPreferences(page, 'plan');
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
        type VizLabel = { kind: string; text: string };
        const labels = layout.labels as VizLabel[];

        // Same scope split as the DOM sweep. `kind: 'title'` is the per-step
        // detail line — the step's own stored title, truncated — and
        // pipelinePlanLayout.js says so where it builds it: "ids render bare
        // (production directive), titles render verbatim (stored plan content)".
        const generated = labels.filter((l) => l.kind !== 'title')
            .map((l) => l.text).join(' ');
        expect(generated.match(/#\d+/g), 'generated canvas labels').toBeNull();

        // And the exclusion is EVIDENCED, not assumed: the fixture really does
        // carry a '#' inside stored prose (step 22's title names "#3077 R13"), so
        // a sweep that covered titles would fail on content it must not rewrite.
        const titles = labels.filter((l) => l.kind === 'title').map((l) => l.text).join(' ');
        expect(titles, 'the fixture exercises the prose exclusion').toMatch(/#\d/);
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
            const chip = page.getByTestId('pipeline-viz-zoom-level');
            const container = page.getByTestId('pipeline-plan-visualizer');
            const scale = async () =>
                Number((await container.getAttribute('data-transform'))!.split(',')[2]);
            const box = (await canvas.boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

            // Fit-to-width is ratio 1 → 'mid' → "Plan" (konvaSwarmModel's
            // semanticLevel, the same ladder the swarm canvas uses).
            await expect(chip).toContainText('Plan');
            const kMid = await scale();
            const atMid = await canvas.screenshot();

            // ratio < 0.5 → 'out'. d3-zoom's wheel factor is 2^(-deltaY/500),
            // so +800 more than halves; scaleExtent clamps at ratio 0.25.
            for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 800);
            await expect(chip).toContainText('Overview');
            const kOut = await scale();
            expect(kOut).toBeLessThan(kMid);
            const atOut = await canvas.screenshot();
            expect(Buffer.compare(atMid, atOut), 'the canvas redraws at the new level')
                .not.toBe(0);

            // ratio >= 1.9 → 'in'; clamps at 8.
            for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -800);
            await expect(chip).toContainText('Detail');
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

    test('PIPE-10: the dashed batch box and its legend key appear only with a batch',
        async ({ page }) => {
            // The box itself is canvas geometry and cannot be queried from the
            // DOM, so it is asserted through the SAME layout the component
            // renders from — while the legend key, which IS in the DOM, is
            // asserted directly on both plans. Together they cover the directive:
            // the key renders only when a box is actually drawn.
            const batchLayout = computePlanLayout(batchPlan.rows, batchPlan.batches,
                { reqLayout: 'horizontal', stepLabel: 'id' });
            expect(batchPlan.batches).toHaveLength(1);
            expect(batchLayout.batchBoxes).toHaveLength(1);
            expect(batchLayout.batchBoxes[0].letter).toBe('A');

            await openPlanVisualizer(page, fixture.batchPipelineId);
            await expect(page.getByTestId('pipeline-viz-batch-legend')).toBeVisible();

            const mainLayout = computePlanLayout(plan.rows, plan.batches,
                { reqLayout: 'horizontal', stepLabel: 'id' });
            expect(mainLayout.batchBoxes).toEqual([]);

            await openPlanVisualizer(page, fixture.mainPipelineId);
            await expect(page.getByTestId('pipeline-viz-batch-legend')).toHaveCount(0);
        });

    test('PIPE-11: bead, requirement and epic click targets navigate', async ({ page }) => {
        // The BATCH plan, on purpose. Canvas hit targets are world-space and the
        // stage is fit to width, so the screen-space tolerance is
        // (radius)·containerWidth/layout.width — on a four-step plan that is tens
        // of pixels, on the 34-step plan it is a handful. This test is about the
        // click TARGETS existing and routing, not about the layout's density.
        const layout = computePlanLayout(batchPlan.rows, batchPlan.batches,
            { reqLayout: 'horizontal', stepLabel: 'id' });

        // The component fits the world to the canvas width and starts at
        // zoomIdentity.scale(kBase), so world (x, y) sits at screen (x·k, y·k)
        // measured from the canvas origin.
        const frame = async () => {
            const canvas = await openPlanVisualizer(page, fixture.batchPipelineId);
            const box = (await canvas.boundingBox())!;
            const k = box.width / layout.width;
            return (x: number, y: number) => ({ x: box.x + x * k, y: box.y + y * k });
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

        // Epic band label → the features view filtered to that epic.
        at = await frame();
        const epicLabel = layout.labels.find(
            (l: { kind: string; epicId?: number }) => l.kind === 'epic' && l.epicId != null) as
            { x: number; y: number; epicId: number };
        expect(epicLabel, 'the plan renders epic band labels').toBeTruthy();
        const epicPt = at(epicLabel.x + 3, epicLabel.y + 3);
        await page.mouse.click(epicPt.x, epicPt.y);
        await expect(page).toHaveURL(new RegExp(`/swarm/features\\?epic=${epicLabel.epicId}$`),
            { timeout: 15000 });
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
});
