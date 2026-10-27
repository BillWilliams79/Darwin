// @vitest-environment jsdom
//
// Req #3888 — the Requirement Filer files into PRODUCTION from every build: on a
// dev server (page `darwinUri` = darwin_dev) FilerDataScope re-points the
// popups' `darwinUri` at `darwinOpsUri` with a cache of their own; in a
// production build it adds nothing. And a dev browser's persisted v2 filer
// state — darwin_dev ids — is dropped on its way to v3.

import { useContext } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';

import AppContext from '../../Context/AppContext';
import FilerDataScope, { filerQueryClient, useFilerFilesElsewhere } from '../filerScope';
import { migrateFilerState } from '../../stores/useRequirementFilerStore';

const DEV = 'https://api/eng/darwin_dev';
const PROD = 'https://api/eng/darwin';

function Probe() {
    const { darwinUri, database } = useContext(AppContext);
    const client = useQueryClient();
    const elsewhere = useFilerFilesElsewhere();
    return (
        <span data-testid="probe" data-uri={darwinUri} data-db={database}
              data-own-client={String(client === filerQueryClient)} data-elsewhere={String(elsewhere)} />
    );
}

const renderIn = (darwinUri, database) => render(
    <QueryClientProvider client={new QueryClient()}>
        <AppContext.Provider value={{ darwinUri, database, darwinOpsUri: PROD }}>
            <FilerDataScope><Probe /></FilerDataScope>
        </AppContext.Provider>
    </QueryClientProvider>,
);

afterEach(cleanup);

describe('FilerDataScope (req #3888)', () => {
    it('on a dev server the popups read and write production, with their own cache', () => {
        renderIn(DEV, 'darwin_dev');
        const p = screen.getByTestId('probe');
        expect(p.dataset.uri).toBe(PROD);
        expect(p.dataset.ownClient).toBe('true');
        expect(p.dataset.elsewhere).toBe('true');
        // The filed-from record still says what the PAGE was showing.
        expect(p.dataset.db).toBe('darwin_dev');
    });

    it('in a production build it adds nothing: same URI, the page\'s cache', () => {
        renderIn(PROD, 'darwin');
        const p = screen.getByTestId('probe');
        expect(p.dataset.uri).toBe(PROD);
        expect(p.dataset.ownClient).toBe('false');
        expect(p.dataset.elsewhere).toBe('false');
    });
});

describe('migrateFilerState (req #3888)', () => {
    const v2 = {
        show: true, open: false, dock: { h: 'l', x: 10, v: 't', y: 20, w: null, ht: null },
        filed: [{ id: 901, title: 'dev row' }], draft: { title: 'x', category_fk: 862 },
        savedId: 901, saved: { title: 'x' }, editorShow: true, reopened: true, orphaned: false,
        lastProjectId: 4, lastCategoryId: 862, captureStage: 'done',
        defaults: { ai_model: 'sonnet', effort: 'low', machine_fk: 2, tracking: 0 },
    };

    it('a dev build drops every darwin_dev id and keeps windows and enum settings', () => {
        const st = migrateFilerState(v2, 2, 'darwin_dev');
        expect(st.filed).toEqual([]);
        expect(st.draft).toBeNull();
        expect(st.savedId).toBeNull();
        expect(st.saved).toBeNull();
        expect(st.editorShow).toBe(false);
        expect(st.lastProjectId).toBeNull();
        expect(st.lastCategoryId).toBeNull();
        expect(st.defaults).toEqual({ ai_model: 'sonnet', effort: 'low', tracking: 0 });
        expect(st.show).toBe(true);
        expect(st.open).toBe(false);
        expect(st.dock).toEqual(v2.dock);
        expect(st.filedInto).toBe('darwin');
    });

    it('a production build keeps its ids — they were production\'s all along', () => {
        expect(migrateFilerState(v2, 2, 'darwin')).toEqual({ ...v2, filedInto: 'darwin' });
    });

    it('v3 state is left alone in any build', () => {
        expect(migrateFilerState(v2, 3, 'darwin_dev')).toEqual({ ...v2, filedInto: 'darwin' });
    });

    it('v2 state carrying the production mark — an older branch\'s round trip on a shared dev port — is kept', () => {
        const marked = { ...v2, filedInto: 'darwin' };
        expect(migrateFilerState(marked, 2, 'darwin_dev')).toEqual(marked);
    });

    it('a v1 store in a dev build gets both steps', () => {
        const st = migrateFilerState({ ...v2, editorMode: 'defaults' }, 1, 'darwin_dev');
        expect(st).not.toHaveProperty('editorMode');
        expect(st.draft).toBeNull();
        // The v1 step keeps only what is carried — no tracking flag since req #3982.
        expect(st.defaults).toEqual({ ai_model: 'sonnet', effort: 'low' });
    });
});
