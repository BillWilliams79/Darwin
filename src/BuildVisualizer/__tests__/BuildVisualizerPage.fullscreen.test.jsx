// @vitest-environment jsdom
//
// req #3793 — the Build visualizer's full screen switch, through the REAL page
// and its REAL control row. The user's rule: a visualizer whose controls are on
// screen keeps the switch in the controls' title row — here, right after the
// project's name (the row's title, inside the File menu), ahead of the first
// divider. Maximized, the page becomes the fixed full-window layer over the
// navbar, and the control row STAYS, so the switch never moves. The full screen
// mechanics themselves (browser full screen, Esc, the rack) are the shared
// hook's, pinned in `PipelinePlanVisualizer.maximize.test.jsx`; this pins the
// wiring.
//
// Mocked: the canvas (a stub), the File menu (a stub carrying the project
// name), the two data hooks and the REST client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../BuildVisualizerCanvas', () => ({
    default: () => <div data-testid="canvas-stub" />,
}));
vi.mock('../BuildPatternMenu', () => ({
    default: () => <span data-testid="bv-project-name">Exemplar</span>,
}));
vi.mock('../useBuildPatterns', () => ({
    useBuildPatterns: () => ({
        activePattern: { id: 14, projectId: 14, name: 'Exemplar' },
        isReady: true,
        error: null,
    }),
}));
vi.mock('../useBuildVisualizerData', () => ({
    useBuildVisualizerData: () => ({
        isInitialLoad: false, error: null,
        model: { branches: [], builds: {}, releaseEvents: {}, releaseEventDetails: {} },
    }),
}));
vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(async () => ({ data: [] })) }));
vi.mock('../../hooks/factory/createEntityQueries', () => ({
    fetchEntity: vi.fn(async () => []),
}));

import BuildVisualizerPage from '../BuildVisualizerPage';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { usePanelRackStore } from '../../stores/usePanelRackStore';

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AppContext.Provider value={{ darwinBuildVizUri: 'https://api.test/darwin_dev' }}>
                <AuthContext.Provider value={{ idToken: 'tok', profile: { id: 'creator-1' } }}>
                    <BuildVisualizerPage />
                </AuthContext.Provider>
            </AppContext.Provider>
        </QueryClientProvider>,
    );
}

const page = () => screen.getByTestId('build-visualizer-page');
const sw = () => screen.getByTestId('build-viz-fullscreen');

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
    cleanup();
    document.documentElement.style.overflow = '';
});

describe('Build visualizer — the full screen switch (req #3793)', () => {
    it('sits in the control row, right after the project name, before the first divider', () => {
        renderPage();
        const row = screen.getByTestId('build-visualizer-controls');
        expect(row.contains(sw())).toBe(true);
        expect(screen.getAllByTestId('build-viz-fullscreen')).toHaveLength(1);
        expect(sw().previousElementSibling).toBe(screen.getByTestId('bv-project-name'));
        expect(sw().nextElementSibling.className).toMatch(/MuiDivider/);
        expect(sw().getAttribute('aria-pressed')).toBe('false');
        expect(sw().getAttribute('aria-label')).toBe('Full screen — only the build visualizer');
        expect(sw().querySelector('path').getAttribute('d'))
            .toBe('M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5');
        expect(page().getAttribute('data-maximized')).toBe('false');
    });

    it('maximizes the page over the navbar, the controls (and the switch) staying on screen', () => {
        renderPage();
        act(() => { fireEvent.click(sw()); });
        expect(page().getAttribute('data-maximized')).toBe('true');
        const cs = getComputedStyle(page());
        expect(cs.position).toBe('fixed');
        expect(cs.zIndex).toBe('1250');
        // The row stays, and the switch with it — now the restore glyph.
        expect(screen.getByTestId('build-visualizer-controls').contains(sw())).toBe(true);
        expect(sw().getAttribute('aria-pressed')).toBe('true');
        expect(sw().getAttribute('aria-label')).toBe('Leave full screen');
        expect(sw().querySelector('path').getAttribute('d'))
            .toBe('M6 1v5H1M15 6h-5V1M10 15v-5h5M1 10h5v5');
        // The canvas is still the page's second grid row, which fills the layer.
        expect(page().contains(screen.getByTestId('canvas-stub'))).toBe(true);
        expect(usePanelRackStore.getState().covered).toBe(true);
        act(() => { fireEvent.click(sw()); });
        expect(page().getAttribute('data-maximized')).toBe('false');
        expect(usePanelRackStore.getState().covered).toBe(false);
    });

    it('Esc leaves', () => {
        vi.useFakeTimers();
        try {
            renderPage();
            act(() => { fireEvent.click(sw()); });
            expect(page().getAttribute('data-maximized')).toBe('true');
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                vi.runAllTimers();
            });
            expect(page().getAttribute('data-maximized')).toBe('false');
        } finally { vi.useRealTimers(); }
    });
});
