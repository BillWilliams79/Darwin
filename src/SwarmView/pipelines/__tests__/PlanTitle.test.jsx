// @vitest-environment jsdom
//
// Req #3853 — the plan's name in the header carries the initiative and epic
// names' gestures: a quick click opens the plan's single editor, a double click
// zooms to the active epics, a long press (or F2) renames in place; a click on
// the counts runs the zoom cycle. With no plan canvas (`onZoom` null) nothing
// offers a zoom.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (sel) => sel({ showError, showSuccess: vi.fn() }),
}));
const updatePipeline = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
vi.mock('../../../Pipelines/pipelinesApi', async (orig) => ({
    ...(await orig()),
    updatePipeline: (...a) => updatePipeline(...a),
}));

import PlanTitle from '../PlanTitle';
import PlanElementEditor from '../PlanElementEditor';
import { usePlanEditorStore } from '../../../stores/usePlanEditorStore';
import { LONG_PRESS_MS, DOUBLE_CLICK_MS } from '../planPressGesture';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
const PIPELINE = { id: 7, title: 'Agent Harness', description: 'Why', machine_fk: null, locked: 0 };

function mount({ pipeline = PIPELINE, onZoom = vi.fn(), countsText = '2  -  3/9' } = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'u1' } }}>
                    <AppContext.Provider value={{ darwinUri: 'https://api/darwin' }}>
                        <PlanTitle pipeline={pipeline} countsText={countsText} variant="h5"
                                   onZoom={onZoom} />
                        <PlanElementEditor />
                    </AppContext.Provider>
                </AuthContext.Provider>
            </QueryClientProvider>,
        );
    });
    return onZoom;
}

const node = (id) => document.querySelector(`[data-testid="${id}"]`);
const pointer = (type) => new PointerEvent(type, {
    bubbles: true, button: 0, isPrimary: true, clientX: 30, clientY: 20,
});
const tap = (el) => act(() => {
    el.dispatchEvent(pointer('pointerdown'));
    el.dispatchEvent(pointer('pointerup'));
});
const wait = (ms) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
    vi.useFakeTimers();
    usePlanEditorStore.setState({ current: null });
    showError.mockClear();
    updatePipeline.mockClear();
});
afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('the plan title (req #3853)', () => {
    it('keeps the header contract: the testid, no aria-label of its own, name then counts', () => {
        mount();
        const title = node('pipeline-title');
        expect(title.hasAttribute('aria-label')).toBe(false);
        expect(title.textContent).toBe('Agent Harness 2  -  3/9');
        expect(node('pipeline-title-name').textContent).toBe('Agent Harness');
        // The gestures are a DESCRIPTION, so the heading's name stays its text.
        expect(node('pipeline-title-name').hasAttribute('aria-label')).toBe(false);
        expect(node('pipeline-title-counts').hasAttribute('aria-label')).toBe(false);
        expect(node('pipeline-title-name').getAttribute('aria-description')).toMatch(/F2 to rename/);
    });

    it('Save in the editor writes only the changed field, once', async () => {
        mount();
        tap(node('pipeline-title-name'));
        wait(DOUBLE_CLICK_MS + 10);
        const input = node('plan-editor-field-title');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
                .set.call(input, 'Renamed plan');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(updatePipeline).toHaveBeenCalledTimes(1);
        expect(updatePipeline).toHaveBeenCalledWith('https://api/darwin', 'tok', 7,
            { title: 'Renamed plan' });
    });

    // req #3965 — a locked plan's authoring fields are frozen, but its STATUS
    // still writes (the gateway's lock-free set), so Save stays available.
    it('the editor of a locked plan freezes everything but the status', async () => {
        mount({ pipeline: { ...PIPELINE, locked: 1, pipeline_status: 'authoring' } });
        tap(node('pipeline-title-name'));
        wait(DOUBLE_CLICK_MS + 10);
        expect(node('plan-editor-field-title').disabled).toBe(true);
        expect(node('plan-editor-locked')).not.toBeNull();
        act(() => { node('plan-editor-status-orchestration_ready').click(); });
        await act(async () => { node('plan-editor-save').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(updatePipeline).toHaveBeenCalledWith('https://api/darwin', 'tok', 7,
            { pipeline_status: 'orchestration_ready' });
    });

    it('the editor offers all seven statuses, the stored one selected', () => {
        mount({ pipeline: { ...PIPELINE, pipeline_status: 'orchestrating' } });
        tap(node('pipeline-title-name'));
        wait(DOUBLE_CLICK_MS + 10);
        const group = node('plan-editor-status');
        expect(group.getAttribute('data-value')).toBe('orchestrating');
        expect([...group.querySelectorAll('[data-testid^="plan-editor-status-"]')]
            .map((el) => el.textContent)).toEqual(['Authoring', 'Authorized', 'Ready',
            'Running', 'Met', "Won't Fix", 'Deferred']);
        expect(node('plan-editor-status-orchestrating').getAttribute('aria-pressed')).toBe('true');
    });

    it('a quick click on the name opens the plan editor, seeded from the row', () => {
        const onZoom = mount();
        tap(node('pipeline-title-name'));
        expect(node('plan-editor-form-pipeline')).toBeNull();      // the double window is open
        wait(DOUBLE_CLICK_MS + 10);
        expect(node('plan-editor-form-pipeline')).not.toBeNull();
        expect(node('plan-editor-field-title').value).toBe('Agent Harness');
        expect(node('plan-editor-description').value).toBe('Why');
        expect(onZoom).not.toHaveBeenCalled();
    });

    it('a double click on the name zooms straight to the active epics', () => {
        const onZoom = mount();
        tap(node('pipeline-title-name'));
        tap(node('pipeline-title-name'));
        wait(DOUBLE_CLICK_MS + 10);
        expect(onZoom).toHaveBeenCalledTimes(1);
        expect(onZoom).toHaveBeenCalledWith({ deep: true });
        expect(node('plan-editor-form-pipeline')).toBeNull();
    });

    it('a click on the counts runs the zoom cycle; a double click goes deep', () => {
        const onZoom = mount();
        const counts = node('pipeline-title-counts');
        expect(counts.getAttribute('role')).toBe('button');
        tap(counts);
        wait(DOUBLE_CLICK_MS + 10);
        expect(onZoom).toHaveBeenLastCalledWith({ deep: false });
        tap(counts);
        tap(counts);
        expect(onZoom).toHaveBeenLastCalledWith({ deep: true });
        act(() => {
            counts.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(onZoom).toHaveBeenLastCalledWith({ deep: false });
        expect(onZoom).toHaveBeenCalledTimes(3);
    });

    it('a long press renames in place; Enter writes the new title', async () => {
        mount();
        const name = node('pipeline-title-name');
        act(() => { name.dispatchEvent(pointer('pointerdown')); });
        wait(LONG_PRESS_MS + 10);
        const input = node('pipeline-title-edit');
        expect(input).not.toBeNull();
        expect(node('pipeline-title').dataset.editing).toBe('true');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
                .set.call(input, '  Agent Harness 2 ');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(updatePipeline).toHaveBeenCalledWith('https://api/darwin', 'tok', 7,
            { title: 'Agent Harness 2' });
    });

    it('F2 opens the rename; an unchanged name writes nothing', async () => {
        mount();
        act(() => {
            node('pipeline-title-name').dispatchEvent(
                new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
        });
        const input = node('pipeline-title-edit');
        expect(input).not.toBeNull();
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await act(async () => { await Promise.resolve(); });
        expect(updatePipeline).not.toHaveBeenCalled();
        expect(node('pipeline-title-edit')).toBeNull();
    });

    it('a locked plan refuses the rename before any write', () => {
        mount({ pipeline: { ...PIPELINE, locked: 1 } });
        act(() => {
            node('pipeline-title-name').dispatchEvent(
                new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
        });
        expect(node('pipeline-title-edit')).toBeNull();
        expect(showError).toHaveBeenCalledWith('This pipeline is locked — unlock it first');
    });

    it('with no plan canvas, nothing offers a zoom and a click opens the editor at once', () => {
        mount({ onZoom: null });
        const counts = node('pipeline-title-counts');
        expect(counts.getAttribute('role')).toBeNull();
        expect(node('pipeline-title-name').getAttribute('aria-description')).not.toMatch(/zoom/);
        tap(node('pipeline-title-name'));
        expect(node('plan-editor-form-pipeline')).not.toBeNull();
    });
});
