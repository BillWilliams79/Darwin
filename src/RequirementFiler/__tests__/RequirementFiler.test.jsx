// @vitest-environment jsdom
//
// Req #3811 — the Requirement Filer: an Action Popup opened from the navbar
// whose one button opens the popup requirement editor; the editor's first
// Save POSTs the requirement, shows its id as a link, and later Saves PUT it.
// Req #3812 — its DEFAULTS: the same editor without title/description, kept per
// browser, applied to every Requirement (seat included), stale ones not.
// Req #3813 — REQUIREMENT records where it was filed: the draft's description
// opens on a Filed-from block (URL, options, state, popup location).

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
    // The seat's plan layer: plan 2 is active (epic 30 → steps 300, 301), plan 5
    // is completed (epic 50 → step 500).
    useAllPipelines: () => q([{ id: 2, title: 'Plan A', pipeline_status: 'active' },
        { id: 5, title: 'Plan Done', pipeline_status: 'completed' }]),
    useAllInitiatives: () => q([{ id: 30, title: 'Epic One', pipeline_fk: 2, closed: 0, sort_order: 1 },
        { id: 50, title: 'Old Epic', pipeline_fk: 5, closed: 0 }]),
    useAllPipelineSteps: () => q([{ id: 300, title: 'Build', initiative_fk: 30 },
        { id: 301, title: 'Ship', initiative_fk: 30 }, { id: 500, title: 'Gone', initiative_fk: 50 }]),
    useAllPipelineStepRequirements: () => q([]),
}));
const q = (data) => ({ data, isPending: false, isLoading: false, isError: false });
let desktop = true;
// The open-projects read, swappable per test (pending, failed).
const PROJECTS = { data: [{ id: 4, project_name: 'Darwin', sort_order: 1 }] };
let projectsQ = PROJECTS;
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => desktop }));
const rest = vi.fn();
vi.mock('../../RestApi/RestApi', () => ({ default: (...a) => rest(...a) }));

import RequirementFiler, { FILER_RACK_ID } from '../RequirementFiler';
import RequirementEditorPopup from '../RequirementEditorPopup';
import NavBarSidebar from '../../NavBar/NavBarSidebar';
import { useRequirementFilerStore } from '../../stores/useRequirementFilerStore';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import ThemeContext from '../../Theme/ThemeContext';
import { FILED_FROM_BEGIN, parseFiledFromBlock, registerPageOptions } from '../filedFromContext';

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

const fill = (testid, value) => fireEvent.change(screen.getByTestId(`requirement-editor-field-${testid}`), { target: { value } });

describe('Requirement Filer (req #3811)', () => {
    beforeEach(() => {
        desktop = true;
        projectsQ = PROJECTS;
        localStorage.clear();
        rest.mockReset();
        usePanelRackStore.setState({ racked: [], seeded: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        useRequirementFilerStore.setState({
            show: false, open: true, dock: null, editorShow: false, editorOpen: true, editorDock: null,
            draft: null, savedId: null, saved: null, lastProjectId: null, lastCategoryId: null,
            draftKey: 0, orphaned: false, focusPending: false, editorMode: 'requirement', defaults: {},
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
        expect(screen.getByTestId('requirement-filer-title').textContent).toBe('Requirement Filer');
        expect(screen.getByTestId('requirement-filer-toggle')).toBeTruthy();
        expect(screen.getByTestId('requirement-filer-new').textContent).toContain('Requirement');
        expect(screen.getByTestId('requirement-filer-new').textContent).not.toContain('New');
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

    it('files a requirement: New → fill → Save POSTs, shows the id link; a later Save PUTs', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.getByTestId('requirement-editor')).toBeTruthy();
        // Starts SRIOH, Any machine.
        expect(screen.getByTestId('requirement-editor-field-status').value).toBe('swarm_ready');
        expect(screen.getByTestId('requirement-editor-field-autonomy').value).toBe('implemented');
        expect(screen.getByTestId('requirement-editor-field-model').value).toBe('opus');
        expect(screen.getByTestId('requirement-editor-field-effort').value).toBe('high');
        expect(screen.getByTestId('requirement-editor-field-machine').value).toBe('');
        expect(screen.getByTestId('requirement-editor-field-category').disabled).toBe(true);
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(true);

        fill('title', 'File from anywhere');
        fill('description', 'The body');
        fill('project', '4');
        fill('category', '862');
        fill('model', 'sonnet');
        fill('effort', 'medium');
        fill('machine', '2');
        fill('repos', 'Darwin');
        fireEvent.click(screen.getByTestId('requirement-editor-field-tracking'));

        rest.mockResolvedValueOnce(ok([{ id: 3999, title: 'File from anywhere' }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link')).toBeTruthy());
        const [uri, method, body] = rest.mock.calls[0];
        expect(uri).toBe('https://api/darwin_dev/requirements');
        expect(method).toBe('POST');
        expect(body).toMatchObject({
            title: 'File from anywhere', description: 'The body', category_fk: 862,
            requirement_status: 'swarm_ready', coordination_type: 'implemented', ai_model: 'sonnet',
            effort: 'medium', machine_fk: 2, affected_repos: 'Darwin', tracking: 1,
        });
        const link = screen.getByTestId('requirement-editor-id-link');
        expect(link.textContent).toBe('#3999');
        expect(link.getAttribute('href')).toBe('/swarm/requirement/3999');
        expect(screen.getByTestId('requirement-editor-state').textContent).toBe('saved');
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(true);

        fill('title', 'Filed from anywhere');
        fill('machine', '');
        rest.mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 204 } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(2));
        expect(rest.mock.calls[1][1]).toBe('PUT');
        expect(rest.mock.calls[1][2]).toEqual([{ id: 3999, title: 'Filed from anywhere', machine_fk: 'NULL' }]);
        await waitFor(() => expect(screen.getByTestId('requirement-editor-state').textContent).toBe('saved'));

        // The next New starts afresh in the same category.
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.queryByTestId('requirement-editor-id-link')).toBe(null);
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('');
        expect(screen.getByTestId('requirement-editor-field-category').value).toBe('862');
    });

    it('says why a save failed and keeps the draft', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'x');
        fill('project', '4');
        fill('category', '862');
        // call_rest_api THROWS {data, httpStatus} for a gateway error.
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 400, httpMessage: 'blank effort' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('Requirement not saved (HTTP 400 blank effort)'));
        expect(screen.queryByTestId('requirement-editor-id-link')).toBe(null);
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('x');
        // …and Save is offered again.
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(false);
    });

    it('never lands a save in flight on a requirement started after it', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'A');
        fill('project', '4');
        fill('category', '862');
        let resolve;
        rest.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        // Closed while saving, so New asks nothing; B starts.
        fireEvent.click(screen.getByTestId('requirement-editor-close'));
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        await act(async () => { resolve(ok([{ id: 5001 }])); });
        expect(useRequirementFilerStore.getState().savedId).toBe(null);
        expect(screen.queryByTestId('requirement-editor-id-link')).toBe(null);
        fill('title', 'B');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce(ok([{ id: 5002 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('#5002'));
        // B was POSTed as its own row, never PUT over A.
        expect(rest.mock.calls[1][1]).toBe('POST');
        expect(rest.mock.calls[1][2].title).toBe('B');
    });

    it('a committed POST whose id cannot be read back keeps the draft and refuses a duplicate', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'Lost id');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce({ data: '', httpStatus: { httpStatus: 201 } });
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 500, httpMessage: 'x' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent).toMatch(/could not be read back/));
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('Lost id');
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(true);
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.queryByTestId('requirement-editor-error')).toBe(null);
    });

    it('a 201 finds the new row\'s id by reading it back', async () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'Found');
        fill('project', '4');
        fill('category', '862');
        rest.mockResolvedValueOnce({ data: '', httpStatus: { httpStatus: 201 } });
        rest.mockResolvedValueOnce(ok([{ id: 7, title: 'Found' }, { id: 9, title: 'Found' }, { id: 11, title: 'Other' }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('#9'));
        expect(rest.mock.calls[1][0]).toBe('https://api/darwin_dev/requirements?category_fk=862&fields=id,title');
    });

    it('focuses the title for a requirement just started, not on a remount', () => {
        useRequirementFilerStore.setState({ show: true });
        const { unmount } = renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
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
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'half written');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(confirm).toHaveBeenCalled();
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('half written');
        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('');
        confirm.mockRestore();
    });
    // ── Req #3812 — Defaults ────────────────────────────────────────────────
    it('Defaults opens the editor on the defaults: no title or description, the standard values', () => {
        useRequirementFilerStore.setState({ show: true });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-defaults'));
        expect(screen.getByTestId('requirement-editor-title').textContent).toBe('Requirement Defaults');
        expect(screen.getByTestId('requirement-editor-identity').textContent).toContain('Defaults');
        expect(screen.queryByTestId('requirement-editor-field-title')).toBe(null);
        expect(screen.queryByTestId('requirement-editor-field-description')).toBe(null);
        expect(screen.queryByTestId('requirement-editor-save')).toBe(null);
        expect(screen.getByTestId('requirement-editor-field-status').value).toBe('swarm_ready');
        expect(screen.getByTestId('requirement-editor-field-autonomy').value).toBe('implemented');
        expect(screen.getByTestId('requirement-editor-field-model').value).toBe('opus');
        expect(screen.getByTestId('requirement-editor-field-effort').value).toBe('high');
        expect(screen.getByTestId('requirement-editor-defaults-reset').disabled).toBe(true);
    });

    it('ACCEPTANCE: defaults survive a reload and file a requirement seated on the default step', async () => {
        useRequirementFilerStore.setState({ show: true });
        const { unmount } = renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-defaults'));
        fill('project', '4');
        fill('category', '862');
        fill('autonomy', 'deployed');
        fill('model', 'sonnet');
        fill('effort', 'medium');
        fill('machine', '2');
        fill('pipeline', '2');
        // The epic list is the plan's; the step list narrows to the epic.
        expect([...screen.getByTestId('requirement-editor-field-epic').options].map(o => o.value)).toEqual(['', '30']);
        fill('epic', '30');
        expect([...screen.getByTestId('requirement-editor-field-step').options].map(o => o.value))
            .toEqual(['', '300', '301']);
        fill('step', '301');
        expect(useRequirementFilerStore.getState().defaults).toMatchObject({
            projectId: 4, category_fk: 862, coordination_type: 'deployed', ai_model: 'sonnet',
            effort: 'medium', machine_fk: 2, seatPipelineId: 2, seatInitiativeId: 30, seatStepId: 301,
        });

        // Reload: the page goes, the store rehydrates from localStorage.
        unmount();
        const stored = localStorage.getItem('darwin_requirement_filer');
        expect(JSON.parse(stored).state.defaults.seatStepId).toBe(301);
        // Wipe the in-memory store (which persists the wipe), then put the
        // browser's copy back as a reload would find it.
        useRequirementFilerStore.setState({ defaults: {}, editorShow: false, editorMode: 'requirement' });
        localStorage.setItem('darwin_requirement_filer', stored);
        await act(async () => { await useRequirementFilerStore.persist.rehydrate(); });
        expect(useRequirementFilerStore.getState().defaults.seatStepId).toBe(301);
        renderAll();

        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.getByTestId('requirement-editor-field-category').value).toBe('862');
        expect(screen.getByTestId('requirement-editor-field-autonomy').value).toBe('deployed');
        expect(screen.getByTestId('requirement-editor-field-model').value).toBe('sonnet');
        expect(screen.getByTestId('requirement-editor-field-effort').value).toBe('medium');
        expect(screen.getByTestId('requirement-editor-field-status').value).toBe('swarm_ready');
        expect(screen.getByTestId('requirement-editor-field-machine').value).toBe('2');
        expect(screen.getByTestId('requirement-editor-field-step').value).toBe('301');
        expect(screen.queryByTestId('requirement-editor-notice')).toBe(null);
        fill('title', 'Seated from the popup');

        rest.mockResolvedValueOnce(ok([{ id: 4100 }]));
        rest.mockResolvedValueOnce(ok([{ step_fk: 301, requirement_fk: 4100 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-state').textContent).toBe('saved'));
        expect(rest.mock.calls[0][1]).toBe('POST');
        expect(rest.mock.calls[0][2]).toMatchObject({
            title: 'Seated from the popup', category_fk: 862, coordination_type: 'deployed',
            ai_model: 'sonnet', effort: 'medium', machine_fk: 2,
        });
        expect(rest.mock.calls[0][2]).not.toHaveProperty('seatStepId');
        expect(rest.mock.calls[1]).toEqual(['https://api/darwin_dev/pipeline_step_requirements', 'POST',
            { step_fk: 301, requirement_fk: 4100 }, 't']);
    });

    it('the default seat is removable before save', async () => {
        useRequirementFilerStore.setState({ show: true, defaults: {
            projectId: 4, category_fk: 862, seatPipelineId: 2, seatInitiativeId: null, seatStepId: 300 } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.getByTestId('requirement-editor-field-step').value).toBe('300');
        fill('step', '');
        fill('title', 'Not seated');
        rest.mockResolvedValueOnce(ok([{ id: 4200 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('#4200'));
        expect(rest).toHaveBeenCalledTimes(1);
    });

    it('a stale default is shown invalid in Defaults and not applied to a new requirement', () => {
        useRequirementFilerStore.setState({ show: true, defaults: {
            projectId: 4, category_fk: 999, machine_fk: 3, seatPipelineId: 5, seatStepId: 500, effort: 'low' } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-defaults'));
        expect(screen.getByTestId('requirement-editor-invalid-category').textContent).toMatch(/closed or deleted — not applied/);
        expect(screen.getByTestId('requirement-editor-invalid-machine').textContent).toMatch(/closed — not applied/);
        expect(screen.getByTestId('requirement-editor-invalid-step').textContent).toMatch(/pipeline is completed/);

        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.getByTestId('requirement-editor-field-category').value).toBe('');
        expect(screen.getByTestId('requirement-editor-field-machine').value).toBe('');
        expect(screen.getByTestId('requirement-editor-field-step').value).toBe('');
        // A valid default still applies.
        expect(screen.getByTestId('requirement-editor-field-effort').value).toBe('low');
        expect(screen.getByTestId('requirement-editor-notice').textContent)
            .toBe('Default category closed or deleted; Default machine closed; '
                + 'Default seat its pipeline is completed or deleted — not applied.');
    });

    it('a locked step\'s 423 is shown in the editor, and the next Save retries only the seat', async () => {
        useRequirementFilerStore.setState({ show: true, defaults: {
            projectId: 4, category_fk: 862, seatPipelineId: 2, seatStepId: 300 } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'Locked out');
        rest.mockResolvedValueOnce(ok([{ id: 4300 }]));
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 423, httpMessage: 'Step 300 is locked' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('#4300 saved, but not seated on step 300 (HTTP 423 Step 300 is locked)'));
        expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('#4300');
        expect(screen.getByTestId('requirement-editor-state').textContent).toBe('unsaved changes');
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(false);

        rest.mockResolvedValueOnce(ok([{ step_fk: 300, requirement_fk: 4300 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-state').textContent).toBe('saved'));
        expect(rest).toHaveBeenCalledTimes(3);
        expect(rest.mock.calls[2].slice(0, 3)).toEqual(['https://api/darwin_dev/pipeline_step_requirements', 'POST',
            { step_fk: 300, requirement_fk: 4300 }]);
        expect(screen.queryByTestId('requirement-editor-error')).toBe(null);
    });

    it('moving a saved requirement\'s seat deletes the old seat, then inserts the new', async () => {
        useRequirementFilerStore.setState({ show: true, defaults: {
            projectId: 4, category_fk: 862, seatPipelineId: 2, seatStepId: 300 } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'Mover');
        rest.mockResolvedValueOnce(ok([{ id: 4400 }]));
        rest.mockResolvedValueOnce(ok([{}]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-state').textContent).toBe('saved'));
        fill('step', '301');
        rest.mockResolvedValueOnce(ok([{}]));
        rest.mockResolvedValueOnce(ok([{}]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(4));
        expect(rest.mock.calls[2].slice(1, 3)).toEqual(['DELETE', { step_fk: 300, requirement_fk: 4400 }]);
        expect(rest.mock.calls[3].slice(1, 3)).toEqual(['POST', { step_fk: 301, requirement_fk: 4400 }]);
    });

    it('is addressable: ?filer=defaults opens the defaults; Back returns to the draft', () => {
        renderAll({ at: '/swarm?filer=defaults' });
        expect(screen.getByTestId('requirement-editor-title').textContent).toBe('Requirement Defaults');
        expect(screen.queryByTestId('requirement-editor-defaults-done')).toBe(null);
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'keep me');
        fireEvent.click(screen.getByTestId('requirement-filer-defaults'));
        fireEvent.click(screen.getByTestId('requirement-editor-defaults-done'));
        expect(screen.getByTestId('requirement-editor-field-title').value).toBe('keep me');
    });
    it('a project-only default waits for the projects read, and a failed read drops it', () => {
        useRequirementFilerStore.setState({ show: true, defaults: { projectId: 4, category_fk: null } });
        projectsQ = { data: undefined, isError: false };
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'x');
        expect(screen.getByTestId('requirement-editor-problem').textContent).toBe('Checking defaults…');
        expect(useRequirementFilerStore.getState().draft.defaultsUnchecked).toEqual(['category']);
        projectsQ = { data: undefined, isError: true };
        cleanup();
        renderAll();
        expect(useRequirementFilerStore.getState().draft.projectId).toBe(null);
        expect(screen.getByTestId('requirement-editor-notice').textContent)
            .toBe('Default category could not be checked — not applied.');
    });

    it('a pipeline-only default pre-scopes the step list; a completed one is not applied', () => {
        useRequirementFilerStore.setState({ show: true, defaults: { seatPipelineId: 2, seatInitiativeId: 30 } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.getByTestId('requirement-editor-field-pipeline').value).toBe('2');
        expect(screen.getByTestId('requirement-editor-field-epic').value).toBe('30');
        expect(screen.getByTestId('requirement-editor-field-step').value).toBe('');
        expect(screen.queryByTestId('requirement-editor-notice')).toBe(null);

        act(() => useRequirementFilerStore.setState({ defaults: { seatPipelineId: 5 } }));
        fireEvent.click(screen.getByTestId('requirement-filer-defaults'));
        expect(screen.getByTestId('requirement-editor-invalid-step').textContent).toMatch(/pipeline is completed/);
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(screen.getByTestId('requirement-editor-field-pipeline').value).toBe('');
    });

    it('a default step that moved since opens under where it sits now', () => {
        // Stored under plan 5 / epic 50, but step 301 sits in plan 2 / epic 30.
        useRequirementFilerStore.setState({ show: true, defaults: {
            seatPipelineId: 5, seatInitiativeId: 50, seatStepId: 301 } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        const d = useRequirementFilerStore.getState().draft;
        expect([d.seatPipelineId, d.seatInitiativeId, d.seatStepId]).toEqual([2, 30, 301]);
    });

    it('a move whose new seat is refused says it is now seated nowhere; a refused unseat says it stayed', async () => {
        useRequirementFilerStore.setState({ show: true, defaults: {
            projectId: 4, category_fk: 862, seatPipelineId: 2, seatStepId: 300 } });
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        fill('title', 'Mover');
        rest.mockResolvedValueOnce(ok([{ id: 4500 }]));
        rest.mockResolvedValueOnce(ok([{}]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-state').textContent).toBe('saved'));

        // Unseat refused: still on 300.
        fill('step', '301');
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 423, httpMessage: 'Step 300 is locked' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('#4500 saved, but not taken off step 300 (HTTP 423 Step 300 is locked)'));
        expect(useRequirementFilerStore.getState().saved.seatStepId).toBe(300);

        // Unseat lands, seat refused: seated nowhere, and the retry only seats.
        rest.mockResolvedValueOnce(ok([{}]));
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 423, httpMessage: 'Step 301 is locked' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('#4500 saved and taken off step 300, but not seated on step 301 — it is seated nowhere '
                + '(HTTP 423 Step 301 is locked)'));
        expect(useRequirementFilerStore.getState().saved.seatStepId).toBe(null);
        rest.mockResolvedValueOnce(ok([{}]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-state').textContent).toBe('saved'));
        expect(rest.mock.calls.at(-1).slice(1, 3)).toEqual(['POST', { step_fk: 301, requirement_fk: 4500 }]);
    });
});

describe('REQUIREMENT records where it was filed (req #3813)', () => {
    let unregister = null;
    beforeEach(() => {
        desktop = true;
        projectsQ = PROJECTS;
        localStorage.clear();
        rest.mockReset();
        usePanelRackStore.setState({ racked: [], seeded: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        useRequirementFilerStore.setState({
            show: true, open: true, dock: { h: 'r', x: 40, v: 'b', y: 30, w: 200, ht: null },
            editorShow: false, editorOpen: true, editorDock: null,
            draft: null, savedId: null, saved: null, lastProjectId: 4, lastCategoryId: 862,
            draftKey: 0, orphaned: false, focusPending: false, editorMode: 'requirement', defaults: {},
        });
    });
    afterEach(() => { unregister?.(); unregister = null; cleanup(); });

    it('ACCEPTANCE: from /systems2?opt=… press Requirement, save — the description carries the block', async () => {
        // The topology page reports the view on screen (SystemsPage2).
        unregister = registerPageOptions(() => ({
            options: { opt: 'tpu8t-datacenter-3d', title: 'TPU v8t Data Center' },
            surface: '/systems2?opt=tpu8t-datacenter-3d',
        }));
        localStorage.setItem('topology.lastOpt', 'tpu4-rack-3d');
        localStorage.setItem('darwin_working_domain', JSON.stringify({ state: { domainId: 9 }, version: 0 }));
        renderAll({ at: '/systems2?opt=tpu8t-datacenter-3d#top' });
        fireEvent.click(screen.getByTestId('requirement-filer-new'));

        // Visible and editable in the editor before save.
        const field = screen.getByTestId('requirement-editor-field-description');
        expect(field.value.startsWith('\n\n' + FILED_FROM_BEGIN)).toBe(true);
        expect(field.value).toContain('Surface: /systems2?opt=tpu8t-datacenter-3d\n');
        fill('title', 'Filed from the data center');
        fireEvent.change(field, { target: { value: 'What I want.' + field.value } });

        rest.mockResolvedValueOnce(ok([{ id: 4001 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(1));
        const { description } = rest.mock.calls[0][2];
        expect(description.startsWith('What I want.\n\n')).toBe(true);
        const block = parseFiledFromBlock(description);
        expect(block.surface).toBe('/systems2?opt=tpu8t-datacenter-3d');
        expect(block.url).toBe('/systems2?opt=tpu8t-datacenter-3d#top');
        const ctx = block.context;
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

    it('records a racked filer at its rack position, and the other open popups', () => {
        usePanelRackStore.setState({ racked: ['dev-server', FILER_RACK_ID] });
        useRequirementFilerStore.setState({ editorShow: true, editorMode: 'defaults' });
        renderAll({ nav: true, at: '/swarm/pipeline/2?mode=plan&filer=1' });
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        const ctx = parseFiledFromBlock(useRequirementFilerStore.getState().draft.description).context;
        expect(ctx.surface).toBe('/swarm/pipeline/2?mode=plan');
        expect(ctx.options.routeIds).toEqual({ pipeline: 2 });
        expect(ctx.popup).toMatchObject({ id: FILER_RACK_ID, racked: true, rackIndex: 1 });
        // The editor was already open (on the defaults) when Requirement was pressed.
        expect(ctx.state.actionPopups.map(p => p.id)).toContain('requirement-editor');
    });

    it('?filer=new records the page it landed on', () => {
        renderAll({ at: '/swarm?filer=new' });
        const block = parseFiledFromBlock(useRequirementFilerStore.getState().draft.description);
        expect(block.surface).toBe('/swarm');
        expect(block.url).toBe('/swarm?filer=new');
    });

    it('an untouched block is not a change to ask about; an edited one is', () => {
        renderAll();
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const first = useRequirementFilerStore.getState().draftKey;
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(confirm).not.toHaveBeenCalled();
        expect(useRequirementFilerStore.getState().draftKey).toBe(first + 1);
        const field = screen.getByTestId('requirement-editor-field-description');
        fireEvent.change(field, { target: { value: 'mine' + field.value } });
        fireEvent.click(screen.getByTestId('requirement-filer-new'));
        expect(confirm).toHaveBeenCalledTimes(1);
        confirm.mockRestore();
    });
});
