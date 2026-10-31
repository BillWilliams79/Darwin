// @vitest-environment jsdom
//
// Req #3742 — a click on an epic OPENS ITS SINGLE EDITOR over the canvas (user
// directives: "single click of initiative and epic to take you to the single
// editor", then "popup over the visualizer instead of switch to the card
// view"): the card's title area — and the bead at L1 — open the shared epic
// dialog seeded with that epic, and the page does not change. From req #3641
// until then the click framed the epic on this canvas (and before that it
// called `onEpicFocus`, which switched the page to the Table).
//
// jsdom has no canvas, so react-konva is stubbed: every shape carrying an
// `onActivate` renders as a button the test can click, publishing its world
// box. The camera is read off the container's published `data-transform`.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    // A shape with an activate handler becomes a clickable button carrying its
    // world box; everything else draws nothing.
    const Activatable = (kind) => function ActivatableShape(p) {
        if (!p.onActivate) return null;
        // The title-area activate rect is unstroked; the card's "+" button is
        // an outlined square — `data-stroked` tells them apart.
        return <button type="button" data-act={kind}
                       data-stroked={p.stroke ? '1' : '0'}
                       data-x={p.x} data-y={p.y}
                       data-w={p.width ?? ''} data-h={p.height ?? ''}
                       onClick={() => p.onActivate()} />;
    };
    return {
        Stage: ({ children }) => <div><canvas data-testid="stage-canvas" />{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: Activatable('rect'), Circle: Activatable('circle'),
        Line: () => null, Text: () => null, Path: () => null, Shape: () => null,
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

const updateEpic = vi.fn(() => Promise.resolve({}));
const deleteEpicFreeingDependents = vi.fn(() => Promise.resolve());
vi.mock('../../../Epics/epicsApi', async (orig) => ({
    ...(await orig()),
    updateEpic: (...a) => updateEpic(...a),
    deleteEpicFreeingDependents: (...a) => deleteEpicFreeingDependents(...a),
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import PlanElementEditor from '../PlanElementEditor';
import { usePlanEditorStore } from '../../../stores/usePlanEditorStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const PANEL_W = 1200;
const PANEL_H = 700;
let root;
let restoreSize;

beforeEach(() => {
    usePlanEditorStore.setState({ current: null });
    // The canvas restores the camera it last saved for a plan (req #3637), so
    // one test's framing would be the next test's landing without this.
    localStorage.clear();
    sessionStorage.clear();
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => PANEL_W });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => PANEL_H });
    restoreSize = () => {
        if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
        if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
    };
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    document.body.innerHTML = '';
});

let currentLocation = null;
function LocationProbe() {
    currentLocation = useLocation();
    return null;
}

const epic = (id, title) => ({
    id, initiative_fk: 5, title, run: 'auto', notes: null, not_before: null,
});

function render(levelPref) {
    // A chain long enough that the whole plan does not already fit the panel at
    // the scale a single epic is framed at — so framing one is a real move.
    const ids = [10, 11, 12, 13, 14, 15, 16, 17];
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
        epics: ids.map((id) => epic(id, `Epic ${id}`)),
        epicDeps: ids.slice(1).map((id, i) => ({ id: i + 1, epic_fk: id, dep_epic_fk: ids[i] })),
    });
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter initialEntries={['/swarm/pipeline/2?mode=plan']}>
                    <PipelinePlanVisualizer plan={plan} model={model} levelPref={levelPref}
                                            pipeline={payload.pipeline} timezone="UTC" />
<PlanElementEditor />
                    <LocationProbe />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}

const transform = () => document.querySelector('[data-testid="pipeline-plan-visualizer"]')
    .getAttribute('data-transform').split(',').map(Number);
// The focus transition is a 420ms d3 transition; let it run to its end.
const settle = () => act(() => new Promise((r) => { setTimeout(r, 800); }));
const clickLast = async (kind) => {
    const targets = [...document.querySelectorAll(`[data-act="${kind}"][data-stroked="0"]`)];
    expect(targets.length).toBeGreaterThan(0);
    const target = targets[targets.length - 1];
    const box = {
        x: Number(target.dataset.x), y: Number(target.dataset.y),
        w: Number(target.dataset.w || 0), h: Number(target.dataset.h || 0),
    };
    act(() => { target.click(); });
    await settle();
    return box;
};

// The editor it opened over the canvas, and the page and camera it left alone.
const expectEditorOpened = (before) => {
    const dialog = document.querySelector('[data-testid="plan-editor-form-epic"]');
    expect(dialog).not.toBeNull();
    const id = Number(document.querySelector('[data-testid="plan-editor-identity"]').textContent.match(/Epic (\d+)/)?.[1]);
    expect([10, 11, 12, 13, 14, 15, 16, 17]).toContain(id);
    expect(document.querySelector('[data-testid="plan-editor-field-title"]').value).toBe(`Epic ${id}`);
    expect(currentLocation.pathname).toBe('/swarm/pipeline/2');
    expect(transform()).toEqual(before);
};

describe('a click on an epic opens its single editor (req #3742)', () => {
    it('L3: the card title area opens the epic\'s editor over the canvas', async () => {
        render('3');
        await settle();
        const before = transform();
        // The title-area activate rect — unstroked; the whole-card rect is
        // hover-only and has no activate at all.
        await clickLast('rect');
        expectEditorOpened(before);
    });

    it('L1: the bead opens the epic\'s editor too', async () => {
        render('1');
        await settle();
        const before = transform();
        await clickLast('circle');
        expectEditorOpened(before);
    });

    it('Save in the editor writes the epic it was opened on', async () => {
        render('3');
        await settle();
        updateEpic.mockClear();
        await clickLast('rect');
        const dialog = document.querySelector('[data-testid="plan-editor-form-epic"]');
        const id = Number(document.querySelector('[data-testid="plan-editor-identity"]').textContent.match(/Epic (\d+)/)[1]);
        const input = document.querySelector('[data-testid="plan-editor-field-title"]');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
                .set.call(input, 'Renamed');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => { document.querySelector('[data-testid="plan-editor-save"]').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(updateEpic).toHaveBeenCalledWith(undefined, undefined, id,
            { title: 'Renamed', notes: 'NULL', run: 'auto', checkpoint: 1, not_before: 'NULL' });
    });

    // req #3867 — Delete in the editor: the epics waiting on this one, from
    // the rows the canvas holds, are freed of that dependency.
    it('Delete in the editor frees the epics waiting on it, then removes it', async () => {
        render('3');
        await settle();
        deleteEpicFreeingDependents.mockClear();
        await clickLast('rect');
        const dialog = document.querySelector('[data-testid="plan-editor-form-epic"]');
        const id = Number(document.querySelector('[data-testid="plan-editor-identity"]').textContent.match(/Epic (\d+)/)[1]);
        act(() => { document.querySelector('[data-testid="plan-editor-delete"]').click(); });
        const consequence = document.querySelector('[data-testid="plan-editor-delete-consequence"]');
        expect(consequence.textContent).toContain(`Delete epic ${id} "Epic ${id}"?`);
        act(() => { document.querySelector('[data-testid="plan-editor-delete-confirm"]').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(deleteEpicFreeingDependents).toHaveBeenCalledWith(undefined, undefined, id,
            id < 17 ? [id + 1] : []);
    });

    // The lock the gateway checks on a freed edge is the DEPENDENT's whole
    // chain, so a dependent locked only through its initiative blocks Delete.
    it('Delete is blocked when a dependent is locked through its initiative', async () => {
        const payload = composedFixture({
            initiatives: [
                { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 },
                { id: 6, title: 'Frozen', pipeline_fk: 2, sort_order: 2, locked: 1 },
            ],
            epics: [epic(10, 'Upstream'), { ...epic(11, 'Downstream'), initiative_fk: 6 }],
            epicDeps: [{ id: 1, epic_fk: 11, dep_epic_fk: 10 }],
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <MemoryRouter initialEntries={['/swarm/pipeline/2?mode=plan']}>
                        <PipelinePlanVisualizer plan={adaptComposedPipeline(payload)}
                                                model={buildPlanModel(payload)} levelPref="3"
                                                pipeline={payload.pipeline} timezone="UTC" />
<PlanElementEditor />
                        <LocationProbe />
                    </MemoryRouter>
                </QueryClientProvider>
            );
        });
        await settle();
        const editorTitle = () => document.querySelector('[data-testid="plan-editor-form-epic"]')
            ?.textContent.match(/Epic (\d+)/)?.[1];
        for (const target of document.querySelectorAll('[data-act="rect"][data-stroked="0"]')) {
            act(() => { target.click(); });
            await settle();
            if (editorTitle() === '10') break;
        }
        expect(editorTitle()).toBe('10');
        const del = document.querySelector('[data-testid="plan-editor-delete"]');
        expect(del.disabled).toBe(true);
        expect(del.getAttribute('aria-label')).toBe(
            'Epic 11 waits on it and is locked — unlock to delete this epic.');
    });

    // req #4133 — ONE editor at a time: opening another epic's replaces the
    // first, and ✕ closes it.
    it('opens one editor at a time: another epic replaces it, and the close button ends it', async () => {
        render('3');
        await settle();
        const forms = () => document.querySelectorAll('[data-testid="plan-editor-form-epic"]');
        const idOf = () => document.querySelector('[data-testid="plan-editor-identity"]').textContent;
        const targets = () => [...document.querySelectorAll('[data-act="rect"][data-stroked="0"]')];
        act(() => { targets().pop().click(); });
        await settle();
        expect(forms()).toHaveLength(1);
        const first = idOf();
        act(() => { targets()[0].click(); });
        await settle();
        expect(forms()).toHaveLength(1);
        expect(idOf()).not.toBe(first);
        act(() => { document.querySelector('[data-testid="plan-editor-close"]').click(); });
        expect(forms()).toHaveLength(0);
    });

    it('takes no onEpicFocus — an epic click never switches the panel', () => {
        const onEpicFocus = vi.fn();
        const payload = composedFixture({
            initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
            epics: [epic(10, 'Only')],
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <MemoryRouter>
                        <PipelinePlanVisualizer plan={adaptComposedPipeline(payload)}
                                                model={buildPlanModel(payload)} levelPref="3"
                                                pipeline={payload.pipeline} timezone="UTC"
                                                onEpicFocus={onEpicFocus} />
<PlanElementEditor />
                    </MemoryRouter>
                </QueryClientProvider>
            );
        });
        for (const b of document.querySelectorAll('[data-act]')) act(() => { b.click(); });
        expect(onEpicFocus).not.toHaveBeenCalled();
    });
});
