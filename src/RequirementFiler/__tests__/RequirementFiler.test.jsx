// @vitest-environment jsdom
//
// Req #3811 — the Requirement Filer: an Action Popup opened from the navbar
// whose one button opens the popup requirement editor; the editor's first
// Save POSTs the requirement, shows its id as a link, and later Saves PUT it.
// Req #3812 — its DEFAULTS: the same editor without title/description, kept per
// browser, applied to every Requirement (seat included), stale ones not.
// Req #3813 — FILE records where it was filed (URL, options, state, popup
// location) — since req #3815 the `filedFrom` category of its debug capture.
// Req #3815 — one FILE button; the first save is the press, every change after
// it saves itself (LIVE_SAVE_MS). The capture's own paths are tested in
// RequirementFilerCapture.test.jsx; here it is switched OFF (it "throws", so
// the requirement files without one) except in the #3813 block, which reads it.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

vi.mock('../../hooks/useDataQueries', () => ({
    useProjects: () => projectsQ,
    useCategories: (_u, projectId) => ({
        data: projectId === 4 ? [{ id: 862, category_name: 'Swarm', project_fk: 4 }] : undefined,
    }),
    useMachines: () => ({ data: [{ id: 2, title: 'Mac', sort_order: 1 }, { id: 3, title: 'Old PC', closed: 1 }] }),
    useDevServers: () => ({ data: [] }),
    // The seat's plan layer: plan 2 is active (initiative 30 → epics 300, 301), plan 5
    // is completed (initiative 50 → epic 500).
    useAllPipelines: () => q([{ id: 2, title: 'Plan A', pipeline_status: 'active' },
        { id: 5, title: 'Plan Done', pipeline_status: 'completed' }]),
    useAllInitiatives: () => q([{ id: 30, title: 'Initiative One', pipeline_fk: 2, closed: 0, sort_order: 1 },
        { id: 50, title: 'Old Initiative', pipeline_fk: 5, closed: 0 }]),
    useAllPipelineEpics: () => q([{ id: 300, title: 'Build', initiative_fk: 30 },
        { id: 301, title: 'Ship', initiative_fk: 30 }, { id: 500, title: 'Gone', initiative_fk: 50 }]),
    useAllPipelineEpicRequirements: () => q([]),
}));
const q = (data) => ({ data, isPending: false, isLoading: false, isError: false });
let desktop = true;
// The open-projects read, swappable per test (pending, failed).
const PROJECTS = { data: [{ id: 4, project_name: 'Darwin', sort_order: 1 }] };
let projectsQ = PROJECTS;
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => desktop }));
const rest = vi.fn();
vi.mock('../../RestApi/RestApi', () => ({ default: (...a) => rest(...a) }));
// The capture, off unless a block turns it on (see the header).
let captureOn = false;
vi.mock('../debugBundle', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, buildDebugCapture: (...a) => (captureOn ? real.buildDebugCapture(...a)
        : Promise.reject(new Error('capture off in this suite'))) };
});

import RequirementFiler, { CREATE_WAIT_MS, FILER_RACK_ID, createSettled } from '../RequirementFiler';
import RequirementEditorPopup from '../RequirementEditorPopup';
import NavBarSidebar from '../../NavBar/NavBarSidebar';
import { useRequirementFilerStore } from '../../stores/useRequirementFilerStore';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import ThemeContext from '../../Theme/ThemeContext';
import { registerPageOptions } from '../filedFromContext';
import { draftDirty } from '../requirementFilerModel';

const ok = (data) => ({ data, httpStatus: { httpStatus: 200, httpMessage: 'OK' } });

const renderAll = ({ nav = false, at = '/maps' } = {}) => render(
    <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={{ idToken: 't', profile: { userName: 'u', app_swarm: 1 } }}>
            <AppContext.Provider value={{ darwinUri: 'https://api/darwin_dev', database: 'darwin_dev' }}>
                <ThemeContext.Provider value={{ themeMode: 'system', effectiveMode: 'dark', setThemeMode: () => {} }}>
                    <MemoryRouter initialEntries={[at]}>
                        {nav && <NavBarSidebar />}
                        <RequirementFiler />
                        <RequirementEditorPopup />
                    </MemoryRouter>
                </ThemeContext.Provider>
            </AppContext.Provider>
        </AuthContext.Provider>
    </QueryClientProvider>
);

// The seat and the repos are set in Defaults only (req #3815); a draft's own are set through the store.
const setDraft = (patch) => act(() => useRequirementFilerStore.getState().setFields(patch));
// Whether the editor holds anything not yet sent.
const unsent = () => { const { draft, savedId, saved } = useRequirementFilerStore.getState(); return draftDirty(draft, savedId, saved); };
// A filed requirement's change saves itself within LIVE_SAVE_MS.
const LIVE = { timeout: 3000 };

// Create closes the editor at the press (req #3860). Once the create filing
// `id` has landed — its capture too — the editor is brought back, as a click on
// its row in the filer would, to look at what was filed.
const filedThenShown = async (id) => {
    expect(screen.queryByTestId('requirement-editor')).toBe(null);
    await waitFor(() => {
        const st = useRequirementFilerStore.getState();
        expect(st.savedId).toBe(id);
        expect(st.creating).toBe(null);
    });
    act(() => useRequirementFilerStore.getState().setEditorShow(true));
    expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe(String(id));
};
// A chip row (Status, Autonomy, Model, Effort, Machine) is clicked; a list or text is changed.
const fill = (testid, value) => {
    const el = screen.getByTestId(`requirement-editor-field-${testid}`);
    if (el.getAttribute('data-chips')) {
        fireEvent.click(screen.getByTestId(`requirement-editor-field-${testid}-${value === '' ? 'any' : value}`));
    } else {
        fireEvent.change(el, { target: { value } });
    }
};

describe('Requirement Filer (req #3811)', () => {
    beforeEach(() => {
        captureOn = false;
        desktop = true;
        projectsQ = PROJECTS;
        localStorage.clear();
        rest.mockReset();
        usePanelRackStore.setState({ racked: [], seeded: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        useRequirementFilerStore.setState({
            show: false, open: true, dock: null, editorShow: false, editorOpen: true, editorDock: null,
            draft: null, savedId: null, saved: null, lastProjectId: null, lastCategoryId: null,
            draftKey: 0, orphaned: false, focusPending: false, creating: null, defaults: {}, filed: [],
        });
    });
    afterEach(cleanup);

    it('opens from the navbar control and is an Action Popup like the others', () => {
        renderAll({ nav: true });
        expect(screen.queryByTestId('requirement-filer')).toBe(null);
        const control = screen.getByTestId('navbar-requirement-filer');
        expect(control.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(control);
        const panel = screen.getByTestId('requirement-filer');
        expect(panel.getAttribute('data-rack-id')).toBe(FILER_RACK_ID);
        expect(screen.getByTestId('requirement-filer-title').textContent).toBe('Requirement');
        expect(screen.getByTestId('requirement-filer-toggle')).toBeTruthy();
        // The + creates (req #3830); the body lists what it filed — nothing yet, and says nothing.
        expect(screen.getByTestId('requirement-filer-add').tagName).toBe('BUTTON');
        expect(screen.getByTestId('requirement-filer-list').textContent).toBe('');
        expect(screen.queryByTestId('requirement-filer-bug')).toBe(null);
        expect(screen.queryByTestId('requirement-filer-defaults')).toBe(null);
        expect(control.getAttribute('aria-pressed')).toBe('true');
        // × closes it; the control opens it again.
        fireEvent.click(screen.getByTestId('requirement-filer-close'));
        expect(screen.queryByTestId('requirement-filer')).toBe(null);
        fireEvent.click(control);
        expect(screen.getByTestId('requirement-filer')).toBeTruthy();
    });

    it('racks into the navbar and folds like every other Action Popup', () => {
        renderAll({ nav: true });
        fireEvent.click(screen.getByTestId('navbar-requirement-filer'));
        act(() => usePanelRackStore.getState().rack(FILER_RACK_ID, 0));
        const panel = screen.getByTestId('requirement-filer');
        expect(panel.getAttribute('data-racked')).toBe('1');
        expect(screen.getByTestId('navbar-rack-slot').contains(panel)).toBe(true);
        fireEvent.click(screen.getByTestId('requirement-filer-toggle'));
        expect(screen.getByTestId('requirement-filer-body').getAttribute('data-folded')).toBe('1');
        expect(useRequirementFilerStore.getState().open).toBe(false);
    });

    it('the + creates a requirement, open or folded; folded it follows REQUIREMENT (req #3830)', () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        // No badge slot: the title sits against the ▾. No Create body any more.
        const header = () => screen.getByTestId('requirement-filer-header');
        const order = () => [...header().children].map(c => c.getAttribute('data-testid'));
        expect(order().slice(0, 2)).toEqual(['requirement-filer-toggle', 'requirement-filer-title']);
        expect(screen.queryByTestId('requirement-filer-badge')).toBe(null);
        expect(screen.queryByTestId('requirement-filer-new')).toBe(null);
        // Open: + then × at the far right.
        const plusThenClose = () => {
            const add = screen.getByTestId('requirement-filer-add');
            const actions = header().children[2];
            expect(actions.contains(add)).toBe(true);
            expect(add.compareDocumentPosition(screen.getByTestId('requirement-filer-close'))
                & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            return add;
        };
        fireEvent.click(plusThenClose());
        expect(screen.getByTestId('requirement-editor')).toBeTruthy();
        // Folded: ▸ REQUIREMENT + ×.
        act(() => useRequirementFilerStore.setState({ editorShow: false }));
        fireEvent.click(screen.getByTestId('requirement-filer-toggle'));
        fireEvent.click(plusThenClose());
        expect(screen.getByTestId('requirement-editor')).toBeTruthy();
        expect(document.activeElement).toBe(screen.getByTestId('requirement-editor-field-title'));
        // The filer stays folded.
        expect(useRequirementFilerStore.getState().open).toBe(false);
    });

    it('a new requirement with no place starts in the Darwin project (req #3830)', () => {
        useRequirementFilerStore.setState({ show: true });
        projectsQ = q([{ id: 9, project_name: 'Other', sort_order: 1 }, { id: 4, project_name: 'Darwin', sort_order: 2 }]);
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.getByTestId('requirement-editor-field-project').value).toBe('4');
        expect(screen.getByTestId('requirement-editor-field-category').disabled).toBe(false);
        // Still a choice: another project can be picked, and stays picked.
        fill('project', '9');
        expect(useRequirementFilerStore.getState().draft.projectId).toBe(9);
        // A place carried from the last requirement is not overridden.
        act(() => useRequirementFilerStore.setState({ editorShow: false, lastProjectId: 9, lastCategoryId: null }));
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(useRequirementFilerStore.getState().draft.projectId).toBe(9);
    });

    it('lists what it filed; a click brings one back into the editor, read fresh (req #3830)', async () => {
        useRequirementFilerStore.setState({ show: true, filed: [{ id: 3999, title: 'Old title' }, { id: 3998, title: 'Gone' }] });
        renderAll();
        expect(screen.getByTestId('requirement-filer-item-3999').textContent).toBe('#3999 Old title');
        rest.mockResolvedValueOnce(ok([{ id: 3999, title: 'Renamed elsewhere', description: 'Body', category_fk: 862,
            requirement_status: 'development', coordination_type: 'implemented', ai_model: 'sonnet', effort: 'medium',
            machine_fk: 2, affected_repos: 'Darwin', tracking: 0 }]))
            .mockResolvedValueOnce(ok([{ id: 862, project_fk: 4 }]));
        fireEvent.click(screen.getByTestId('requirement-filer-item-3999'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3999'));
        expect(rest.mock.calls[0][0]).toMatch(/\/requirements\?id=3999&fields=id,title,description,category_fk,/);
        expect(rest.mock.calls[1][0]).toBe('https://api/darwin_dev/categories?id=862&fields=id,project_fk');
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('Renamed elsewhere');
        expect(screen.getByTestId('requirement-editor-field-project').value).toBe('4');
        expect(screen.getByTestId('requirement-editor-field-category').value).toBe('862');
        expect(screen.getByTestId('requirement-editor-field-status').getAttribute('data-value')).toBe('development');
        // Read as it is: nothing to send, and the list takes the live title.
        expect(unsent()).toBe(false);
        expect(screen.getByTestId('requirement-filer-item-3999').textContent).toBe('#3999 Renamed elsewhere');
        expect(screen.getByTestId('requirement-filer-item-3999').getAttribute('aria-current')).toBe('true');
        // A change saves itself to that row.
        rest.mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 204 } });
        fill('title', 'Renamed here');
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(3), LIVE);
        expect(rest.mock.calls[2][2]).toEqual([{ id: 3999, title: 'Renamed here' }]);
        await waitFor(() => expect(screen.getByTestId('requirement-filer-item-3999').textContent).toBe('#3999 Renamed here'));

        // A row that no longer exists leaves the list, and says so.
        rest.mockRejectedValueOnce({ data: [], httpStatus: { httpStatus: 404 } });
        fireEvent.click(screen.getByTestId('requirement-filer-item-3998'));
        await waitFor(() => expect(screen.getByTestId('requirement-filer-note').textContent).toContain('#3998 no longer exists'));
        expect(screen.queryByTestId('requirement-filer-item-3998')).toBe(null);
        expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3999');
    });

    it('a new requirement joins the list when it is filed, newest first (req #3830)', async () => {
        useRequirementFilerStore.setState({ show: true, filed: [{ id: 10, title: 'Earlier' }] });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'Fresh');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 4000 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-filer-item-4000')).toBeTruthy());
        const items = screen.getByTestId('requirement-filer-list').querySelectorAll('[data-testid^="requirement-filer-item-"]');
        expect([...items].map(i => i.getAttribute('data-testid'))).toEqual(['requirement-filer-item-4000', 'requirement-filer-item-10']);
    });

    const ROW = (id, over = {}) => ({ id, title: `Row ${id}`, description: '', category_fk: 862,
        requirement_status: 'met', coordination_type: 'planned', ai_model: 'haiku', effort: 'low',
        machine_fk: null, affected_repos: '', tracking: 0, ...over });

    it('editing a reopened requirement leaves the next new one\'s settings alone (req #3830)', async () => {
        useRequirementFilerStore.setState({ show: true, filed: [{ id: 3999, title: 'Row 3999' }],
            defaults: { ai_model: 'sonnet' }, lastProjectId: 4, lastCategoryId: 862 });
        renderAll();
        rest.mockResolvedValueOnce(ok([ROW(3999)])).mockResolvedValueOnce(ok([{ id: 862, project_fk: 4 }]));
        fireEvent.click(screen.getByTestId('requirement-filer-item-3999'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3999'));
        rest.mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 204 } });
        fill('title', 'Typo fixed');
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(3), LIVE);
        await waitFor(() => expect(unsent()).toBe(false));
        expect(useRequirementFilerStore.getState().defaults).toEqual({ ai_model: 'sonnet' });
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.getByTestId('requirement-editor-field-model').getAttribute('data-value')).toBe('sonnet');
        expect(screen.getByTestId('requirement-editor-field-status').getAttribute('data-value')).toBe('swarm_ready');
    });

    it('a reopen waits for a create still being filed, which still joins the list (req #3830, #3860)', async () => {
        useRequirementFilerStore.setState({ show: true, filed: [{ id: 3999, title: 'Row 3999' }] });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'In flight');
        fill('category', '862');
        let landPost;
        rest.mockImplementationOnce(() => new Promise((r) => { landPost = r; }));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        rest.mockResolvedValueOnce(ok([ROW(3999)])).mockResolvedValueOnce(ok([{ id: 862, project_fk: 4 }]));
        fireEvent.click(screen.getByTestId('requirement-filer-item-3999'));
        // Nothing is read until the create lands: it would replace a draft still being written.
        await new Promise(r => setTimeout(r, 50));
        expect(rest).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('requirement-editor')).toBe(null);
        await act(async () => { landPost(ok([{ id: 4001 }])); });
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3999'));
        expect(screen.getByTestId('requirement-filer-item-4001').textContent).toBe('#4001 In flight');
        // Filed whole, so there was nothing to ask about.
        expect(confirm).not.toHaveBeenCalled();
        confirm.mockRestore();
    });

    it('two quick clicks: the newest wins, whatever lands first; a failed read says so (req #3830)', async () => {
        useRequirementFilerStore.setState({ show: true, filed: [{ id: 3998, title: 'B' }, { id: 3997, title: 'C' }] });
        renderAll();
        let landB;
        rest.mockImplementationOnce(() => new Promise((r) => { landB = r; }))
            .mockResolvedValueOnce(ok([ROW(3997)])).mockResolvedValueOnce(ok([{ id: 862, project_fk: 4 }]));
        fireEvent.click(screen.getByTestId('requirement-filer-item-3998'));
        fireEvent.click(screen.getByTestId('requirement-filer-item-3997'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3997'));
        await act(async () => { landB(ok([ROW(3998)])); });
        expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3997');

        rest.mockRejectedValueOnce({ data: {}, httpStatus: { httpStatus: 500 } });
        fireEvent.click(screen.getByTestId('requirement-filer-item-3998'));
        await waitFor(() => expect(screen.getByTestId('requirement-filer-note').textContent).toContain('#3998 could not be read'));
        expect(screen.getByTestId('requirement-filer-item-3998')).toBeTruthy();
        expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3997');
    });

    it('asks before a reopened requirement replaces unsaved changes (req #3830)', async () => {
        useRequirementFilerStore.setState({ show: true, filed: [{ id: 3999, title: 'Filed' }] });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'half written');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        fireEvent.click(screen.getByTestId('requirement-filer-item-3999'));
        await waitFor(() => expect(confirm).toHaveBeenCalled());
        expect(rest).not.toHaveBeenCalled();
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('half written');
        confirm.mockRestore();
    });

    it('files a requirement: File → fill → File POSTs, shows the id link; a later change PUTs itself', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.getByTestId('requirement-editor')).toBeTruthy();
        // Starts SRDOH, Any machine (req #3815).
        expect(screen.getByTestId('requirement-editor-field-status').getAttribute('data-value')).toBe('swarm_ready');
        expect(screen.getByTestId('requirement-editor-field-autonomy').getAttribute('data-value')).toBe('deployed');
        expect(screen.getByTestId('requirement-editor-field-model').getAttribute('data-value')).toBe('opus');
        expect(screen.getByTestId('requirement-editor-field-effort').getAttribute('data-value')).toBe('high');
        expect(screen.getByTestId('requirement-editor-field-machine').getAttribute('data-value')).toBe('');
        // In the Darwin project already (req #3830): only the category to choose.
        expect(screen.getByTestId('requirement-editor-field-project').value).toBe('4');
        expect(screen.getByTestId('requirement-editor-field-category').disabled).toBe(false);
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(true);

        fill('title', 'File from anywhere');
        fill('description', 'The body');
        fill('project', '4');
        fill('category', '862');
        fill('model', 'sonnet');
        fill('effort', 'medium');
        fill('machine', '2');
        setDraft({ affected_repos: 'Darwin' });
        expect(screen.queryByTestId('requirement-editor-field-repos')).toBe(null);
        fireEvent.click(screen.getByTestId('requirement-editor-field-tracking'));

        rest.mockResolvedValueOnce(ok([{ id: 3999, title: 'File from anywhere' }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(3999);
        const [uri, method, body] = rest.mock.calls[0];
        expect(uri).toBe('https://api/darwin_dev/requirements');
        expect(method).toBe('POST');
        expect(body).toMatchObject({
            title: 'File from anywhere', description: 'The body', category_fk: 862,
            requirement_status: 'swarm_ready', coordination_type: 'deployed', ai_model: 'sonnet',
            effort: 'medium', machine_fk: 2, affected_repos: 'Darwin', tracking: 1,
        });
        const link = screen.getByTestId('requirement-editor-id-link');
        expect(link.textContent).toBe('3999');
        expect(link.getAttribute('href')).toBe('/swarm/requirement/3999');
        expect(unsent()).toBe(false);
        // Filed: no button — the next change saves itself.
        expect(screen.queryByTestId('requirement-editor-save')).toBe(null);

        rest.mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 204 } });
        fill('title', 'Filed from anywhere');
        fill('machine', '');
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(2), LIVE);
        expect(rest.mock.calls[1][1]).toBe('PUT');
        expect(rest.mock.calls[1][2]).toEqual([{ id: 3999, title: 'Filed from anywhere', machine_fk: 'NULL' }]);
        await waitFor(() => expect(unsent()).toBe(false));

        // The next New starts afresh in the same category.
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.queryByTestId('requirement-editor-id-link')).toBe(null);
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('');
        expect(screen.getByTestId('requirement-editor-field-category').value).toBe('862');
    });

    it('says why a save failed and keeps the draft — the editor Create closed comes back (req #3860)', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'x');
        fill('project', '4');
        fill('category', '862');
        // call_rest_api THROWS {data, httpStatus} for a gateway error.
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 400, httpMessage: 'blank effort' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        // Create closed it (req #3860); the failure brings it back on the draft.
        expect(screen.queryByTestId('requirement-editor')).toBe(null);
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('Requirement not saved (HTTP 400 blank effort)'));
        expect(screen.queryByTestId('requirement-editor-id-link')).toBe(null);
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('x');
        // …and Save is offered again.
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(false);
    });

    it('Create closes the editor at the press; the + waits for it, so it never lands on the next one (req #3860)', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'A');
        fill('project', '4');
        fill('category', '862');
        let resolve;
        rest.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        // Closed at the press, before the POST answers; the filer stays.
        expect(screen.queryByTestId('requirement-editor')).toBe(null);
        expect(screen.getByTestId('requirement-filer')).toBeTruthy();
        expect(useRequirementFilerStore.getState().creating).toBe(useRequirementFilerStore.getState().draftKey);
        // The + while A is still being written: B waits for it, asking nothing.
        const confirm = vi.spyOn(window, 'confirm');
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.queryByTestId('requirement-editor')).toBe(null);
        expect(useRequirementFilerStore.getState().draft.title).toBe('A');
        await act(async () => { resolve(ok([{ id: 5001 }])); });
        await waitFor(() => expect(screen.getByTestId('requirement-editor-field-title').value).toBe(''));
        expect(confirm).not.toHaveBeenCalled();
        confirm.mockRestore();
        expect(useRequirementFilerStore.getState().savedId).toBe(null);
        expect(screen.getByTestId('requirement-filer-item-5001')).toBeTruthy();
        fill('title', 'B');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 5002 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(5002);
        // B was POSTed as its own row, never PUT over A.
        expect(rest.mock.calls[1][1]).toBe('POST');
        expect(rest.mock.calls[1][2].title).toBe('B');
    });

    it('a create that never settles holds the next one only so long — then the editor shows it (req #3860)', async () => {
        act(() => useRequirementFilerStore.setState({ creating: 7 }));
        let settled = null;
        createSettled(30).then((v) => { settled = v; });
        await new Promise(r => setTimeout(r, 10));
        expect(settled).toBe(null);
        await waitFor(() => expect(settled).toBe(false));
        // Settled at once when none is in flight, and as soon as one ends.
        act(() => useRequirementFilerStore.setState({ creating: null }));
        await expect(createSettled(60000)).resolves.toBe(true);
        act(() => useRequirementFilerStore.setState({ creating: 8 }));
        let ended = null;
        createSettled(60000).then((v) => { ended = v; });
        act(() => useRequirementFilerStore.getState().endCreating(8));
        await waitFor(() => expect(ended).toBe(true));
    });

    it('a + that outwaits a slow create brings that draft back, never a new one over it (req #3860)', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'Slow');
        fill('project', '4');
        fill('category', '862');
        let land;
        rest.mockReturnValueOnce(new Promise(r => { land = r; }));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        expect(screen.queryByTestId('requirement-editor')).toBe(null);
        const keyBefore = useRequirementFilerStore.getState().draftKey;
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            fireEvent.click(screen.getByTestId('requirement-filer-add'));
            await act(async () => { vi.advanceTimersByTime(CREATE_WAIT_MS + 1); });
        } finally {
            vi.useRealTimers();
        }
        // The slow one is back in view, still being created — nothing replaced it.
        await waitFor(() => expect(screen.getByTestId('requirement-editor-field-title').value).toBe('Slow'));
        expect(useRequirementFilerStore.getState().draftKey).toBe(keyBefore);
        await act(async () => { land(ok([{ id: 5003 }])); });
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('5003'));
    });

    it('a committed POST whose id cannot be read back keeps the draft and refuses a duplicate', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'Lost id');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce({ data: '', httpStatus: { httpStatus: 201 } });
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 500, httpMessage: 'x' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent).toMatch(/could not be read back/));
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('Lost id');
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(true);
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.queryByTestId('requirement-editor-error')).toBe(null);
    });

    it('a 201 finds the new row\'s id by reading it back', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'Found');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce({ data: '', httpStatus: { httpStatus: 201 } });
        rest.mockResolvedValueOnce(ok([{ id: 7, title: 'Found' }, { id: 9, title: 'Found' }, { id: 11, title: 'Other' }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(9);
        expect(rest.mock.calls[1][0]).toBe('https://api/darwin_dev/requirements?category_fk=862&fields=id,title');
    });

    it('focuses the title for a requirement just started, not on a remount', () => {
        useRequirementFilerStore.setState({ show: true });
        const { unmount } = renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(document.activeElement).toBe(screen.getByTestId('requirement-editor-field-title'));
        unmount();
        document.body.focus();
        renderAll();
        expect(document.activeElement).not.toBe(screen.getByTestId('requirement-editor-field-title'));
    });

    it('is addressable: ?filer=new opens the filer and a new requirement', () => {
        renderAll({ at: '/swarm?filer=new' });
        expect(screen.getByTestId('requirement-filer')).toBeTruthy();
        expect(screen.getByTestId('requirement-editor')).toBeTruthy();
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('');
    });

    it('asks before discarding unsaved changes', () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'half written');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(confirm).toHaveBeenCalled();
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('half written');
        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('');
        confirm.mockRestore();
    });
    // ── Req #3812 — Defaults ────────────────────────────────────────────────
    it('a new requirement starts with the last one\'s settings — SRDOH before any', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        // SRDOH, Any machine — shown on the spec-code button, the settings closed.
        expect(screen.getByTestId('requirement-editor-spec').textContent).toBe('SRDOH');
        expect(screen.getByTestId('requirement-editor-settings').getAttribute('data-open')).toBe('0');
        fireEvent.click(screen.getByTestId('requirement-editor-spec'));
        expect(screen.getByTestId('requirement-editor-settings').getAttribute('data-open')).toBe('1');
        fill('autonomy', 'planned');
        fill('model', 'sonnet');
        fill('machine', '2');
        expect(screen.getByTestId('requirement-editor-spec').textContent).toBe('SRPSH · Mac');
        fill('title', 'The first');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 4100 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(4100);
        expect(rest.mock.calls[0][2]).toMatchObject({ coordination_type: 'planned', ai_model: 'sonnet', machine_fk: 2 });

        // The next one starts where that one was filed, with its settings.
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        const d = useRequirementFilerStore.getState().draft;
        expect(d).toMatchObject({ category_fk: 862, coordination_type: 'planned', ai_model: 'sonnet', machine_fk: 2,
            requirement_status: 'swarm_ready', effort: 'high' });
        expect(screen.getByTestId('requirement-editor-spec').textContent).toBe('SRPSH · Mac');
        expect(screen.getByTestId('requirement-editor-settings').getAttribute('data-open')).toBe('0');
    });

    it('a last machine that has since closed is dropped, and said so', () => {
        useRequirementFilerStore.setState({ show: true, defaults: { machine_fk: 3, effort: 'low' } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.getByTestId('requirement-editor-field-machine').getAttribute('data-value')).toBe('');
        expect(screen.getByTestId('requirement-editor-field-effort').getAttribute('data-value')).toBe('low');
        expect(screen.getByTestId('requirement-editor-notice').textContent)
            .toBe("The last requirement's machine closed — Any instead.");
    });

    it('a failed live save shows Retry and is not re-sent until something changes', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'Live');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 4300 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(4300);
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 500, httpMessage: 'boom' } });
        fill('title', 'Live, edited');
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('Changes not saved (HTTP 500 boom)'), LIVE);
        await new Promise(r => setTimeout(r, 900));
        expect(rest).toHaveBeenCalledTimes(2);
        rest.mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 204 } });
        fireEvent.click(screen.getByTestId('requirement-editor-retry'));
        await waitFor(() => expect(unsent()).toBe(false));
        expect(rest.mock.calls[2][2]).toEqual([{ id: 4300, title: 'Live, edited' }]);
        expect(screen.queryByTestId('requirement-editor-error')).toBe(null);
    });

    it('an edit made just before × reaches the row — exactly once', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'A');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 5001 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(5001);
        rest.mockResolvedValue({ data: {}, httpStatus: { httpStatus: 204 } });
        fill('title', 'A2');
        fireEvent.click(screen.getByTestId('requirement-editor-close'));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(2), LIVE);
        // Hidden, it must not keep re-sending what has already landed.
        await new Promise(r => setTimeout(r, 2000));
        expect(rest).toHaveBeenCalledTimes(2);
        expect(rest.mock.calls[1][2]).toEqual([{ id: 5001, title: 'A2' }]);
        expect(unsent()).toBe(false);
    });

    it('an edit typed while a save is in flight, then ×, is sent once that save lands', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'A');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 5101 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(5101);
        let land;
        rest.mockReturnValueOnce(new Promise(r => { land = r; }));
        fill('title', 'A2');
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(2), LIVE);   // A2's PUT in flight
        fill('title', 'A3');
        fireEvent.click(screen.getByTestId('requirement-editor-close'));
        rest.mockResolvedValue({ data: {}, httpStatus: { httpStatus: 204 } });
        await act(async () => { land({ data: {}, httpStatus: { httpStatus: 204 } }); });
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(3), LIVE);
        expect(rest.mock.calls[2][2][0].title).toBe('A3');
        await new Promise(r => setTimeout(r, 1500));
        expect(rest).toHaveBeenCalledTimes(3);
        expect(unsent()).toBe(false);
    });

    it('a carried place that has since closed is dropped, and said so', () => {
        useRequirementFilerStore.setState({ show: true, lastProjectId: 4, lastCategoryId: 999 });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(screen.getByTestId('requirement-editor-field-category').value).toBe('');
        expect(screen.getByTestId('requirement-editor-field-project').value).toBe('4');
        expect(screen.getByTestId('requirement-editor-notice').textContent)
            .toBe("The last requirement's category is closed or deleted — choose one.");
    });

    it('a store saved by the Defaults era rehydrates to the last settings, and its draft can still be filed', async () => {
        localStorage.setItem('darwin_requirement_filer', JSON.stringify({ version: 1, state: {
            show: true, editorShow: true, editorMode: 'defaults', lastProjectId: 4, lastCategoryId: 862,
            defaults: { projectId: 4, category_fk: 862, seatEpicId: 300, affected_repos: 'Darwin', ai_model: 'sonnet' },
            draft: { title: 'Typed before', description: '', projectId: 4, category_fk: 862, requirement_status: 'swarm_ready',
                coordination_type: 'implemented', ai_model: 'opus', effort: 'high', machine_fk: null, affected_repos: '',
                tracking: 0, seatEpicId: 300, defaultsUnchecked: ['seat'], notice: null },
        } }));
        await act(async () => { await useRequirementFilerStore.persist.rehydrate(); });
        const st = useRequirementFilerStore.getState();
        expect(st.defaults).toEqual({ ai_model: 'sonnet' });
        expect(st).not.toHaveProperty('editorMode');
        expect(st.draft.defaultsUnchecked).toEqual([]);
        renderAll();
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(false);
    });

    it('a filed requirement whose title is blanked says why it is not saving', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        fill('title', 'Keep');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 4400 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await filedThenShown(4400);
        fill('title', '');
        expect(screen.getByTestId('requirement-editor-problem').textContent).toBe('A title is required — not saving');
        await new Promise(r => setTimeout(r, 900));
        expect(rest).toHaveBeenCalledTimes(1);
    });
});

// Where it was filed from, as FILE recorded it: the capture's `filedFrom` category.
const filedFromOf = async () => {
    await waitFor(() => expect(useRequirementFilerStore.getState().captureStage).toBe('ready'));
    const c = useRequirementFilerStore.getState().capture.categories.find(x => x.key === 'filedFrom');
    return JSON.parse(c.text);
};

describe('FILE records where it was filed (req #3813), in its debug capture (req #3815)', () => {
    let unregister = null;
    beforeEach(() => {
        captureOn = true;
        desktop = true;
        projectsQ = PROJECTS;
        localStorage.clear();
        rest.mockReset();
        usePanelRackStore.setState({ racked: [], seeded: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        useRequirementFilerStore.setState({
            show: true, open: true, dock: { h: 'r', x: 40, v: 'b', y: 30, w: 200, ht: null },
            editorShow: false, editorOpen: true, editorDock: null,
            draft: null, savedId: null, saved: null, lastProjectId: 4, lastCategoryId: 862,
            draftKey: 0, orphaned: false, focusPending: false, creating: null, defaults: {}, filed: [],
        });
    });
    afterEach(() => { unregister?.(); unregister = null; cleanup(); });

    it('ACCEPTANCE: from /systems2?opt=… press File, file it — the capture holds where, the description says so', async () => {
        // The topology page reports the view on screen (SystemsPage2).
        unregister = registerPageOptions(() => ({
            options: { opt: 'tpu8t-datacenter-3d', title: 'TPU v8t Data Center' },
            surface: '/systems2?opt=tpu8t-datacenter-3d',
        }));
        localStorage.setItem('topology.lastOpt', 'tpu4-rack-3d');
        localStorage.setItem('darwin_working_domain', JSON.stringify({ state: { domainId: 9 }, version: 0 }));
        renderAll({ at: '/systems2?opt=tpu8t-datacenter-3d#top' });
        fireEvent.click(screen.getByTestId('requirement-filer-add'));

        // The description starts empty: where it was filed is a capture category.
        expect(screen.getByTestId('requirement-editor-field-description').value).toBe('');
        const ctx = await filedFromOf();
        expect(ctx.surface).toBe('/systems2?opt=tpu8t-datacenter-3d');
        fill('title', 'Filed from the data center');
        fill('description', 'What I want.');

        rest.mockResolvedValueOnce(ok([{ id: 4001 }]))
            .mockResolvedValueOnce(ok([{ id: 1, requirement_fk: 4001 }]))
            .mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 200 } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(3));
        expect(rest.mock.calls[0][2].description).toBe('What I want.');
        expect(JSON.parse(rest.mock.calls[1][2].bundle).filedFrom.surface).toBe('/systems2?opt=tpu8t-datacenter-3d');
        const { description } = rest.mock.calls[2][2][0];
        expect(description.startsWith('What I want.\n\n')).toBe(true);
        expect(description).toContain('\nSurface: /systems2?opt=tpu8t-datacenter-3d\n');
        expect(description).toContain('\nURL: /systems2?opt=tpu8t-datacenter-3d#top\n');
        expect(description).toContain('Debug capture: darwin://requirement-debug/4001');
        expect(ctx.url).toEqual({ full: '/systems2?opt=tpu8t-datacenter-3d#top', path: '/systems2',
            query: '?opt=tpu8t-datacenter-3d', hash: '#top' });
        // Options: the query, the page's live view, the owning app's view state only.
        expect(ctx.options.app).toBe('systems');
        expect(ctx.options.query).toEqual({ opt: 'tpu8t-datacenter-3d' });
        expect(ctx.options.page).toEqual({ opt: 'tpu8t-datacenter-3d', title: 'TPU v8t Data Center' });
        expect(ctx.options.viewState).toEqual({ 'topology.lastOpt': 'tpu4-rack-3d' });
        // State: database, theme, viewport, apps.
        expect(ctx.state.database).toBe('darwin_dev');
        expect(ctx.state.theme).toEqual({ mode: 'system', effective: 'dark' });
        expect(ctx.state.viewport.width).toBe(window.innerWidth);
        expect(ctx.state.apps.visible).toEqual(expect.arrayContaining(['tasks', 'maps', 'swarm']));
        expect(ctx.state.apps.visible).not.toContain('swarm-validate');
        // Pressed before the editor opened: the editor is not among the popups.
        expect(ctx.state.actionPopups.map(p => p.id)).not.toContain('requirement-editor');
        // The popup's location: floating at its dock.
        expect(ctx.popup).toMatchObject({ id: FILER_RACK_ID, racked: false, open: true,
            dock: { h: 'r', x: 40, v: 'b', y: 30, w: 200, ht: null } });
        expect(ctx.popup.rect).toEqual(expect.objectContaining({ x: expect.any(Number), w: expect.any(Number) }));
    });

    it('records a racked filer at its rack position, and the other open popups', async () => {
        usePanelRackStore.setState({ racked: ['dev-server', FILER_RACK_ID] });
        act(() => { useRequirementFilerStore.getState().startNew(false); });
        renderAll({ nav: true, at: '/swarm/pipeline/2?mode=plan&filer=1' });
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        const ctx = await filedFromOf();
        expect(ctx.surface).toBe('/swarm/pipeline/2?mode=plan');
        expect(ctx.options.routeIds).toEqual({ pipeline: 2 });
        expect(ctx.popup).toMatchObject({ id: FILER_RACK_ID, racked: true, rackIndex: 1 });
        // The editor was already open (on an earlier draft) when Create was clicked.
        expect(ctx.state.actionPopups.map(p => p.id)).toContain('requirement-editor');
    });

    it('?filer=new records the page it landed on', async () => {
        renderAll({ at: '/swarm?filer=new' });
        const ctx = await filedFromOf();
        expect(ctx.surface).toBe('/swarm');
        // The filer's own parameter is gone: opening the URL must not file again.
        expect(ctx.url.full).toBe('/swarm');
    });

    it('a fresh draft is not a change to ask about; a typed description is', () => {
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const first = useRequirementFilerStore.getState().draftKey;
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(confirm).not.toHaveBeenCalled();
        expect(useRequirementFilerStore.getState().draftKey).toBe(first + 1);
        const field = screen.getByTestId('requirement-editor-field-description');
        fireEvent.change(field, { target: { value: 'mine' } });
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        expect(confirm).toHaveBeenCalledTimes(1);
        confirm.mockRestore();
    });
});
