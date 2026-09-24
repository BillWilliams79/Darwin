// @vitest-environment jsdom
//
// req #3515 — /customer-releases is a place a build is displayed, so it carries
// the build's date/time: a `Built` grid column and a date line under each build
// in the Add/Edit dialog's Build select. Blank when built_at is NULL.
//
// The builds come through the REAL useAllBuilds hook with only the network
// stubbed, because the hook's `fields=` projection is itself part of the
// feature: a projection without built_at leaves every date blank while every
// formatter test stays green. DataGrid is replaced by a plain table (MUI X
// virtualizes columns away at jsdom's zero width). The stub applies the same
// valueGetter -> valueFormatter contract the real grid does (mirroring
// SwarmStartsPage.tokens.test.jsx), so the Built column's formatter is exercised
// rather than bypassed — it holds the RAW built_at and sorts on a parsed Date.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const columnsSeen = [];
vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    DataGrid: ({ rows, columns }) => (
        columnsSeen.splice(0, columnsSeen.length, ...columns) && null,
        <table data-testid="grid-stub">
            <thead>
                <tr>{columns.map(c => <th key={c.field}>{c.headerName}</th>)}</tr>
            </thead>
            <tbody>
                {rows.map(r => (
                    <tr key={r.id} data-testid={`grid-row-${r.id}`}>
                        {columns.map(c => {
                            if (c.field === 'actions') return <td key={c.field} data-field={c.field} />;
                            const got = c.valueGetter ? c.valueGetter(r[c.field], r, c) : r[c.field];
                            const shown = c.valueFormatter ? c.valueFormatter(got, r, c) : got;
                            return (
                                <td key={c.field} data-field={c.field}>
                                    {String(shown ?? '')}
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    ),
}));
vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));
vi.mock('../../hooks/factory/createEntityQueries', async (orig) => {
    const real = await orig();
    return { ...real, fetchEntity: vi.fn() };
});

import CustomerReleasesPage from '../CustomerReleasesPage';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import call_rest_api from '../../RestApi/RestApi';
import { fetchEntity } from '../../hooks/factory/createEntityQueries';

const URI = 'https://api.test/darwin_dev';

// Exemplar: build 38 (6.2.1.0) is NULL, build 39 (6.2.2.0) ran Sep 14 7:00 AM PT.
const BUILDS = [
    { id: 38, branch_fk: 24, build_number: 1, branch_number: 0, built_at: null },
    { id: 39, branch_fk: 24, build_number: 2, branch_number: 0, built_at: '2026-09-14 14:00:00.000000' },
];
const RELEASES = [
    { id: 7, customer_fk: 1, build_fk: 39, release_notes: 'dated', create_ts: '2026-09-18 14:00:00' },
    { id: 8, customer_fk: 1, build_fk: 38, release_notes: 'undated', create_ts: '2026-09-17 14:00:00' },
];

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <MemoryRouter>
            <QueryClientProvider client={client}>
                <AppContext.Provider value={{ darwinBuildVizUri: URI }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { id: 'creator-1', userName: 'creator-1' } }}>
                        <CustomerReleasesPage />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        </MemoryRouter>,
    );
}

const cell = (rowId, field) => within(screen.getByTestId(`grid-row-${rowId}`))
    .getAllByRole('cell').find(td => td.dataset.field === field);

beforeEach(() => {
    fetchEntity.mockReset();
    fetchEntity.mockImplementation(async (url) => {
        if (url.startsWith(`${URI}/builds`)) return BUILDS;
        if (url.startsWith(`${URI}/customer_releases`)) return RELEASES;
        if (url.startsWith(`${URI}/customers`)) return [{ id: 1, customer_name: 'HP' }];
        return [];
    });
    call_rest_api.mockReset();
    call_rest_api.mockResolvedValue({ httpStatus: { httpStatus: 200 }, data: [] });
});

afterEach(cleanup);

describe('CustomerReleasesPage — build date/time (req #3515)', () => {
    it('useAllBuilds projects built_at (without it every date is blank)', async () => {
        renderPage();
        await waitFor(() => expect(fetchEntity.mock.calls.some(([u]) => u.startsWith(`${URI}/builds`))).toBe(true));
        const url = fetchEntity.mock.calls.map(([u]) => u).find(u => u.startsWith(`${URI}/builds`));
        const fields = new URL(url).searchParams.get('fields').split(',');
        expect(fields).toContain('built_at');
    });

    it('shows a Built column right after Build, Pacific, blank when NULL', async () => {
        renderPage();
        await screen.findByTestId('grid-row-7');
        const headers = screen.getAllByRole('columnheader').map(th => th.textContent);
        expect(headers.indexOf('Built')).toBe(headers.indexOf('Build') + 1);
        await waitFor(() => expect(cell(7, 'build_built_at').textContent).toBe('Sep 14 7:00 AM'));
        expect(cell(7, 'build_label').textContent).toBe('#2');
        expect(cell(8, 'build_built_at').textContent).toBe('');
    });

    it('the Built column sorts CHRONOLOGICALLY, not alphabetically', async () => {
        // The bug this guards: the column used to hold the formatted string, so
        // the grid's own comparator ordered "Oct 1 7:00 AM" before "Sep 9 7:00 AM"
        // and "Sep 14 10:00 AM" before "Sep 14 7:00 AM". The Exemplar data hides
        // it (every day two digits, every time 7:00), so the fixture below is the
        // awkward set on purpose.
        renderPage();
        const grid = await screen.findByTestId('grid-stub');
        expect(grid).toBeTruthy();
        const built = columnsSeen.find(c => c.field === 'build_built_at');
        const raw = ['2026-10-01 14:00:00', '2026-09-14 17:00:00',
                     '2026-09-14 14:00:00', '2026-09-15 02:00:00',
                     '2026-09-09 14:00:00', null];
        const sorted = raw
            .map(v => ({ v, key: built.valueGetter(v, {}, built) }))
            .sort((a, b) => (a.key?.getTime() ?? -Infinity) - (b.key?.getTime() ?? -Infinity))
            .map(x => (x.key ? built.valueFormatter(x.key, {}, built) : ''));
        expect(sorted).toEqual([
            '', 'Sep 9 7:00 AM', 'Sep 14 7:00 AM', 'Sep 14 10:00 AM',
            'Sep 14 7:00 PM', 'Oct 1 7:00 AM',
        ]);
        expect(built.type).toBe('dateTime');
    });

    it('the Build select shows the date one line under each dated build', async () => {
        renderPage();
        await screen.findByTestId('grid-row-7');
        fireEvent.click(screen.getByTestId('release-add'));
        const select = within(screen.getByTestId('release-build-select')).getByRole('combobox');
        fireEvent.mouseDown(select);
        const listbox = await screen.findByRole('listbox');
        const dated = within(listbox).getByTestId('release-build-built-at-39');
        expect(dated.textContent).toBe('Sep 14 7:00 AM');
        expect(dated.previousElementSibling.textContent).toBe('#2 (id 39)');
        expect(within(listbox).queryByTestId('release-build-built-at-38')).toBeNull();
    });

    it('"Add release" is bookkeeping, not a live event: it does not stamp released_at', async () => {
        // Documented decision (memory/build-visualizer-design.md §3.2a). Only the
        // Build Visualizer's Perform release event records when a build shipped.
        renderPage();
        await screen.findByTestId('grid-row-7');
        fireEvent.click(screen.getByTestId('release-add'));
        fireEvent.mouseDown(within(screen.getByTestId('release-customer-select')).getByRole('combobox'));
        fireEvent.click(within(await screen.findByRole('listbox')).getByText('HP'));
        fireEvent.mouseDown(within(screen.getByTestId('release-build-select')).getByRole('combobox'));
        fireEvent.click(within(await screen.findByRole('listbox')).getByText('#2 (id 39)'));
        fireEvent.click(screen.getByTestId('release-save'));
        await waitFor(() => expect(call_rest_api).toHaveBeenCalled());
        const [url, method, body] = call_rest_api.mock.calls[0];
        expect([url, method]).toEqual([`${URI}/customer_releases`, 'POST']);
        expect(body).toEqual({ customer_fk: 1, build_fk: 39, release_notes: null });
    });
});
