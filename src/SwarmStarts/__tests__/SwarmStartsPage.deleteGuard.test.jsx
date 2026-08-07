// @vitest-environment jsdom
//
// Req #3265 code review (re-verify pass, finding 2) — SwarmStartDeleteDialog.test.jsx
// covers the dialog's own contract, but the C2 bug never lived in the dialog: it
// lived in the WIRING that computes `linkedLoading` from `useSessions` /
// `useAllSwarmStartSessions` and threads it down from SwarmStartsPage. Deleting
// that prop from the page leaves every dialog-level test green, because the
// prop defaults to `false`. This file mounts the real page (DataGrid stubbed,
// same technique as SwarmStartsPage.tokens.test.jsx) so a regression in the
// wiring itself — not just the dialog — fails a test.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => () => {},
}));

vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    DataGrid: ({ rows, columns }) => (
        <div data-testid="grid">
            {rows.map((row) => (
                <div key={row.id} data-testid={`grid-row-${row.id}`}>
                    {columns.map((col) => (
                        <span key={col.field} data-testid={`cell-${col.field}-${row.id}`}>
                            {col.renderCell
                                ? col.renderCell({ row, id: row.id, field: col.field })
                                : String(row[col.field] ?? '')}
                        </span>
                    ))}
                </div>
            ))}
        </div>
    ),
}));

const ROW = { id: 42, arguments: '3251', ai_model: 'opus', effort: 'high',
               auto_start: 1, session_count: 1, wall_seconds: 10, turn_count: 1,
               tokens_input: 1, tokens_output: 1, tokens_cache_read: 1, tokens_cache_write: 1 };
// The linked session this row is tied to — the guard's whole reason to exist.
const LINKED_SESSION = { id: 900 };
const LINKED_JUNCTION_ROW = { swarm_start_fk: 42, session_fk: 900 };

let dataQueriesMock;
vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllSwarmStarts: () => ({ data: [ROW], isLoading: false }),
        useSessions: (...args) => dataQueriesMock.useSessions(...args),
        useAllSwarmStartSessions: (...args) => dataQueriesMock.useAllSwarmStartSessions(...args),
        useMachines: () => ({ data: [] }),
    };
});

import SwarmStartsPage from '../SwarmStartsPage';
import AuthContext from '../../Context/AuthContext';

let roots = [];
function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AuthContext.Provider value={{ profile: { userName: 'tester', timezone: 'UTC' } }}>
                    <SwarmStartsPage />
                </AuthContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});

// Dialog renders via portal onto document.body, so lookups are document-wide.
const openDeleteDialogFor = (container, rowId) => {
    const btn = container.querySelector(
        `[data-testid="cell-actions-${rowId}"] [data-testid="btn-delete-swarm-start-${rowId}"]`);
    click(btn);
};
const confirmBtn = () => document.querySelector('[data-testid="btn-confirm-delete-swarm-start"]');

describe('SwarmStartsPage delete-guard wiring (req #3265)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('disables Delete while the sessions/junction queries are still loading, even though the ' +
       'row has no linked sessions in the not-yet-arrived data', () => {
        dataQueriesMock = {
            useSessions: () => ({ data: undefined, isLoading: true, isError: false }),
            useAllSwarmStartSessions: () => ({ data: undefined, isLoading: true, isError: false }),
        };
        const { container } = mount();
        openDeleteDialogFor(container, 42);

        expect(confirmBtn().disabled).toBe(true);
    });

    it('disables Delete when the sessions query has settled into an error state (finding 1: ' +
       'isLoading alone is false once a query errors, so isError must gate it too)', () => {
        dataQueriesMock = {
            useSessions: () => ({ data: undefined, isLoading: false, isError: true }),
            useAllSwarmStartSessions: () => ({ data: [], isLoading: false, isError: false }),
        };
        const { container } = mount();
        openDeleteDialogFor(container, 42);

        expect(confirmBtn().disabled).toBe(true);
    });

    it('disables Delete when the junction query has settled into an error state', () => {
        dataQueriesMock = {
            useSessions: () => ({ data: [], isLoading: false, isError: false }),
            useAllSwarmStartSessions: () => ({ data: undefined, isLoading: false, isError: true }),
        };
        const { container } = mount();
        openDeleteDialogFor(container, 42);

        expect(confirmBtn().disabled).toBe(true);
    });

    it('enables Delete once both queries have settled successfully with no link found', () => {
        dataQueriesMock = {
            useSessions: () => ({ data: [], isLoading: false, isError: false }),
            useAllSwarmStartSessions: () => ({ data: [], isLoading: false, isError: false }),
        };
        const { container } = mount();
        openDeleteDialogFor(container, 42);

        expect(confirmBtn().disabled).toBe(false);
    });

    it('disables Delete once both queries have settled and a link IS found', () => {
        dataQueriesMock = {
            useSessions: () => ({ data: [LINKED_SESSION], isLoading: false, isError: false }),
            useAllSwarmStartSessions: () => ({ data: [LINKED_JUNCTION_ROW], isLoading: false, isError: false }),
        };
        const { container } = mount();
        openDeleteDialogFor(container, 42);

        expect(confirmBtn().disabled).toBe(true);
    });
});
