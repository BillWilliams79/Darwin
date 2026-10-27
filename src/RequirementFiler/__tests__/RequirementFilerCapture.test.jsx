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
import LastHoveredHighlight from '../LastHoveredHighlight';
import NavBarSidebar from '../../NavBar/NavBarSidebar';
import { useRequirementFilerStore } from '../../stores/useRequirementFilerStore';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import ThemeContext from '../../Theme/ThemeContext';
import { DEBUG_BLOCK_BEGIN, buildDebugCapture } from '../debugBundle';

const ok = (data) => ({ data, httpStatus: { httpStatus: 200, httpMessage: 'OK' } });

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

const renderAll = ({ nav = false, at = '/maps' } = {}) => render(
    <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={{ idToken: 't', profile: { userName: 'u', app_swarm: 1 } }}>
            <AppContext.Provider value={{ darwinUri: 'https://api/darwin_dev', database: 'darwin_dev' }}>
                <ThemeContext.Provider value={{ themeMode: 'system', effectiveMode: 'dark', setThemeMode: () => {} }}>
                    <MemoryRouter initialEntries={[at]}>
                        {nav && <NavBarSidebar />}
                        <RequirementFiler />
                        <RequirementEditorPopup />
                        <LastHoveredHighlight />
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
            draftKey: 0, orphaned: false, focusPending: false, creating: null, defaults: {}, filed: [],
            capture: null, captureDropped: [], captureStage: null, pinned: false,
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
        await filedThenShown(3901);
        expect(screen.getByTestId('requirement-editor-capture-status').textContent).toMatch(/^\d+(\.\d)? (B|KB)$/);

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
        // Create closed the editor (req #3860); the failed capture brings it back, with Retry.
        expect(screen.queryByTestId('requirement-editor')).toBe(null);
        await waitFor(() => expect(screen.getByTestId('requirement-editor-error').textContent)
            .toBe('#3902 saved, but its debug capture was not (HTTP 500 boom)'));
        expect(rest).toHaveBeenCalledTimes(2);                  // no description PUT
        expect(screen.getByTestId('requirement-editor-capture-status').textContent).toMatch(/^\d+(\.\d)? (B|KB)$/);
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
        await waitFor(() => expect(useRequirementFilerStore.getState().captureStage).toBe('done'));
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
        await filedThenShown(3904);
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
        await filedThenShown(3905);
        expect(screen.getByTestId('requirement-editor-capture-status').textContent).toBe('0 B');
        expect(rest).toHaveBeenCalledTimes(1);
        expect(rest.mock.calls[0][2]).not.toHaveProperty('description');
    });

    it('the trash can drops every category at once, and sits between Debug Capture and the size (req #3887)', async () => {
        renderAll();
        await pressFile();
        const toggle = screen.getByTestId('requirement-editor-capture-details-toggle');
        const trash = screen.getByTestId('requirement-editor-capture-drop-all');
        const size = screen.getByTestId('requirement-editor-capture-status');
        expect(toggle.nextElementSibling).toBe(trash);
        expect(trash.nextElementSibling).toBe(size);
        expect(trash.disabled).toBe(false);
        fireEvent.click(trash);
        const { capture, captureDropped } = useRequirementFilerStore.getState();
        expect(captureDropped.sort()).toEqual(capture.categories.map(c => c.key).sort());
        expect(trash.disabled).toBe(true);
    });

    it('the categories list Filed from first, a dashed rule, then the rest biggest to smallest (req #3887)', async () => {
        renderAll();
        await pressFile();
        fireEvent.click(screen.getByTestId('requirement-editor-capture-details-toggle'));
        const rows = [...screen.getByTestId('requirement-editor-capture-details').querySelectorAll('ul > li')];
        expect(rows[0].getAttribute('data-testid')).toBe('requirement-editor-capture-filedFrom');
        expect(rows[1].getAttribute('data-testid')).toBe('requirement-editor-capture-rule');
        const sizes = rows.slice(2).map(li => useRequirementFilerStore.getState().capture.categories
            .find(c => li.getAttribute('data-testid') === `requirement-editor-capture-${c.key}`).bytes);
        expect(sizes.length).toBe(useRequirementFilerStore.getState().capture.categories.length - 1);
        expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    });

    it('a + pressed while the last create is still being written keeps its capture (req #3860)', async () => {
        renderAll();
        await pressFile();
        fill('title', 'First');
        let landPost;
        rest.mockImplementationOnce(() => new Promise((r) => { landPost = r; }))
            .mockResolvedValueOnce(ok([{ id: 78, requirement_fk: 3906 }]))
            .mockResolvedValueOnce({ data: {}, httpStatus: { httpStatus: 200 } });
        fireEvent.click(screen.getByTestId('requirement-editor-save'));
        expect(screen.queryByTestId('requirement-editor')).toBe(null);
        fireEvent.click(screen.getByTestId('requirement-filer-add'));
        await act(async () => { landPost(ok([{ id: 3906 }])); });
        // The first one's capture row and description link are written whole…
        await waitFor(() => expect(rest).toHaveBeenCalledTimes(3));
        expect(rest.mock.calls[1][2].requirement_fk).toBe(3906);
        expect(rest.mock.calls[2][2][0].description).toContain('darwin://requirement-debug/3906');
        // …and only then does the + start the next, with a capture of its own.
        await waitFor(() => expect(screen.getByTestId('requirement-editor-field-title').value).toBe(''));
        expect(useRequirementFilerStore.getState().savedId).toBe(null);
        await waitFor(() => expect(useRequirementFilerStore.getState().captureStage).toBe('ready'));
    });

    it('is addressable: ?filer=bug (the two-button era\'s link) files a new requirement with its capture', async () => {
        useRequirementFilerStore.setState({ show: false });
        renderAll({ at: '/maps?filer=bug' });
        await waitFor(() => expect(screen.getByTestId('requirement-editor-capture-status').textContent)
            .toMatch(/^\d+(\.\d)? (B|KB)$/));
        expect(screen.getByTestId('requirement-filer')).toBeTruthy();
        expect(useRequirementFilerStore.getState().capture.categories[0].key).toBe('filedFrom');
    });

    it('ACCEPTANCE (req #3958): pinned, the filer dragged outlines what it flies over and + records it; unpinned, neither', async () => {
        renderAll({ at: '/swarm' });
        // jsdom lays nothing out: a requirement row on the page, the filer over it.
        const row = document.createElement('div');
        row.setAttribute('data-testid', 'requirement-3958');
        row.textContent = '3958 Requirement editor highlights its hover';
        document.body.appendChild(row);
        const box = (el, left, top, width, height) => {
            el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height });
        };
        box(row, 100, 300, 800, 40);
        const filer = screen.getByTestId('requirement-filer');
        box(filer, 200, 100, 200, 100);
        document.elementsFromPoint = (x, y) => [filer, row].filter((el) => {
            const r = el.getBoundingClientRect();
            return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
        });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        const head = screen.getByTestId('requirement-filer-header');
        const pin = screen.getByTestId('requirement-filer-pin');
        // The pushpin sits between the title and the ×.
        expect(pin.compareDocumentPosition(screen.getByTestId('requirement-filer-close')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(pin.getAttribute('aria-pressed')).toBe('false');
        // Unpinned: dragged over the row nothing is outlined, and + records no place.
        fireEvent.pointerDown(head, { button: 0, pointerId: 1, clientX: 250, clientY: 110 });
        fireEvent.pointerMove(head, { pointerId: 1, clientX: 250, clientY: 280 });
        expect(screen.queryByTestId('requirement-aim')).toBe(null);
        fireEvent.pointerUp(head, { pointerId: 1, clientX: 250, clientY: 280 });
        box(filer, 200, 270, 200, 100);
        await pressFile();
        expect(JSON.parse(useRequirementFilerStore.getState().capture.categories[0].text))
            .toMatchObject({ pointedAt: null, pointedAtReason: expect.stringMatching(/^not pinned/) });
        act(() => useRequirementFilerStore.getState().setEditorShow(false));

        // Pinned: pressing it outlines where it sits; dragged, it outlines the row; + records it.
        fireEvent.click(pin);
        expect(screen.getByTestId('requirement-filer-pin').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('requirement-aim').getAttribute('data-aim')).toBe('requirement-3958');
        fireEvent.pointerDown(head, { button: 0, pointerId: 2, clientX: 250, clientY: 280 });
        fireEvent.pointerMove(head, { pointerId: 2, clientX: 250, clientY: 290 });
        // Debounced (AIM_SETTLE_MS): the row is outlined once it has stayed under the filer.
        await waitFor(() => expect(screen.getByTestId('requirement-aim').getAttribute('data-aim')).toBe('requirement-3958'));
        const outline = screen.getByTestId('requirement-aim');
        expect([outline.style.left, outline.style.top]).toEqual(['100px', '300px']);
        fireEvent.pointerUp(head, { pointerId: 2, clientX: 250, clientY: 290 });
        expect(screen.queryByTestId('requirement-aim')).toBe(null);
        box(filer, 200, 280, 200, 100);
        await pressFile();
        const ff = JSON.parse(useRequirementFilerStore.getState().capture.categories[0].text);
        expect(ff.pointedAt[0].testidPath).toEqual(['requirement-3958']);
        expect(ff.popup.pinned).toBe(true);
        row.remove();
    });

    it('the outline is debounced (req #3958): the tile crossed between two cards never flashes', async () => {
        useRequirementFilerStore.setState({ pinned: true });
        renderAll({ at: '/swarm' });
        const box = (el, left, top, width, height) => {
            el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height });
        };
        const tile = document.createElement('div');
        tile.setAttribute('data-testid', 'category-card-862');
        const a = document.createElement('div');
        a.setAttribute('data-testid', 'requirement-1');
        const b = document.createElement('div');
        b.setAttribute('data-testid', 'requirement-2');
        tile.append(a, b);
        document.body.appendChild(tile);
        box(tile, 0, 0, 1000, 800);
        box(a, 0, 100, 1000, 100);
        box(b, 0, 260, 1000, 100);
        const filer = screen.getByTestId('requirement-filer');
        box(filer, 400, 100, 200, 100);
        document.elementsFromPoint = (x, y) => [filer, b, a, tile].filter((el) => {
            const r = el.getBoundingClientRect();
            return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
        });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        const seen = new Set();
        const watch = new MutationObserver(() => {
            const o = document.querySelector('[data-testid="requirement-aim"]');
            if (o) seen.add(o.getAttribute('data-aim'));
        });
        watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-aim'] });
        const head = screen.getByTestId('requirement-filer-header');
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        fireEvent.pointerDown(head, { button: 0, pointerId: 1, clientX: 450, clientY: 110 });
        // Centre (500, 160) over card 1, held: it is outlined.
        fireEvent.pointerMove(head, { pointerId: 1, clientX: 450, clientY: 120 });
        await waitFor(() => expect(screen.getByTestId('requirement-aim').getAttribute('data-aim')).toBe('requirement-1'));
        // Across the gap (the tile) and onto card 2, quickly.
        await wait(25);
        fireEvent.pointerMove(head, { pointerId: 1, clientX: 450, clientY: 190 });
        await wait(40);
        fireEvent.pointerMove(head, { pointerId: 1, clientX: 450, clientY: 260 });
        await waitFor(() => expect(screen.getByTestId('requirement-aim').getAttribute('data-aim')).toBe('requirement-2'));
        fireEvent.pointerUp(head, { pointerId: 1, clientX: 450, clientY: 260 });
        watch.disconnect();
        expect(seen.has('category-card-862')).toBe(false);
        expect([...seen]).toEqual(['requirement-1', 'requirement-2']);
        tile.remove();
    });

    it('Last hovered (req #3958): released pinned, + records it, outlined while the editor is open; dropped, the outline goes', async () => {
        useRequirementFilerStore.setState({ pinned: true });
        renderAll({ at: '/swarm' });
        const row = document.createElement('div');
        row.setAttribute('data-testid', 'requirement-55');
        row.textContent = 'Row 55';
        document.body.appendChild(row);
        const box = (el, left, top, width, height) => {
            el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height });
        };
        box(row, 100, 300, 800, 40);
        const filer = screen.getByTestId('requirement-filer');
        box(filer, 200, 100, 200, 100);
        document.elementsFromPoint = (x, y) => [filer, row].filter((el) => {
            const r = el.getBoundingClientRect();
            return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
        });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        const head = screen.getByTestId('requirement-filer-header');
        fireEvent.pointerDown(head, { button: 0, pointerId: 1, clientX: 250, clientY: 110 });
        fireEvent.pointerMove(head, { pointerId: 1, clientX: 250, clientY: 280 });   // centre (300, 320): the row
        fireEvent.pointerUp(head, { pointerId: 1, clientX: 250, clientY: 280 });
        box(filer, 200, 270, 200, 100);
        await pressFile();
        const cats = useRequirementFilerStore.getState().capture.categories;
        expect(cats[1].key).toBe('lastHovered');
        expect(JSON.parse(cats[1].text).testidPath).toEqual(['requirement-55']);
        // While the editor shows it: the one highlight on the row, at 30%, labelled.
        await waitFor(() => expect(screen.getByTestId('requirement-aim-recorded').getAttribute('data-aim')).toBe('requirement-55'));
        const rec = screen.getByTestId('requirement-aim-recorded');
        expect(rec.style.opacity).toBe('0.3');
        expect(rec.style.border).toContain('solid');
        // A pinned drag draws its own: the recorded one steps aside — one highlight.
        fireEvent.pointerDown(head, { button: 0, pointerId: 4, clientX: 250, clientY: 280 });
        fireEvent.pointerMove(head, { pointerId: 4, clientX: 250, clientY: 290 });
        await waitFor(() => expect(screen.getByTestId('requirement-aim')).toBeTruthy());
        await waitFor(() => expect(screen.queryByTestId('requirement-aim-recorded')).toBe(null));
        fireEvent.pointerUp(head, { pointerId: 4, clientX: 250, clientY: 290 });
        await waitFor(() => expect(screen.getByTestId('requirement-aim-recorded')).toBeTruthy());
        expect(screen.getByTestId('requirement-aim-recorded-name').textContent).toBe('requirement-55 · last hovered');
        // Listed right after Filed from; dropping it takes the outline with it.
        fireEvent.click(screen.getByTestId('requirement-editor-capture-details-toggle'));
        expect(screen.getByTestId('requirement-editor-capture-lastHovered').textContent).toContain('Last hovered');
        fireEvent.click(screen.getByTestId('requirement-editor-capture-toggle-lastHovered'));
        await waitFor(() => expect(screen.queryByTestId('requirement-aim-recorded')).toBe(null));
        fireEvent.click(screen.getByTestId('requirement-editor-capture-toggle-lastHovered'));
        await waitFor(() => expect(screen.getByTestId('requirement-aim-recorded')).toBeTruthy());
        // Closed, the editor shows nothing — and neither does the outline.
        act(() => useRequirementFilerStore.getState().setEditorShow(false));
        await waitFor(() => expect(screen.queryByTestId('requirement-aim-recorded')).toBe(null));
        row.remove();
    });
});
