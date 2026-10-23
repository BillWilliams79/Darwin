// @vitest-environment jsdom
//
// Req #3811 — the Requirement Filer: an Action Popup opened from the navbar
// whose one button opens the popup requirement editor; the editor's first
// Save POSTs the requirement, shows its id as a link, and later Saves PUT it.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

vi.mock('../../hooks/useDataQueries', () => ({
    useProjects: () => ({ data: [{ id: 4, project_name: 'Darwin', sort_order: 1 }] }),
    useCategories: (_u, projectId) => ({
        data: projectId === 4 ? [{ id: 862, category_name: 'Swarm', project_fk: 4 }] : undefined,
    }),
    useMachines: () => ({ data: [{ id: 2, title: 'Mac', sort_order: 1 }] }),
    useDevServers: () => ({ data: [] }),
}));
let desktop = true;
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => desktop }));
const rest = vi.fn();
vi.mock('../../RestApi/RestApi', () => ({ default: (...a) => rest(...a) }));

import RequirementFiler, { FILER_RACK_ID } from '../RequirementFiler';
import RequirementEditorPopup from '../RequirementEditorPopup';
import NavBarSidebar from '../../NavBar/NavBarSidebar';
import { useRequirementFilerStore } from '../../stores/useRequirementFilerStore';
import { usePanelRackStore } from '../../stores/usePanelRackStore';

const ok = (data) => ({ data, httpStatus: { httpStatus: 200, httpMessage: 'OK' } });

const renderAll = ({ nav = false, at = '/maps' } = {}) => render(
    <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={{ idToken: 't', profile: { userName: 'u', app_swarm: 1 } }}>
            <AppContext.Provider value={{ darwinUri: 'https://api/darwin_dev', database: 'darwin_dev' }}>
                <MemoryRouter initialEntries={[at]}>
                    {nav && <NavBarSidebar />}
                    <RequirementFiler />
                    <RequirementEditorPopup />
                </MemoryRouter>
            </AppContext.Provider>
        </AuthContext.Provider>
    </QueryClientProvider>
);

const fill = (testid, value) => fireEvent.change(screen.getByTestId(`requirement-editor-field-${testid}`), { target: { value } });

describe('Requirement Filer (req #3811)', () => {
    beforeEach(() => {
        desktop = true;
        localStorage.clear();
        rest.mockReset();
        usePanelRackStore.setState({ racked: [], seeded: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        useRequirementFilerStore.setState({
            show: false, open: true, dock: null, editorShow: false, editorOpen: true, editorDock: null,
            draft: null, savedId: null, saved: null, lastProjectId: null, lastCategoryId: null,
            draftKey: 0, orphaned: false, focusPending: false,
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
        expect(screen.getByTestId('requirement-filer-new').textContent).toContain('New requirement');
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
});
