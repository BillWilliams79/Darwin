// @vitest-environment jsdom
//
// req #3658 — the Plan visualizer's maximize switch, the TPU 3D Full screen
// switch borrowed; req #3793 — where it sits, by the user's rule (controls on
// screen → the controls' header row; none → the canvas's upper-left corner).
// Three parts are pinned here:
//
//   · the CANVAS half: NOT maximized the canvas draws no switch (the header row
//     holds it — `PipelineDetail.maximize.test.jsx`); MAXIMIZED it draws the
//     one switch in its UPPER-LEFT corner, as the restore glyph, above every
//     box that can be dragged there; the Orchestration Ready box is untouched;
//   · the CORNER's arithmetic: the switch sits inside the pinned time ruler's
//     strip, and the ruler's first date thins rather than run under it;
//   · the HOOK half (`useVisualizerMaximize`, shared with the Build and Swarm
//     visualizers): the switch, Esc, the browser's own exit and leaving the
//     Plan mode, the browser full screen it takes, and the navbar rack it
//     suspends while the page covers it.
//
// jsdom has no canvas, so react-konva is stubbed as in the key's own test.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    return {
        Stage: Stub, Layer: Stub, Group: Stub,
        Rect: () => null, Circle: () => null, Line: () => null,
        Text: () => null, Path: () => null,
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import { UNSEATED_FLOAT_Z } from '../UnorchestratedReqBox';
import { useVisualizerMaximize } from '../../../hooks/useVisualizerMaximize';
import { usePanelRackStore } from '../../../stores/usePanelRackStore';
import { MAXIMIZE_SWITCH, MAXIMIZE_SWITCH_Z, maximizeSwitchWorldRight } from '../planMaximize';
import { drawnRulerLabelKeys, rulerScreenBottom, RULER_LABEL_GAP } from '../pipelinePlanLayout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);

function mount(node) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(node); });
}

function Viz({ maximized, onToggle }) {
    const payload = composedFixture();
    return (
        <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter>
                <PipelinePlanVisualizer plan={adaptComposedPipeline(payload)}
                                        model={buildPlanModel(payload)}
                                        pipeline={payload.pipeline} timezone="UTC"
                                        maximized={maximized}
                                        onToggleMaximized={onToggle} />
            </MemoryRouter>
        </QueryClientProvider>
    );
}

// The page's half in miniature: the hook's state drives the canvas's prop.
function Page({ enabled = true }) {
    const { maximized, toggle } = useVisualizerMaximize(enabled);
    return (
        <div data-testid="page" data-maximized={String(maximized)}>
            <button type="button" data-testid="switch" onClick={toggle} />
        </div>
    );
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
    document.documentElement.style.overflow = '';
});

describe('the maximize switch on the canvas (req #3658, placed by req #3793)', () => {
    it('is NOT on the canvas while the page is not maximized — the header row holds it', () => {
        mount(<Viz maximized={false} onToggle={() => {}} />);
        expect(q('pipeline-viz-maximize')).toBeNull();
    });

    it('maximized, is the restore switch, ON the canvas, and clicks through to the page', () => {
        const onToggle = vi.fn();
        mount(<Viz maximized onToggle={onToggle} />);
        const sw = q('pipeline-viz-maximize');
        expect(sw).not.toBeNull();
        expect(q('pipeline-plan-visualizer').contains(sw)).toBe(true);
        expect(document.querySelectorAll('[data-testid="pipeline-viz-maximize"]')).toHaveLength(1);
        expect(sw.getAttribute('aria-pressed')).toBe('true');
        expect(sw.getAttribute('aria-label')).toBe('Restore the page');
        expect(sw.getAttribute('title')).toBe('Restore the page (Esc)');
        // d3-zoom and the bead hit test leave it alone.
        expect(sw.getAttribute('data-viz-chrome')).toBe('maximize');
        // The IN arrows — "come back".
        expect(sw.querySelector('path').getAttribute('d'))
            .toBe('M6 1v5H1M15 6h-5V1M10 15v-5h5M1 10h5v5');
        act(() => { sw.click(); });
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('maximized, sits in the canvas\'s UPPER-LEFT corner', () => {
        mount(<Viz maximized onToggle={() => {}} />);
        const cs = getComputedStyle(q('pipeline-viz-maximize'));
        expect(cs.position).toBe('absolute');
        expect(cs.left).toBe(`${MAXIMIZE_SWITCH.left}px`);
        expect(cs.top).toBe(`${MAXIMIZE_SWITCH.top}px`);
        expect(cs.right).toBe('');
        expect(cs.bottom).toBe('');
    });

    // req #3687 / #3721 — a placed Orchestrables box (UNSEATED_FLOAT_Z) and the
    // Active box (AnchoredPanel's 1250) can both be dragged over the corner;
    // the switch is the only way back on screen, so it stays above both — and
    // under MUI's modal layer, so a dialog still covers it.
    it('sits above the boxes that can be dragged over it, below the dialogs', () => {
        mount(<Viz maximized onToggle={() => {}} />);
        const z = Number(getComputedStyle(q('pipeline-viz-maximize')).zIndex);
        expect(z).toBe(MAXIMIZE_SWITCH_Z);
        expect(z).toBeGreaterThan(UNSEATED_FLOAT_Z);
        expect(z).toBeGreaterThan(1250);
        expect(z).toBeLessThan(1300);
    });

    it('is absent when the page offers no toggle', () => {
        mount(<Viz maximized onToggle={null} />);
        expect(q('pipeline-viz-maximize')).toBeNull();
    });

    it('leaves the Orchestration Ready box as it is', () => {
        mount(<Viz maximized={false} onToggle={() => {}} />);
        const before = q('pipeline-viz-unseated')?.outerHTML;
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        mount(<Viz maximized onToggle={() => {}} />);
        expect(before).toBeTruthy();
        expect(q('pipeline-viz-unseated')?.outerHTML).toBe(before);
    });
});

describe('the upper-left corner covers nothing (req #3793)', () => {
    // The epic names are clamped below the ruler's strip, and the strip is
    // never shorter than RULER_H (36): the switch ends above it at every zoom.
    it('fits inside the pinned ruler strip, so no epic name reaches it', () => {
        for (const k of [0.1, 0.25, 0.5, 0.8, 1, 2, 4]) {
            expect(MAXIMIZE_SWITCH.top + MAXIMIZE_SWITCH.h)
                .toBeLessThan(rulerScreenBottom({ x: 0, y: 0, k }));
        }
    });

    // The one ruler date that could begin under the switch is thinned, the
    // strip's own rule for a label with no room; panned clear, it is back.
    it('thins the ruler date that would start under it, and only that one', () => {
        const slots = [
            { key: 'a', showLabel: true, labelX: 10, labelW: 40 },
            { key: 'b', showLabel: true, labelX: 200, labelW: 40 },
        ];
        const t = { x: 0, y: 0, k: 1 };
        expect([...drawnRulerLabelKeys(slots, 1)]).toEqual(['a', 'b']);
        expect([...drawnRulerLabelKeys(slots, 1, maximizeSwitchWorldRight(t))]).toEqual(['b']);
        // Panned right until 'a' starts a gap clear of the switch: drawn again.
        const clear = MAXIMIZE_SWITCH.left + MAXIMIZE_SWITCH.w + RULER_LABEL_GAP - 10;
        expect([...drawnRulerLabelKeys(slots, 1,
            maximizeSwitchWorldRight({ x: clear, y: 0, k: 1 }))]).toEqual(['a', 'b']);
        // Zoomed out the reserve is in WORLD px: 36 screen px at k = 0.25 is 144.
        expect(maximizeSwitchWorldRight({ x: 0, y: 0, k: 0.25 }))
            .toBe((MAXIMIZE_SWITCH.left + MAXIMIZE_SWITCH.w) / 0.25);
    });

    it('reserves nothing on a degenerate transform', () => {
        expect(maximizeSwitchWorldRight(null)).toBe(-Infinity);
        expect(maximizeSwitchWorldRight({ x: 0, k: 0 })).toBe(-Infinity);
    });
});

describe('useVisualizerMaximize (req #3658, shared by req #3793)', () => {
    let fsEl;
    beforeEach(() => {
        fsEl = null;
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true, get: () => fsEl,
        });
        document.documentElement.requestFullscreen = vi.fn(() => {
            fsEl = document.documentElement;
            document.dispatchEvent(new Event('fullscreenchange'));
            return Promise.resolve();
        });
        document.exitFullscreen = vi.fn(() => {
            fsEl = null;
            document.dispatchEvent(new Event('fullscreenchange'));
            return Promise.resolve();
        });
    });
    afterEach(() => {
        delete document.fullscreenElement;
        delete document.documentElement.requestFullscreen;
        delete document.exitFullscreen;
    });

    const state = () => q('page').getAttribute('data-maximized');

    it('toggles, takes the browser full screen and gives it back', () => {
        mount(<Page />);
        expect(state()).toBe('false');
        act(() => { q('switch').click(); });
        expect(state()).toBe('true');
        expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
        // The lock is on <html>: <body>'s overflow is MUI's modal manager's.
        expect(document.documentElement.style.overflow).toBe('hidden');
        expect(document.body.style.overflow).toBe('');
        act(() => { q('switch').click(); });
        expect(state()).toBe('false');
        expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
        expect(document.documentElement.style.overflow).toBe('');
    });

    it('leaves on Esc, but not on an Esc something nearer already took', () => {
        vi.useFakeTimers();
        try {
            mount(<Page />);
            act(() => { q('switch').click(); });
            const taken = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
            taken.preventDefault();
            act(() => { window.dispatchEvent(taken); vi.runAllTimers(); });
            expect(state()).toBe('true');
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                vi.runAllTimers();
            });
            expect(state()).toBe('false');
        } finally { vi.useRealTimers(); }
    });

    it('lets a listener registered AFTER it take the Esc (a canvas remounted while maximized)', () => {
        vi.useFakeTimers();
        const later = (e) => { if (e.key === 'Escape') e.preventDefault(); };
        try {
            mount(<Page />);
            act(() => { q('switch').click(); });
            window.addEventListener('keydown', later);
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
                vi.runAllTimers();
            });
            expect(state()).toBe('true');
        } finally {
            window.removeEventListener('keydown', later);
            vi.useRealTimers();
        }
    });

    it('exits a full screen that lands after the page has gone', async () => {
        let enter;
        document.documentElement.requestFullscreen = vi.fn(() => new Promise((res) => {
            enter = () => {
                fsEl = document.documentElement;
                document.dispatchEvent(new Event('fullscreenchange'));
                res();
            };
        }));
        mount(<Page />);
        act(() => { q('switch').click(); });
        act(() => { root.unmount(); });
        root = null;
        expect(document.exitFullscreen).not.toHaveBeenCalled();
        enter();
        expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
        expect(fsEl).toBeNull();
    });

    it('a late refusal of an older request does not disown a newer one', async () => {
        const pending = [];
        document.documentElement.requestFullscreen = vi.fn(() => new Promise((res, rej) => {
            pending.push({ res, rej });
        }));
        mount(<Page />);
        act(() => { q('switch').click(); });            // request 1
        act(() => { q('switch').click(); });            // off before it lands
        act(() => { q('switch').click(); });            // request 2
        // Request 2 is granted, THEN request 1 is refused.
        act(() => {
            fsEl = document.documentElement;
            document.dispatchEvent(new Event('fullscreenchange'));
            pending[1].res();
        });
        await act(async () => { pending[0].rej(new Error('superseded')); });
        act(() => { q('switch').click(); });            // off: ours, so it is left
        expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    });

    it("leaves when the browser's own full screen ends", () => {
        mount(<Page />);
        act(() => { q('switch').click(); });
        act(() => {
            fsEl = null;
            document.dispatchEvent(new Event('fullscreenchange'));
        });
        expect(state()).toBe('false');
    });

    it('stays on the overlay alone when the browser refuses', () => {
        document.documentElement.requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')));
        mount(<Page />);
        act(() => { q('switch').click(); });
        expect(state()).toBe('true');
    });

    it('is released when the Plan mode goes away', () => {
        mount(<Page enabled />);
        act(() => { q('switch').click(); });
        act(() => { root.render(<Page enabled={false} />); });
        expect(state()).toBe('false');
        act(() => { root.render(<Page enabled />); });
        expect(state()).toBe('false');
    });

    // req #3735 — the page covers the navbar while maximized, so the rack is
    // suspended; the hook publishes it, so no covering page can forget it.
    it('suspends the navbar rack while maximized, and only then', () => {
        mount(<Page />);
        expect(usePanelRackStore.getState().covered).toBe(false);
        act(() => { q('switch').click(); });
        expect(usePanelRackStore.getState().covered).toBe(true);
        act(() => { q('switch').click(); });
        expect(usePanelRackStore.getState().covered).toBe(false);
        act(() => { q('switch').click(); });
        act(() => { root.unmount(); });
        root = null;
        expect(usePanelRackStore.getState().covered).toBe(false);
    });

    it('never exits a full screen it did not take', () => {
        fsEl = document.body;                       // somebody else's
        mount(<Page />);
        act(() => { q('switch').click(); });
        expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
        act(() => { q('switch').click(); });
        expect(document.exitFullscreen).not.toHaveBeenCalled();
    });
});
