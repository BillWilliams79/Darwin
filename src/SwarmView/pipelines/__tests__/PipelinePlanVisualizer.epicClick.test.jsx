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
vi.mock('../../../Epics/epicsApi', async (orig) => ({
    ...(await orig()),
    updateEpic: (...a) => updateEpic(...a),
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const PANEL_W = 1200;
const PANEL_H = 700;
let root;
let restoreSize;

beforeEach(() => {
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
    const dialog = document.querySelector('[data-testid="epic-edit-dialog"]');
    expect(dialog).not.toBeNull();
    const id = Number(dialog.textContent.match(/Edit epic (\d+)/)?.[1]);
    expect([10, 11, 12, 13, 14, 15, 16, 17]).toContain(id);
    expect(document.querySelector('[data-testid="epic-title-input"]').value).toBe(`Epic ${id}`);
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
        const dialog = document.querySelector('[data-testid="epic-edit-dialog"]');
        const id = Number(dialog.textContent.match(/Edit epic (\d+)/)[1]);
        const input = document.querySelector('[data-testid="epic-title-input"]');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
                .set.call(input, 'Renamed');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => { document.querySelector('[data-testid="epic-save"]').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(updateEpic).toHaveBeenCalledWith(undefined, undefined, id,
            { title: 'Renamed', notes: 'NULL', run: 'auto', checkpoint: 1, not_before: 'NULL' });
    });

    // The second click of a quick double click on the title area lands on the
    // dialog's backdrop: it must not close the editor it just opened.
    it('a backdrop click right after opening is ignored; a later one closes the editor', async () => {
        render('3');
        await settle();
        const before = transform();
        act(() => {
            [...document.querySelectorAll('[data-act="rect"][data-stroked="0"]')].pop().click();
        });
        const backdropClick = () => act(() => {
            const container = document.querySelector('.MuiDialog-container');
            container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        backdropClick();
        const dialog = () => document.querySelector('[data-testid="epic-edit-dialog"]');
        expect(dialog()).not.toBeNull();
        expect(dialog().getAttribute('aria-hidden')).not.toBe('true');
        expect(transform()).toEqual(before);
        await settle();
        backdropClick();
        await settle();
        expect(dialog()).toBeNull();
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
                    </MemoryRouter>
                </QueryClientProvider>
            );
        });
        for (const b of document.querySelectorAll('[data-act]')) act(() => { b.click(); });
        expect(onEpicFocus).not.toHaveBeenCalled();
    });
});
