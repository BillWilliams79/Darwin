// @vitest-environment jsdom
//
// req #3393 — the Pipeline 2.0 pipelines editor. Structural sibling of the
// other 2.0 page test files (see EpicsPage2.test.jsx's header for the
// DataGrid-stub rationale, copied rather than imported).
//
// What is pinned: the execution_mode chip toggles with a one-field PUT; the
// pipeline_status chip is DISPLAY ONLY (no click handler at all); the
// description dialog saves on blur and on close, writing to
// pipeline2_pipelines with the same staleness-guard shape
// PipelineDescriptionDialog uses for 1.0.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    DataGrid: ({ rows, columns }) => (
        <div data-testid="grid">
            {rows.map((row, index) => (
                <div key={row.id} data-testid={`grid-row-${row.id}`} data-index={index}>
                    {columns.map((col) => {
                        const raw = row[col.field];
                        const value = col.valueGetter ? col.valueGetter(raw, row, col) : raw;
                        const formatted = col.valueFormatter
                            ? col.valueFormatter(value, row, col) : value;
                        return (
                            <span key={col.field} data-testid={`cell-${col.field}-${row.id}`}>
                                {col.renderCell
                                    ? col.renderCell({ row, value, id: row.id, field: col.field })
                                    : String(formatted ?? '')}
                            </span>
                        );
                    })}
                </div>
            ))}
        </div>
    ),
}));

let pipelines;
let machines;
let loading;

vi.mock('../../hooks/factory/devopsQueries2', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines2: () => ({ data: pipelines, isLoading: loading.pipelines }),
    };
});

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMachines: () => ({ data: machines, isLoading: loading.machines }),
    };
});

const restCalls = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import PipelinesPage2 from '../PipelinesPage2';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <MemoryRouter initialEntries={['/swarm/pipelines2']}>
                <QueryClientProvider client={queryClient}>
                    <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                        <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                            <PipelinesPage2 />
                        </AuthContext.Provider>
                    </AppContext.Provider>
                </QueryClientProvider>
            </MemoryRouter>
        );
    });
    mountedRoots.push(root);
    return { container };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
// A `data-testid` on a multiline MUI TextField lands on the outer
// `.MuiFormControl-root`, not on either of its two <textarea> elements (a
// visible one plus MUI's hidden auto-sizing shadow, which carries
// `aria-hidden`) — so tests that need the field's `.value` query the visible
// textarea within it directly.
const textareaIn = (testId) =>
    document.body.querySelector(`[data-testid="${testId}"] textarea:not([aria-hidden="true"])`);
const click = (el) => act(() => { el.click(); });
const type = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});
// React's onBlur is implemented on the native 'focusout' event (which
// bubbles) rather than 'blur' (which does not) — dispatching a bare 'blur'
// never reaches React's synthetic handler.
const blur = (el) => act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
    restCalls.length = 0;
    mountedRoots = [];
    loading = { pipelines: false, machines: false };
    pipelines = [
        { id: 7, title: 'Plan Seven', description: 'Existing goal.', pipeline_status: 'active',
          execution_mode: 'parallel', machine_fk: 4, started_at: '2026-08-01 00:00:00', completed_at: null },
        { id: 8, title: 'Plan Eight', description: null, pipeline_status: 'draft',
          execution_mode: 'serial', machine_fk: null, started_at: null, completed_at: null },
    ];
    machines = [{ id: 4, title: 'Mac mini' }];
    useSnackBarStore.setState({ open: false, message: '' });
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('PipelinesPage2 rows', () => {
    it('renders every pipeline with its status and execution mode', () => {
        mount();
        expect(node('grid-row-7')).not.toBeNull();
        expect(node('grid-row-8')).not.toBeNull();
        expect(node('pipeline2-status-7').textContent).toBe('active');
        expect(node('pipeline2-execmode-chip-7').textContent).toBe('Parallel');
        expect(node('pipeline2-execmode-chip-8').textContent).toBe('Serial');
    });

    it('resolves the machine title, falling back to an em-dash when unset', () => {
        mount();
        expect(node('cell-machine_fk-7').textContent).toBe('Mac mini');
        expect(node('cell-machine_fk-8').textContent).toBe('—');
    });
});

describe('PipelinesPage2 execution_mode toggle', () => {
    it('flips parallel to serial with a one-field PUT', async () => {
        mount();
        click(node('pipeline2-execmode-chip-7'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_pipelines',
            method: 'PUT',
            body: [{ id: 7, execution_mode: 'serial' }],
        }]);
    });

    it('flips serial back to parallel', async () => {
        mount();
        click(node('pipeline2-execmode-chip-8'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 8, execution_mode: 'parallel' }]);
    });
});

describe('PipelinesPage2 status chip', () => {
    it('is a plain label with no click handler', () => {
        mount();
        const chip = node('pipeline2-status-7');
        // MUI's Chip only renders as a <button>/role="button" when it is
        // given an onClick — a plain <div> here proves no toggle was wired.
        expect(chip.tagName).not.toBe('BUTTON');
        expect(chip.getAttribute('role')).not.toBe('button');
    });
});

describe('PipelinesPage2 description dialog', () => {
    it('opens pre-filled with the existing description', () => {
        mount();
        click(node('pipeline2-description-btn-7'));
        expect(textareaIn('pipeline2-goal').value).toBe('Existing goal.');
    });

    it('opens empty for a pipeline with no description', () => {
        mount();
        click(node('pipeline2-description-btn-8'));
        expect(textareaIn('pipeline2-goal').value).toBe('');
    });

    it('saves on blur', async () => {
        mount();
        click(node('pipeline2-description-btn-7'));
        type(textareaIn('pipeline2-goal'), 'New goal text');
        blur(textareaIn('pipeline2-goal'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_pipelines',
            method: 'PUT',
            body: [{ id: 7, description: 'New goal text' }],
        }]);
    });

    it('saves unsaved text on Close even without a prior blur', async () => {
        mount();
        click(node('pipeline2-description-btn-8'));
        type(textareaIn('pipeline2-goal'), 'Closed without blur');
        // No blur() here on purpose — closeAndSave is the save path being tested.
        click(document.body.querySelector('[data-testid="pipeline2-description-dialog"] button'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_pipelines',
            method: 'PUT',
            body: [{ id: 8, description: 'Closed without blur' }],
        }]);
    });

    it('does not re-send an already-saved value on close', async () => {
        mount();
        click(node('pipeline2-description-btn-7'));
        type(textareaIn('pipeline2-goal'), 'Saved once');
        blur(textareaIn('pipeline2-goal'));
        await flush();
        click(document.body.querySelector('[data-testid="pipeline2-description-dialog"] button'));
        await flush();
        expect(restCalls.length).toBe(1);
    });
});
