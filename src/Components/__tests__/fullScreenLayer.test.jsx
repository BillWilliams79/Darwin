// @vitest-environment jsdom
//
// Req #4053 — the Requirement Filer stays on screen in every full screen mode:
// each one sits on FULL_SCREEN_Z, below the filer and its editor, and covers
// the navbar (so a racked filer floats) until the LAST of them ends; the AI
// Architecture frame's full screen is read from its stages' overlay classes;
// the Pipelines group view takes the browser's full screen on the document,
// never on its stage.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { FULL_SCREEN_DIALOG_PROPS, FULL_SCREEN_Z, useCoverNavbar } from '../fullScreenLayer';
import { EDITOR_Z, FILER_Z } from '../../RequirementFiler/filerHover';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import { useFrameFullScreen } from '../../Systems/SystemsPage2';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
beforeEach(() => {
    usePanelRackStore.setState({ covered: false, covers: 0 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

describe('the full screen layer (req #4053)', () => {
    it('is over the navbar and under the Requirement Filer, its editor and MUI modals', () => {
        expect(FULL_SCREEN_Z).toBeGreaterThan(1200);            // MUI's drawer — the navbar
        expect(FULL_SCREEN_Z).toBeLessThan(FILER_Z);
        expect(FULL_SCREEN_Z).toBeLessThan(EDITOR_Z);
        expect(FULL_SCREEN_DIALOG_PROPS).toEqual({ disableEnforceFocus: true, sx: { zIndex: FULL_SCREEN_Z } });
    });

    it('covers the navbar until the last full screen mode ends', () => {
        const Cover = ({ on }) => { useCoverNavbar(on); return null; };
        const draw = (a, b) => act(() => root.render(<><Cover on={a} /><Cover on={b} /></>));
        draw(true, false);
        expect(usePanelRackStore.getState().covered).toBe(true);
        draw(true, true);                                       // a map's full screen inside a full-screen dialog
        draw(true, false);                                      // the inner one ends first
        expect(usePanelRackStore.getState().covered).toBe(true);
        draw(false, false);
        expect(usePanelRackStore.getState()).toMatchObject({ covered: false, covers: 0 });
    });
});

describe('useFrameFullScreen — the AI Architecture frame (req #4053)', () => {
    it('follows a stage taking and leaving its full screen overlay', async () => {
        const frame = document.createElement('iframe');
        await new Promise((resolve) => { frame.addEventListener('load', resolve, { once: true }); document.body.appendChild(frame); });
        const doc = frame.contentDocument;
        doc.body.innerHTML = '<div class="stage"><div class="tpu3d" id="x-stage"></div></div>';
        const seen = [];
        const Probe = () => { seen.push(useFrameFullScreen({ current: frame })); return null; };
        await act(async () => root.render(<Probe />));
        expect(seen.at(-1)).toBe(false);
        await act(async () => doc.querySelector('.stage').classList.add('s2-full'));
        expect(seen.at(-1)).toBe(true);
        await act(async () => doc.querySelector('.stage').classList.remove('s2-full'));
        expect(seen.at(-1)).toBe(false);
        await act(async () => doc.querySelector('.tpu3d').classList.add('tpu3d-full'));
        expect(seen.at(-1)).toBe(true);
    });

    it('hands an Esc pressed in Darwin to the frame while a view is full', async () => {
        try {
            const { default: SystemsPage2 } = await import('../../Systems/SystemsPage2');
            const { MemoryRouter } = await import('react-router-dom');
            await act(async () => root.render(<MemoryRouter><SystemsPage2 /></MemoryRouter>));
            const frame = document.querySelector('iframe');
            expect(frame.hasAttribute('data-host-fullscreen')).toBe(true);
            // jsdom loads no page: the frame is pointed at a blank one to stand in for it.
            await act(async () => new Promise((resolve) => {
                frame.addEventListener('load', resolve, { once: true });
                frame.src = 'about:blank';
            }));
            const doc = frame.contentDocument;
            doc.body.innerHTML = '<div class="stage"></div>';
            await act(async () => frame.dispatchEvent(new Event('load')));   // the stage is in now: re-attach
            await act(async () => doc.querySelector('.stage').classList.add('s2-full'));
            expect(document.querySelector('[data-testid="systems2-page"]').dataset.full).toBe('true');
            const got = vi.fn();
            frame.contentWindow.addEventListener('keydown', (e) => got(e.key));
            vi.useFakeTimers();
            act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); vi.runAllTimers(); });
            expect(got).toHaveBeenCalledWith('Escape');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('PipelineGroupView — full screen on the document (req #4053)', () => {
    it('requests the document\'s full screen, draws the stage on the layer and covers the navbar', async () => {
        vi.resetModules();
        vi.doMock('../../Pipelines/pipelineGroupScene', () => ({
            webglAvailable: () => true,
            createPipelineGroupScene: () => ({
                setModel: vi.fn(), setFocus: vi.fn(), preset: vi.fn(), setRotate: vi.fn(), dispose: vi.fn(),
                state: () => ({ preset: 'iso' }),
            }),
        }));
        vi.doMock('../../hooks/useDataQueries', () => ({
            useComposedPipelines: (ids) => ids.map(() => ({ isLoading: false, data: null })),
        }));
        const { default: PipelineGroupView } = await import('../../Pipelines/PipelineGroupView');
        const { usePanelRackStore: store } = await import('../../stores/usePanelRackStore');
        const stageReq = vi.fn(() => Promise.resolve());
        const docReq = vi.fn(() => Promise.resolve());
        document.documentElement.requestFullscreen = docReq;
        try {
            await act(async () => root.render(
                <PipelineGroupView pipelines={[{ id: 1, title: 'P', pipeline_status: 'orchestrating', sort_order: 1 }]}
                                   onFocusChange={() => {}} onOpen={() => {}} />));
            const stage = document.querySelector('[data-testid="pipelines-group-stage"]');
            stage.requestFullscreen = stageReq;
            await act(async () => document.querySelector('[data-testid="pipelines-group-fullscreen"]').click());
            expect(docReq).toHaveBeenCalledTimes(1);
            expect(stageReq).not.toHaveBeenCalled();
            expect(stage.dataset.full).toBe('native');
            const css = getComputedStyle(stage);
            expect([css.position, css.zIndex]).toEqual(['fixed', String(FULL_SCREEN_Z)]);
            expect(store.getState().covered).toBe(true);
        } finally {
            delete document.documentElement.requestFullscreen;
            vi.doUnmock('../../Pipelines/pipelineGroupScene');
            vi.doUnmock('../../hooks/useDataQueries');
        }
    });
});
