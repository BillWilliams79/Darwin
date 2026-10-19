// @vitest-environment jsdom
//
// req #3658 — the Plan visualizer's maximize switch, the TPU 3D Full screen
// switch borrowed. Two halves are pinned here:
//
//   · the CANVAS half: the switch is on the canvas in both states and says
//     which one it is in; maximized, the key FOLDS to its + toggle (never
//     hidden — it still opens) and comes back as the reader left it; the
//     Orchestration Ready box is untouched;
//   · the HOOK half (`usePlanMaximize`): the switch, Esc, the browser's own
//     exit and leaving the Plan mode, plus the browser full screen it takes.
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
import { usePlanMaximize } from '../usePlanMaximize';

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
    const { maximized, toggle } = usePlanMaximize(enabled);
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

describe('the maximize switch on the canvas (req #3658)', () => {
    it('is drawn, as the maximize glyph, and clicks through to the page', () => {
        const onToggle = vi.fn();
        mount(<Viz maximized={false} onToggle={onToggle} />);
        const sw = q('pipeline-viz-maximize');
        expect(sw).not.toBeNull();
        expect(sw.getAttribute('aria-pressed')).toBe('false');
        expect(sw.getAttribute('aria-label')).toBe('Maximize the plan');
        expect(sw.getAttribute('data-viz-chrome')).toBe('maximize');
        act(() => { sw.click(); });
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('reads as restore while maximized', () => {
        mount(<Viz maximized onToggle={() => {}} />);
        const sw = q('pipeline-viz-maximize');
        expect(sw.getAttribute('aria-pressed')).toBe('true');
        expect(sw.getAttribute('aria-label')).toBe('Restore the page');
    });

    it('is absent when the page offers no toggle', () => {
        mount(<Viz maximized={false} onToggle={null} />);
        expect(q('pipeline-viz-maximize')).toBeNull();
    });

    it('folds an open key on the way in, keeps it openable, and restores it on the way out', () => {
        mount(<Viz maximized={false} onToggle={() => {}} />);
        act(() => { q('pipeline-viz-legend-toggle').click(); });       // the reader opens it
        expect(q('pipeline-viz-legend-toggle').getAttribute('aria-expanded')).toBe('true');

        act(() => { root.render(<Viz maximized onToggle={() => {}} />); });
        // Folded, not hidden: the panel and its + are still there.
        expect(q('pipeline-viz-legend')).not.toBeNull();
        expect(q('pipeline-viz-legend-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(q('pipeline-viz-legend-reqscale')).toBeNull();

        act(() => { q('pipeline-viz-legend-toggle').click(); });       // opens while maximized
        expect(q('pipeline-viz-legend-reqscale')).not.toBeNull();
        act(() => { q('pipeline-viz-legend-toggle').click(); });       // and folds again
        expect(q('pipeline-viz-legend-reqscale')).toBeNull();

        act(() => { root.render(<Viz maximized={false} onToggle={() => {}} />); });
        // Back as the reader left it — the folds made while maximized were not remembered.
        expect(q('pipeline-viz-legend-toggle').getAttribute('aria-expanded')).toBe('true');
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

describe('usePlanMaximize (req #3658)', () => {
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

    it('never exits a full screen it did not take', () => {
        fsEl = document.body;                       // somebody else's
        mount(<Page />);
        act(() => { q('switch').click(); });
        expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
        act(() => { q('switch').click(); });
        expect(document.exitFullscreen).not.toHaveBeenCalled();
    });
});
