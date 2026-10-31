// @vitest-environment jsdom
//
// req #4042 — the Pipeline group view wears the Topology 3-D viewer's chrome:
// ▾ Controls top-left (View, Calendar), ▾ Info top-right (the calendar's
// index, or the focused pipeline) and ▾ Help bottom-right, COLLAPSED by
// default. The scene and the reads are stubbed: the 3D drawing needs a real
// WebGL context and is verified in the browser.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const engine = {
    setModel: vi.fn(), setFocus: vi.fn(), preset: vi.fn(), setRotate: vi.fn(), dispose: vi.fn(),
    state: () => ({ preset: 'iso' }),
};
vi.mock('../pipelineGroupScene', () => ({
    webglAvailable: () => true,
    createPipelineGroupScene: () => engine,
}));
vi.mock('../../hooks/useDataQueries', () => ({
    useComposedPipelines: (ids) => ids.map(() => ({ isLoading: false, data: null })),
}));

const { default: PipelineGroupView } = await import('../PipelineGroupView');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pipelines = [
    { id: 1, title: 'Late plan', pipeline_status: 'orchestrating', sort_order: 2, started_at: '2026-10-26T12:00:00' },
    { id: 2, title: 'Early plan', pipeline_status: 'orchestrating', sort_order: 9, started_at: '2026-08-05T12:00:00' },
    { id: 3, title: 'Front plan', pipeline_status: 'authoring', sort_order: 1, started_at: null,
      create_ts: '2026-10-27T12:00:00' },
];

const q = (id) => document.querySelector(`[data-testid="${id}"]`);

describe('PipelineGroupView — the 3-D viewer chrome', () => {
    let root;
    let container;
    const onFocusChange = vi.fn();
    const render = (props = {}) => act(() => {
        root.render(<PipelineGroupView pipelines={pipelines} onFocusChange={onFocusChange}
                                       onOpen={() => {}} {...props} />);
    });
    beforeEach(() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('opens with Controls and Info open and Help folded to its header', () => {
        render();
        expect(q('pipelines-group-controls-collapse').getAttribute('aria-expanded')).toBe('true');
        expect(q('pipelines-group-info-collapse').getAttribute('aria-expanded')).toBe('true');
        expect(q('pipelines-group-help').dataset.open).toBe('false');
        expect(q('pipelines-group-help-collapse').getAttribute('aria-expanded')).toBe('false');
        act(() => q('pipelines-group-help-collapse').click());
        expect(q('pipelines-group-help').dataset.open).toBe('true');
        expect(q('pipelines-group-help-text').textContent).toMatch(/sort order/);
    });

    it('a panel header folds its panel', () => {
        render();
        expect(q('pipelines-group-calendar-week')).not.toBeNull();
        act(() => q('pipelines-group-controls-collapse').click());
        expect(q('pipelines-group-calendar-week')).toBeNull();
        expect(q('pipelines-group-fullscreen')).not.toBeNull();     // the switch stays with the header
        act(() => q('pipelines-group-info-collapse').click());
        expect(q('pipelines-group-legend')).toBeNull();
    });

    it('unfocused, the panel is just the status key — no duplicate listing', () => {
        render();
        expect(q('pipelines-group-calendar-index')).toBeNull();
        expect(q('pipelines-group-counts')).toBeNull();
        expect(q('pipelines-group-legend')).not.toBeNull();
        expect(q('pipelines-group-info').textContent).toMatch(/Status key/);
    });

    it('the Calendar row regroups the columns and is remembered', () => {
        render();
        expect(q('pipelines-group-stage').dataset.bucket).toBe('week');
        act(() => q('pipelines-group-calendar-month').click());
        expect(q('pipelines-group-stage').dataset.bucket).toBe('month');
        expect(localStorage.getItem('darwin-pipeline-group-calendar')).toBe('month');
        expect(engine.preset).toHaveBeenCalledWith('iso');   // the new calendar is framed again
    });

    it('a focused pipeline shows its date and its place in its column', () => {
        render({ focusId: 1 });
        const focus = q('pipelines-group-focus');
        expect(focus.textContent).toMatch(/Late plan/);
        expect(q('pipelines-group-focus-when').textContent).toBe('Started Oct 26, 2026');
        expect(focus.textContent).toMatch(/Week of Oct 25 · 2nd of 2 by sort order/);
    });

    // req #3965 — the focus panel's status chip is the plan's status editor;
    // its menu renders IN PLACE (a full-screen stage shows nothing portalled).
    it('a focused pipeline\'s status chip edits the status through onSetStatus', async () => {
        const onSetStatus = vi.fn(() => Promise.resolve(true));
        render({ focusId: 1, onSetStatus });
        const chip = q('pipelines-group-status-1');
        expect(chip.textContent).toBe('Running');
        act(() => { chip.click(); });
        const option = q('pipelines-group-status-1-option-met');
        expect(q('pipelines-group-info').contains(option)).toBe(true);
        await act(async () => { option.click(); });
        expect(onSetStatus).toHaveBeenCalledWith(pipelines[0], 'met');
    });
});
