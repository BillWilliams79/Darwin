// @vitest-environment jsdom
//
// TestCasesPage.jsx — req #3357 (code review coverage gap).
//
// The junction re-point (feature_test_cases -> requirement_test_cases) and the
// rebuilt link picker (a checkbox-per-feature list replaced by a search-and-
// select Autocomplete, item 9) shipped with no test file at all. Two real bugs
// reached review as a result:
//
//   1. The Autocomplete's typed text never cleared after a selection, so a
//      SECOND pick filtered `unlinkedOptions` (which no longer contains the
//      first pick) by leftover text and matched nothing.
//   2. `currentLinks={requirementsByTestCase[editTarget?.id] || []}` minted a
//      fresh array every render of the PAGE, and the dialog's reset effect
//      depended on it — so any unrelated re-render (a category chip click)
//      wiped every field the reader had just typed.
//
// This file pins both fixes directly, plus the ordinary link/unlink/save path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mirrors the real column contract closely enough to catch a signature error
// (the EpicsPage.test.jsx / StepsPage.test.jsx doctrine) — jsdom gives every
// DataGrid element a zero-size box, so the real grid virtualizes to nothing.
vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    DataGrid: ({ rows, columns }) => (
        <div data-testid="grid">
            {rows.map((row) => (
                <div key={row.id} data-testid={`grid-row-${row.id}`}>
                    {columns.map((col) => {
                        const raw = row[col.field];
                        const value = col.valueGetter ? col.valueGetter(raw, row, col) : raw;
                        return (
                            <span key={col.field} data-testid={`cell-${col.field}-${row.id}`}>
                                {col.renderCell
                                    ? col.renderCell({ row, value, id: row.id, field: col.field })
                                    : String(value ?? '')}
                            </span>
                        );
                    })}
                </div>
            ))}
        </div>
    ),
}));

let testCases;
let requirements;
let categories;
let links;
let loading;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllTestCases: () => ({ data: testCases, isLoading: loading.testCases }),
        useAllRequirements: () => ({ data: requirements, isLoading: loading.requirements }),
        useAllCategories: () => ({ data: categories, isLoading: loading.categories }),
        useAllRequirementTestCaseLinks: () => ({ data: links, isLoading: loading.links }),
    };
});

const restCalls = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        if (method === 'POST' && uri.includes('/test_cases')) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [{ id: 999, ...body }] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import TestCasesPage from '../TestCasesPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { useTestCatalogFilterStore } from '../../stores/useTestCatalogFilterStore';

let mountedRoots = [];

function mount() {
    sessionStorage.clear();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <TestCasesPage />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
    return { container };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const click = (el) => act(() => { el.click(); });
const type = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

// The Autocomplete's popper renders in a PORTAL on document.body and opens as
// soon as its input carries text with matching options (no explicit open
// call needed) — the same reason `RequirementDetail.orchestration.test.jsx`
// dispatches on the real trigger rather than trusting a bare `.click()`.
const linkOptions = () => Array.from(document.querySelectorAll('[role="option"]'));

async function pickRequirement(label) {
    const input = node('requirement-link-search');
    type(input, label);
    await flush();
    const hit = linkOptions().find((o) => o.textContent.includes(label));
    if (!hit) throw new Error(`no option containing "${label}" in [${linkOptions().map(o => o.textContent).join(', ')}]`);
    await act(async () => { hit.click(); });
    await flush();
}

function baseTestCase(overrides = {}) {
    return {
        id: 10, title: 'Existing case', preconditions: null, steps: 'Do a thing',
        expected: 'It works', test_type: 'manual', tags: null, category_fk: 1,
        closed: 0, sort_order: 1, create_ts: '2026-08-01 00:00:00',
        ...overrides,
    };
}

describe('TestCasesPage — the requirement link picker (req #3357)', () => {
    beforeEach(() => {
        restCalls.length = 0;
        mountedRoots = [];
        loading = { testCases: false, requirements: false, categories: false, links: false };
        testCases = [baseTestCase()];
        requirements = [
            { id: 100, title: 'Alpha' },
            { id: 101, title: 'Beta' },
            { id: 102, title: 'Gamma' },
        ];
        categories = [{ id: 1, category_name: 'Swarm', color: null, project_fk: 1, closed: 0 }];
        links = [{ test_case_fk: 10, requirement_fk: 100 }];
        useSnackBarStore.setState({ open: false, message: '' });
        useTestCatalogFilterStore.setState({ categoryFilter: null });
    });

    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('preloads the existing links as removable chips, by title', async () => {
        mount();
        click(node('grid-row-10').querySelector('[aria-label="Edit test case"]'));
        await flush();
        expect(node('link-requirement-100').textContent)
            .toContain('Alpha');
        expect(node('link-requirement-101')).toBeNull();
    });

    // CRITICAL FIX 1 (code review): the input used to keep the just-picked
    // label after a selection, which then filtered the (now-narrower)
    // options list down to nothing — the second requirement could not be
    // linked without first clearing the field by hand.
    it('clears the search field after a pick, so a second requirement can be linked immediately', async () => {
        mount();
        click(node('new-test-case-btn'));
        await flush();

        await pickRequirement('Beta');
        expect(node('requirement-link-search').value).toBe('');
        expect(node('link-requirement-101')).not.toBeNull();

        // The regression: without the fix this throws (no matching option) —
        // 'Gamma' would still be filtered by 'Beta' text stuck in the field.
        await pickRequirement('Gamma');
        expect(node('link-requirement-102')).not.toBeNull();
    });

    it('never re-offers an already-linked requirement in the search results', async () => {
        mount();
        click(node('new-test-case-btn'));
        await flush();
        await pickRequirement('Alpha');

        const input = node('requirement-link-search');
        type(input, 'Alpha');
        await flush();
        expect(linkOptions().some((o) => o.textContent.includes('Alpha'))).toBe(false);
    });

    it('removes a link when its chip is deleted', async () => {
        mount();
        click(node('grid-row-10').querySelector('[aria-label="Edit test case"]'));
        await flush();
        act(() => {
            node('link-requirement-100').querySelector('svg')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        expect(node('link-requirement-100')).toBeNull();
    });

    // CRITICAL FIX 2 (code review): `currentLinks` used to be a fresh `[]`
    // literal at the call site whenever the target test case had no links —
    // always true in Add mode — and the dialog's reset effect depended on
    // that reference, so ANY re-render of the page (not just ones caused by
    // the dialog) wiped every field already typed.
    it('does not reset typed fields when the page re-renders for an unrelated reason', async () => {
        mount();
        click(node('new-test-case-btn'));
        await flush();

        type(node('test-case-title-input'), 'My draft title');
        await flush();
        expect(node('test-case-title-input').value).toBe('My draft title');

        // A category filter chip click re-renders TestCasesPage top to bottom
        // — nothing to do with the dialog — while the dialog stays open.
        click(node('category-chip-1'));
        await flush();

        expect(node('test-case-title-input').value).toBe('My draft title');
    });

    it('does not reset a picked link when the page re-renders for an unrelated reason', async () => {
        mount();
        click(node('new-test-case-btn'));
        await flush();
        await pickRequirement('Alpha');
        expect(node('link-requirement-100')).not.toBeNull();

        click(node('category-chip-1'));
        await flush();

        expect(node('link-requirement-100')).not.toBeNull();
    });

    it('saves the create with the diffed links as one POST plus one link call', async () => {
        testCases = [];
        links = [];
        mount();
        click(node('new-test-case-btn'));
        await flush();
        type(node('test-case-title-input'), 'New case');
        type(node('test-case-steps-input'), 'Step 1');
        type(node('test-case-expected-input'), 'Outcome');
        await pickRequirement('Beta');
        click(node('test-case-save-btn'));
        await flush();

        const post = restCalls.find((c) => c.method === 'POST' && c.uri.endsWith('/test_cases'));
        expect(post).toBeTruthy();
        expect(post.body.title).toBe('New case');
        const link = restCalls.find((c) => c.uri.endsWith('/requirement_test_cases') && c.method === 'POST');
        expect(link.body).toEqual({ requirement_fk: 101, test_case_fk: 999 });
    });

    it('saves an edit as unlink-only when a chip was removed and nothing added', async () => {
        mount();
        click(node('grid-row-10').querySelector('[aria-label="Edit test case"]'));
        await flush();
        act(() => {
            node('link-requirement-100').querySelector('svg')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        click(node('test-case-save-btn'));
        await flush();

        const junctionCalls = restCalls.filter((c) => c.uri.endsWith('/requirement_test_cases'));
        expect(junctionCalls).toEqual([{
            uri: 'http://test.local/darwin/requirement_test_cases',
            method: 'DELETE',
            body: { requirement_fk: 100, test_case_fk: 10 },
        }]);
    });

    it('renders a linked requirement missing from the current read as its bare id, not a blank chip', async () => {
        links = [{ test_case_fk: 10, requirement_fk: 9999 }];
        mount();
        click(node('grid-row-10').querySelector('[aria-label="Edit test case"]'));
        await flush();
        expect(node('link-requirement-9999').textContent)
            .toContain('#9999');
    });
});
