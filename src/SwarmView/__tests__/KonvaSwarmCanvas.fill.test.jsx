// @vitest-environment jsdom
//
// req #3793 — maximized, the Swarm visualizer's canvas FILLS the full-window
// layer (a flex item taking what the header row leaves) instead of its page
// height, and its ResizeObserver then redraws it at that size. Not maximized it
// keeps the page-relative height it always had. react-konva is stubbed: jsdom
// has no canvas, and this pins only the container's sizing.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{children}</div>;
    return {
        Stage: Stub, Layer: Stub, Group: Stub,
        Rect: () => null, Circle: () => null, Line: () => null, Text: () => null, Path: () => null,
    };
});

if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

import KonvaSwarmCanvas from '../KonvaSwarmCanvas';

const props = {
    requirements: [], allRequirements: [], sessions: [],
    swarmStarts: [], swarmStartSessions: [], swarmUndos: [],
    swarmCompletes: [], swarmCompleteSessions: [], devServers: [],
    selectedDate: '2026-10-22', timezone: 'UTC', categoryList: [],
    rangeStart: '2026-10-20', rangeEnd: '2026-10-22',
};

afterEach(cleanup);

describe('KonvaSwarmCanvas — fill (req #3793)', () => {
    it('keeps its page-relative height by default', () => {
        const { getByTestId } = render(<KonvaSwarmCanvas {...props} />);
        const el = getByTestId('konva-swarm-canvas');
        expect(el.style.height).toBe('calc(100vh - 150px)');
        expect(el.style.minHeight).toBe('480px');
    });

    it('fills its flex parent when the view is maximized', () => {
        const { getByTestId } = render(<KonvaSwarmCanvas {...props} fill />);
        const el = getByTestId('konva-swarm-canvas');
        expect(el.style.height).toBe('');
        expect(el.style.flexGrow).toBe('1');
        expect(el.style.flexBasis).toMatch(/^0(px)?$/);
        expect(el.style.minHeight).toMatch(/^0(px)?$/);
    });
});
