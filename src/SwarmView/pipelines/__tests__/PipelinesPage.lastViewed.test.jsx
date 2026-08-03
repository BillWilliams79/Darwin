// @vitest-environment jsdom
//
// Req #3311 — "remember my last selected pipeline".
//
// The storage and lifecycle contracts are pinned by `scrollMemory.test.js` and
// `useScrollMemory.test.jsx`. What only an integration test can reach is the
// round trip the user actually performs: open a plan, come back, and SEE which
// one you were on. A page that recorded the id perfectly and rendered no mark
// would pass every unit test and deliver nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

const PIPELINES = [
    { id: 2, title: 'Darwin', pipeline_status: 'active', machine_fk: null },
    { id: 5, title: 'Substrate', pipeline_status: 'active', machine_fk: null },
];

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: () => ({ data: PIPELINES, isLoading: false, isError: false }),
        useAllPipelineSteps: empty,
        useAllPipelineStepRequirements: empty,
        useAllRequirements: empty,
        useMachines: empty,
        useOrchestrationClaims: empty,
    };
});

import PipelinesPage from '../PipelinesPage';
import AuthContext from '../../../Context/AuthContext';

const LAST_KEY = 'darwin-swarm-pipelines-last-opened';

let roots = [];

function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(
            <AuthContext.Provider value={{ profile: { userName: 'tester', timezone: 'UTC' } }}>
                <MemoryRouter initialEntries={['/swarm/pipelines']}>
                    <PipelinesPage />
                </MemoryRouter>
            </AuthContext.Provider>,
        );
    });
    roots.push(root);
    return { unmount: () => act(() => root.unmount()) };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const openCard = (id) => act(() => {
    node(`pipeline-card-${id}`).querySelector('button, [role="button"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

describe('PipelinesPage — the last selected pipeline', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        roots = [];
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        sessionStorage.clear();
        localStorage.clear();
    });

    it('marks nothing on a first-ever visit', () => {
        mount();
        expect(node('pipeline-card-2')).not.toBeNull();
        expect(node('pipeline-card-lastviewed-2')).toBeNull();
        expect(node('pipeline-card-lastviewed-5')).toBeNull();
    });

    it('records the plan it opens, and marks it on return', () => {
        const first = mount();
        openCard(5);
        first.unmount();
        document.body.innerHTML = '';

        mount();
        expect(node('pipeline-card-lastviewed-5')).not.toBeNull();
        // EXACTLY ONE mark. A predicate that matched loosely — a string id
        // against a numeric one, say — would light every card up and say
        // nothing at all.
        expect(node('pipeline-card-lastviewed-2')).toBeNull();
    });

    it('moves the mark when a different plan is opened', () => {
        const first = mount();
        openCard(5);
        openCard(2);
        first.unmount();
        document.body.innerHTML = '';

        mount();
        expect(node('pipeline-card-lastviewed-2')).not.toBeNull();
        expect(node('pipeline-card-lastviewed-5')).toBeNull();
    });

    // THE ASK'S OWN CONSTRAINT: "in local storage", and "this shouldn't affect
    // separate tabs". `useViewPreference` is both halves — the live value is
    // per-tab sessionStorage, and localStorage is only the seed a NEW tab starts
    // from, read once at its own mount.
    it('writes both the per-tab value and the new-tab seed', () => {
        mount();
        openCard(5);
        expect(sessionStorage.getItem(LAST_KEY)).toBe('5');
        expect(localStorage.getItem(LAST_KEY)).toBe('5');
    });

    it('marks the seeded plan in a tab that has never opened one', () => {
        // A brand-new tab: localStorage carries yesterday's choice, this tab's
        // sessionStorage is empty.
        localStorage.setItem(LAST_KEY, '2');
        mount();
        expect(node('pipeline-card-lastviewed-2')).not.toBeNull();
    });

    // The value indexes a row, so anything that is not an id must mark NOTHING
    // rather than match by accident. It comes out of web storage, so an older
    // build's value and a hand-typed one are both reachable.
    // `'0'` and `'  '` both parse to the NUMBER 0, which is not an id any row
    // carries — so they belong here with the junk rather than being trusted.
    it.each(['', '  ', '0', 'constructor', 'NaN', '{}', '5abc'])(
        'marks nothing for a stored %s', (raw) => {
            sessionStorage.setItem(LAST_KEY, raw);
            mount();
            expect(node('pipeline-card-lastviewed-2')).toBeNull();
            expect(node('pipeline-card-lastviewed-5')).toBeNull();
        });

    it('marks nothing when the remembered plan is no longer listed', () => {
        sessionStorage.setItem(LAST_KEY, '999');
        mount();
        // Asserted against the cards that EXIST. Looking for
        // `pipeline-card-lastviewed-999` could never fail — there is no row 999
        // to render one — so it would pass with the mark on every card.
        expect(node('pipeline-card-2')).not.toBeNull();
        expect(node('pipeline-card-lastviewed-2')).toBeNull();
        expect(node('pipeline-card-lastviewed-5')).toBeNull();
    });
});
