// @vitest-environment jsdom
//
// Req #3325 — the Swarm Start table shows Input / Cache Write / Cache Read /
// Output as real, visible columns (matching SwarmStartDetail's Token totals
// factors), Auto-Start and Turns are gone, and Requirements is 270px (25%
// narrower than the prior 360px).
//
// The DataGrid is STUBBED for the same reason StepsPage.test.jsx / EpicsPage
// stub it: jsdom gives every element a zero-size box, so the real grid
// virtualizes down to no cells. The stub runs each column through the real
// contract (valueGetter → valueFormatter → renderCell) so a column that
// mis-uses that contract still fails here — this is not a mock of the
// feature's logic, only of the virtualized-scrolling container around it.
//
// Row fixtures are the exact values seeded into darwin_dev.swarm_starts
// (ids 315-319) for manual UI review, so this test is checking the same
// numbers a human reviewer sees on screen.

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

let capturedColumns = null;

vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    DataGrid: ({ rows, columns }) => {
        capturedColumns = columns;
        return (
            <div data-testid="grid">
                {rows.map((row) => (
                    <div key={row.id} data-testid={`grid-row-${row.id}`}>
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
        );
    },
}));

// The exact rows seeded into darwin_dev.swarm_starts (ids 315-319) for manual
// UI review of this requirement.
const SEEDED_ROWS = [
    { id: 315, arguments: 'req 3325', ai_model: 'opus', effort: 'high', auto_start: 1,
      session_count: 1, wall_seconds: 800, turn_count: 22,
      tokens_input: 500, tokens_cache_write: 200000,
      tokens_cache_read: 8000000, tokens_output: 25000 },
    { id: 316, arguments: 'swarm 1 2 3 4', ai_model: 'sonnet', effort: 'medium', auto_start: 0,
      session_count: 4, wall_seconds: 2702, turn_count: 63,
      tokens_input: 256, tokens_cache_write: 806689,
      tokens_cache_read: 25671100, tokens_output: 84614 },
    { id: 317, arguments: '', ai_model: 'haiku', effort: 'low', auto_start: 0,
      session_count: 1, wall_seconds: 180, turn_count: 8,
      tokens_input: 100, tokens_cache_write: 5000,
      tokens_cache_read: 200000, tokens_output: 3000 },
    { id: 318, arguments: 'mapping deployed', ai_model: 'fable', effort: 'high', auto_start: 0,
      session_count: 2, wall_seconds: 3100, turn_count: 75,
      tokens_input: 1200, tokens_cache_write: 3000000,
      tokens_cache_read: 90000000, tokens_output: 150000 },
    { id: 319, arguments: 'issues darwin 8', ai_model: 'opus', effort: 'high', auto_start: 0,
      session_count: 1, wall_seconds: 600, turn_count: 18,
      tokens_input: null, tokens_cache_write: null,
      tokens_cache_read: null, tokens_output: null },
];

const EMPTY = [];
vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllSwarmStarts: () => ({ data: SEEDED_ROWS, isLoading: false }),
        useSessions: () => ({ data: EMPTY }),
        useAllSwarmStartSessions: () => ({ data: EMPTY }),
        useMachines: () => ({ data: EMPTY }),
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

const cellText = (container, field, id) =>
    container.querySelector(`[data-testid="cell-${field}-${id}"]`)?.textContent;

describe('SwarmStartsPage token columns render the seeded values (req #3325)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        capturedColumns = null;
        vi.clearAllMocks();
    });

    it('removes the Auto-Start and Turns columns entirely', () => {
        mount();
        const fields = capturedColumns.map((c) => c.field);
        expect(fields).not.toContain('auto_start');
        expect(fields).not.toContain('turn_count');
        const headers = capturedColumns.map((c) => c.headerName);
        expect(headers).not.toContain('Auto-Start');
        expect(headers).not.toContain('Turns');
    });

    it('narrows the Requirements column to 270 (25% off 360)', () => {
        mount();
        const reqCol = capturedColumns.find((c) => c.field === 'requirements_list');
        expect(reqCol.width).toBe(270);
    });

    it('shows Input / Cache Write / Cache Read / Output as real, labeled columns', () => {
        mount();
        const byField = Object.fromEntries(capturedColumns.map((c) => [c.field, c]));
        expect(byField.tokens_input.headerName).toBe('Input');
        expect(byField.tokens_cache_write.headerName).toBe('Cache Write');
        expect(byField.tokens_cache_read.headerName).toBe('Cache Read');
        expect(byField.tokens_output.headerName).toBe('Output');
    });

    it.each(SEEDED_ROWS.filter((r) => r.id !== 319))(
        'renders the exact seeded token counts for row $id ($ai_model)',
        (row) => {
            const { container } = mount();
            expect(cellText(container, 'tokens_input', row.id))
                .toBe(row.tokens_input.toLocaleString());
            expect(cellText(container, 'tokens_cache_write', row.id))
                .toBe(row.tokens_cache_write.toLocaleString());
            expect(cellText(container, 'tokens_cache_read', row.id))
                .toBe(row.tokens_cache_read.toLocaleString());
            expect(cellText(container, 'tokens_output', row.id))
                .toBe(row.tokens_output.toLocaleString());
        },
    );

    it('renders an em-dash in every token column for the all-null legacy row (id 319)', () => {
        const { container } = mount();
        expect(cellText(container, 'tokens_input', 319)).toBe('—');
        expect(cellText(container, 'tokens_cache_write', 319)).toBe('—');
        expect(cellText(container, 'tokens_cache_read', 319)).toBe('—');
        expect(cellText(container, 'tokens_output', 319)).toBe('—');
    });
});
