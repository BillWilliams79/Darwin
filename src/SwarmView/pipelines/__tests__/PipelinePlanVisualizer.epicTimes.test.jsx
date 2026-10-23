// @vitest-environment jsdom
//
// Req #3825 — the epic cards' start / end times on the mounted canvas, and the
// toolbar's Time toggle that shows or hides them. jsdom has no canvas, so
// react-konva is stubbed: every Konva Text renders its string, which is enough
// to see whether the canvas drew a time.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    return {
        Stage: ({ children }) => <div><canvas data-testid="stage-canvas" />{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: () => null,
        Line: () => null,
        Text: ({ text }) => <span data-testid="konva-text">{text}</span>,
        Path: () => null, Circle: () => null, Shape: () => null,
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import { formatClock } from '../planEpicTimes';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import AppContext from '../../../Context/AppContext';
import AuthContext from '../../../Context/AuthContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
let restoreSize;

beforeEach(() => {
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
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

const SESSION_START = '2026-10-23 09:05:00.000000';   // the generic GET's format
const COMPLETED = '2026-10-23T16:40:00';               // the composed read's format

function payload() {
    return composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 0 }],
        epics: [{ id: 10, initiative_fk: 5, title: 'Design', run: 'auto', notes: null,
            not_before: null, checkpoint: 1, locked: 0 }],
        requirements: [{ id: 100, title: 'Do it', requirement_status: 'met',
            coordination_type: 'implemented', ai_model: 'opus', effort: 'high',
            machine_fk: null, tracking: 0, started_at: null, completed_at: COMPLETED }],
        epicRequirements: [{ epic_fk: 10, requirement_fk: 100 }],
    });
}

function render(showTimes) {
    const p = payload();
    const plan = adaptComposedPipeline(p, { firstStarts: new Map([[100, SESSION_START]]) });
    const model = buildPlanModel(p);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider
                        value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <MemoryRouter>
                            <PipelinePlanVisualizer plan={plan} model={model} levelPref="3"
                                                    pipeline={p.pipeline} timezone="UTC"
                                                    showTimes={showTimes} />
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
}

const texts = () => [...document.querySelectorAll('[data-testid="konva-text"]')]
    .map((el) => el.textContent);

describe('the epic cards\' start / end times on the canvas (req #3825)', () => {
    it('draws the start and the end when Time is on', () => {
        render(true);
        expect(texts()).toContain(formatClock(SESSION_START));
        expect(texts()).toContain(formatClock(COMPLETED));
    });

    it('draws neither when Time is off', () => {
        render(false);
        expect(texts()).not.toContain(formatClock(SESSION_START));
        expect(texts()).not.toContain(formatClock(COMPLETED));
        // …and the epic itself is still drawn: only the time line went.
        expect(texts().some((t) => t.includes('Design'))).toBe(true);
    });

    it('is on by default', () => {
        render(undefined);
        expect(texts()).toContain(formatClock(COMPLETED));
    });
});
