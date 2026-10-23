// @vitest-environment jsdom
//
// Req #3815 — the Requirement Filer's FILE button records a debug capture with
// every requirement — where it was filed from (#3813) as its first category —
// summarised per category behind Details with any category droppable, saved as
// requirement → capture row → description block, with Retry when the capture
// write fails. One button since the user's ruling (2026-10-23, absorbing #3818).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The page's own fetch and a silent console, before the capture buffers wrap them.
const pageFetch = vi.hoisted(() => {
    const f = vi.fn();
    globalThis.fetch = f;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {};
    return f;
});
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

import RequirementFiler, { FILER_RACK_ID } from '../RequirementFiler';
import RequirementEditorPopup from '../RequirementEditorPopup';
import NavBarSidebar from '../../NavBar/NavBarSidebar';
import { useRequirementFilerStore } from '../../stores/useRequirementFilerStore';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import ThemeContext from '../../Theme/ThemeContext';
import { DEBUG_BLOCK_BEGIN, buildDebugCapture } from '../debugBundle';

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

// A chip row (Status, Autonomy, Model, Effort, Machine) is clicked; a list or text is changed.
const fill = (testid, value) => {
    const el = screen.getByTestId(`requirement-editor-field-${testid}`);
    if (el.getAttribute('data-chips')) {
        fireEvent.click(screen.getByTestId(`requirement-editor-field-${testid}-${value === '' ? 'any' : value}`));
    } else {
        fireEvent.change(el, { target: { value } });
    }
};


describe('Requirement Filer — FILE and its debug capture (req #3815)', () => {
    beforeEach(() => {
        desktop = true;
        projectsQ = PROJECTS;
        localStorage.clear();
        rest.mockReset();
        usePanelRackStore.setState({ racked: [], seeded: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        useRequirementFilerStore.setState({
            show: true, open: true, dock: null, editorShow: false, editorOpen: true, editorDock: null,
            draft: null, savedId: null, saved: null, lastProjectId: 4, lastCategoryId: 862,
            draftKey: 0, orphaned: false, focusPending: false, defaults: {}, filed: [],
            capture: null, captureDropped: [], captureStage: null,
        });
    });
    afterEach(cleanup);

    const pressFile = async () => {
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-capture-status').textContent)
            .toMatch(/^\d+(\.\d)? (B|KB)$/));
    };

    it('the + starts a draft that carries the capture, where it was filed from first', async () => {
        renderAll();
        expect(screen.getByTestId('requirement-filer-add').getAttribute('aria-label')).toMatch(/^Create a requirement/);
        expect(screen.queryByTestId('requirement-filer-bug')).toBe(null);
        await pressFile();
        expect(screen.getByTestId('requirement-editor-identity').textContent).toContain('New');
        // Where it was filed is a capture category now, so the description starts empty.
        expect(screen.getByTestId('requirement-editor-field-description').value).toBe('');
        const { capture } = useRequirementFilerStore.getState();
        expect(capture.categories[0].key).toBe('filedFrom');
        expect(JSON.parse(capture.categories[0].text).surface).toBe('/maps');
        expect(screen.getByTestId('requirement-editor-capture-filedFrom').textContent).toContain('/maps');
        expect(screen.getByTestId('requirement-editor-field-status').getAttribute('data-value')).toBe('swarm_ready');
    });

    it('ACCEPTANCE: a console error and a failing request, File — requirement, capture row, then the block', async () => {
        console.error('Save failed: blank effort');
        pageFetch.mockResolvedValueOnce(new Response('{"message":"blank effort"}', { status: 400 }));
        await window.fetch('https://api/darwin_dev/requirements', { method: 'POST', headers: { Authorization: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2VjcmV0c2lnbmF0dXJl' } });
        renderAll();
        await pressFile();
        // The summary: every category with its size, each droppable.
        for (const key of ['environment', 'console', 'errors', 'network', 'reactQuery', 'storage']) {
            expect(screen.getByTestId(`requirement-editor-capture-${key}`)).toBeTruthy();
            expect(screen.getByTestId(`requirement-editor-capture-bytes-${key}`).textContent).toMatch(/\d+(\.\d)? (B|KB)/);
        }
        expect(screen.getByTestId('requirement-editor-capture-network').textContent).toContain('1 failed');
        fireEvent.click(screen.getByTestId('requirement-editor-capture-details-toggle'));
        fireEvent.click(screen.getByTestId('requirement-editor-capture-toggle-storage'));
        expect(useRequirementFilerStore.getState().captureDropped).toEqual(['storage']);

        fill('title', 'Save fails on a blank effort');
        rest.mockResolvedValueOnce(ok([{ id: 3901 }]))                                 // POST requirement
            .mockResolvedValueOnce(ok([{ id: 77, requirement_fk: 3901 }]))            // POST capture
            .mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 200 } });   // PUT description
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-capture-status').textContent).toBe('saved'));

        const [[u1, m1], [u2, m2, capture], [u3, m3, put]] = rest.mock.calls;
        expect([u1, m1]).toEqual(['https://api/darwin_dev/requirements', 'POST']);
        expect([u2, m2]).toEqual(['https://api/darwin_dev/requirement_debug_captures', 'POST']);
        expect(capture.requirement_fk).toBe(3901);
        const bundle = JSON.parse(capture.bundle);
        expect(capture.bundle_bytes).toBe(new TextEncoder().encode(capture.bundle).length);
        expect(bundle.storage).toBeUndefined();
        expect(bundle.dropped).toEqual(['storage']);
        expect(bundle.console.entries.some(e => e.args?.[0] === 'Save failed: blank effort')).toBe(true);
        expect(bundle.network.entries.at(-1)).toMatchObject({ status: 400, failBody: '{"message":"blank effort"}' });
        expect(capture.bundle).not.toContain('c2VjcmV0c2lnbmF0dXJl');
        expect([u3, m3]).toEqual(['https://api/darwin_dev/requirements', 'PUT']);
        expect(put[0].id).toBe(3901);
        expect(put[0].description).toContain(DEBUG_BLOCK_BEGIN);
        expect(put[0].description).toContain('\nSurface: /maps\n');
        expect(put[0].description).toContain('Debug capture: darwin://requirement-debug/3901');
        expect(put[0].description).toContain('blank effort');
        // The editor now shows the block, the row is in epic, and nothing is left to send.
        expect(screen.getByTestId('requirement-editor-field-description').value).toContain(DEBUG_BLOCK_BEGIN);
        expect(screen.getByTestId('requirement-editor-capture-uri').textContent).toBe('darwin://requirement-debug/3901');
        // Filed: no button, and live saving finds nothing more to send (the block is in both).
        expect(screen.queryByTestId('requirement-editor-save')).toBe(null);
        await new Promise(r => setTimeout(r, 900));
        expect(rest).toHaveBeenCalledTimes(3);
        expect(screen.getByTestId('requirement-editor-capture-toggle-console').disabled).toBe(true);
        // The block names exactly the categories the stored row left out.
        expect(put[0].description).toContain('Dropped before save: storage');
    });

    it('is as short as it can be: the settings sit behind the spec-code button, laid out like the requirement page', async () => {
        renderAll();
        await pressFile();
        // Off the form: the save status, the Orchestration box, the repos, a Defaults mode.
        expect(screen.queryByTestId('requirement-editor-state')).toBe(null);
        expect(screen.queryByTestId('requirement-editor-orchestration')).toBe(null);
        expect(screen.queryByTestId('requirement-editor-field-repos')).toBe(null);
        expect(screen.queryByTestId('requirement-filer-defaults')).toBe(null);
        expect(screen.getByTestId('requirement-editor-field-description').getAttribute('rows')).toBe('2');
        // Project and Category are each named; File is greyed with no reason text beside it.
        expect(screen.getByTestId('requirement-editor-field-project').previousSibling.textContent).toBe('Project -');
        expect(screen.getByTestId('requirement-editor-field-category').previousSibling.textContent).toBe('Category -');
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(true);
        expect(screen.getByTestId('requirement-editor-save').textContent).toBe('Create');
        expect(screen.queryByTestId('requirement-editor-problem')).toBe(null);
        // The capture: a Debug Capture button, its size beside it, on File's row.
        const captureButton = screen.getByTestId('requirement-editor-capture-details-toggle');
        expect(captureButton.textContent).toBe('Debug Capture');
        expect(screen.getByTestId('requirement-editor-capture-status').textContent).toMatch(/^\d+(\.\d)? (B|KB)$/);
        expect(captureButton.closest('div').parentElement.contains(screen.getByTestId('requirement-editor-save'))).toBe(true);
        // The settings: closed, behind the spec code.
        const spec = screen.getByTestId('requirement-editor-spec');
        const settings = screen.getByTestId('requirement-editor-settings');
        expect(spec.textContent).toBe('SRDOH');
        expect(spec.getAttribute('aria-expanded')).toBe('false');
        expect(settings.getAttribute('data-open')).toBe('0');
        expect(settings.getAttribute('aria-hidden')).toBe('true');
        fireEvent.click(spec);
        expect(settings.getAttribute('data-open')).toBe('1');
        expect(spec.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('requirement-editor-field-status-swarm_ready').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('requirement-editor-field-status-swarm_ready').textContent).toBe('Swarm-Start');
        expect(screen.getByTestId('requirement-editor-field-autonomy-deployed').getAttribute('aria-pressed')).toBe('true');
        const ai = screen.getByTestId('requirement-editor-ai-settings');
        expect(ai.tagName).toBe('FIELDSET');
        expect(ai.contains(screen.getByTestId('requirement-editor-field-model'))).toBe(true);
        expect(ai.contains(screen.getByTestId('requirement-editor-field-effort'))).toBe(true);
        expect(screen.getByTestId('requirement-editor-field-machine-any').getAttribute('aria-pressed')).toBe('true');
        // The code follows the fields.
        fireEvent.click(screen.getByTestId('requirement-editor-field-model-sonnet'));
        fireEvent.click(screen.getByTestId('requirement-editor-field-effort-medium'));
        fireEvent.click(screen.getByTestId('requirement-editor-field-autonomy-implemented'));
        expect(spec.textContent).toBe('SRISM');
        expect(useRequirementFilerStore.getState().draft.ai_model).toBe('sonnet');
        fireEvent.click(spec);
        expect(settings.getAttribute('data-open')).toBe('0');
    });
    it('the capture\'s per-category details are behind a Details button that opens them inline', async () => {
        renderAll();
        await pressFile();
        const details = screen.getByTestId('requirement-editor-capture-details');
        const toggle = screen.getByTestId('requirement-editor-capture-details-toggle');
        expect(details.getAttribute('data-open')).toBe('0');
        expect(details.getAttribute('aria-hidden')).toBe('true');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);
        expect(details.getAttribute('data-open')).toBe('1');
        expect(details.getAttribute('aria-hidden')).toBe(null);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(details.contains(screen.getByTestId('requirement-editor-capture-toggle-console'))).toBe(true);
        fireEvent.click(toggle);
        expect(details.getAttribute('data-open')).toBe('0');
    });

    it('a failed capture write leaves the requirement filed with no pointer; Retry saves it', async () => {
        renderAll();
        await pressFile();
        fill('title', 'x');
        rest.mockResolvedValueOnce(ok([{ id: 3902 }]))
            .mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 500, httpMessage: 'boom' } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('#3902 saved, but its debug capture was not (HTTP 500 boom)'));
        expect(rest).toHaveBeenCalledTimes(2);                  // no description PUT
        expect(screen.getByTestId('requirement-editor-capture-status').textContent).toBe('not saved');
        // The selection that first send carried is fixed: no category can be dropped now.
        expect(screen.getByTestId('requirement-editor-capture-toggle-storage').disabled).toBe(true);
        const sentBundle = rest.mock.calls[1][2].bundle;
        // A foreign-key 409 (the requirement is gone) is a failure, not "already saved".
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 409, httpDetail: { errno: 1452 } } });
        fireEvent.click(screen.getByTestId('requirement-editor-capture-retry'));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toContain('#3902 saved, but its debug capture was not'));
        expect(rest.mock.calls[2][2].bundle).toBe(sentBundle);
        // A retry whose first attempt actually landed: a DUPLICATE-KEY 409 means the row is there.
        rest.mockRejectedValueOnce({ data: null, httpStatus: { httpStatus: 409, httpDetail: { errno: 1062 } } })
            .mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 200 } });
        fireEvent.click(screen.getByTestId('requirement-editor-capture-retry'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-capture-status').textContent).toBe('saved'));
        expect(rest.mock.calls[4][1]).toBe('PUT');
        expect(rest.mock.calls[4][2][0].description).toContain('darwin://requirement-debug/3902');
        expect(screen.queryByTestId('requirement-editor-error')).toBe(null);
    });

    it('File does not wait for the capture — the capture save does; one a reload lost files without one', async () => {
        renderAll();
        let key;
        act(() => { key = useRequirementFilerStore.getState().startNew(true); });
        fill('title', 'x');
        // Still capturing: File is offered anyway.
        expect(useRequirementFilerStore.getState().captureStage).toBe('capturing');
        expect(screen.getByTestId('requirement-editor-save').disabled).toBe(false);
        // What a reload persists: the capture never, a capture in progress as lost.
        const persisted = JSON.parse(localStorage.getItem('darwin_requirement_filer')).state;
        expect(persisted.capture).toBeUndefined();
        expect(persisted.captureStage).toBe('lost');
        rest.mockResolvedValueOnce(ok([{ id: 3903 }]))
            .mockResolvedValueOnce(ok([{ id: 5 }]))
            .mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 200 } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(1));
        // The capture lands after the requirement was filed; its save was waiting for it.
        const capture = await buildDebugCapture({ profile: { id: 'u' } });
        act(() => useRequirementFilerStore.getState().setCapture(key, capture));
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(3));
        expect(rest.mock.calls[1][2].requirement_fk).toBe(3903);

        // A capture a reload lost: nothing is said of it (req #3830) — the
        // requirement files without one.
        act(() => { useRequirementFilerStore.getState().startNew(true); });
        act(() => useRequirementFilerStore.setState({ captureStage: 'lost' }));
        expect(screen.queryByTestId('requirement-editor-capture')).toBe(null);
        expect(screen.queryByTestId('requirement-editor-capture-details-toggle')).toBe(null);
        fill('title', 'y');
        rest.mockResolvedValueOnce(ok([{ id: 3904 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-id-link').textContent).toBe('3904'));
        expect(rest).toHaveBeenCalledTimes(4);
    });

    it('dropping every category files the requirement with no capture at all', async () => {
        renderAll();
        await pressFile();
        fireEvent.click(screen.getByTestId('requirement-editor-capture-details-toggle'));
        for (const { key } of useRequirementFilerStore.getState().capture.categories) {
            fireEvent.click(screen.getByTestId(`requirement-editor-capture-toggle-${key}`));
        }
        fill('title', 'A plain request');
        rest.mockResolvedValueOnce(ok([{ id: 3905 }]));
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        await waitFor(() => expect(screen.getByTestId('requirement-editor-capture-status').textContent)
            .toBe('every category dropped — filed without one'));
        expect(rest).toHaveBeenCalledTimes(1);
        expect(rest.mock.calls[0][2]).not.toHaveProperty('description');
    });

    it('is addressable: ?filer=bug (the two-button era\'s link) files a new requirement with its capture', async () => {
        useRequirementFilerStore.setState({ show: false });
        renderAll({ at: '/maps?filer=bug' });
        await waitFor(() => expect(screen.getByTestId('requirement-editor-capture-status').textContent)
            .toMatch(/^\d+(\.\d)? (B|KB)$/));
        expect(screen.getByTestId('requirement-filer')).toBeTruthy();
        expect(useRequirementFilerStore.getState().capture.categories[0].key).toBe('filedFrom');
    });
});
