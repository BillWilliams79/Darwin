// @vitest-environment jsdom
//
// req #3872 — zoomed out to the Overview level the canvas swaps beads for
// sized/coloured density dots, and those dots must keep the bead's hover
// datacard (session details) and click-to-open. react-konva is stubbed so each
// Circle's props are inspectable; a wheel event drives d3-zoom to the Overview.

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

const circles = [];
vi.mock('react-konva', async () => {
    const R = await import('react');
    // Each Stage render re-captures the Circles drawn beneath it, so `circles`
    // holds only the latest frame.
    const Stub = R.forwardRef(({ children }, ref) => {
        circles.length = 0;
        R.useImperativeHandle(ref, () => ({ container: () => ({ style: {} }), getIntersection: () => null }));
        return <div>{children}</div>;
    });
    return {
        Stage: Stub, Layer: ({ children }) => <div>{children}</div>, Group: ({ children }) => <div>{children}</div>,
        Circle: (p) => { circles.push(p); return null; },
        Rect: () => null, Line: () => null, Text: () => null, Path: () => null,
    };
});

if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
const sizeProps = ['clientWidth', 'clientHeight'].map(k => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)]);
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
});
afterAll(() => {
    for (const [k, d] of sizeProps) {
        if (d) Object.defineProperty(HTMLElement.prototype, k, d);
        else delete HTMLElement.prototype[k];
    }
});

import KonvaSwarmCanvas from '../KonvaSwarmCanvas';

const date = '2026-06-10';
const requirements = [{
    id: 901, title: 'Test req', completed_at: '2026-06-10 18:00:00',
    category_fk: 1, requirement_status: 'met', coordination_type: 'implemented',
}];
const sessions = [{
    id: 5001, source_ref: 'requirement:901', swarm_status: 'completed',
    started_at: '2026-06-10 09:00:00',
}];
const props = {
    requirements, allRequirements: requirements, sessions,
    swarmStarts: [], swarmStartSessions: [], swarmUndos: [],
    swarmCompletes: [], swarmCompleteSessions: [], devServers: [],
    selectedDate: date, timezone: 'UTC',
    categoryList: [{ id: 1, category_name: 'Swarm', color: '#1976d2' }],
    rangeStart: date, rangeEnd: date,
};

afterEach(() => { cleanup(); circles.length = 0; });

describe('KonvaSwarmCanvas — Overview hover (req #3872)', () => {
    it('keeps the hover datacard and click-to-open on Overview dots', () => {
        const onLevelChange = vi.fn();
        const onChipClick = vi.fn();
        const { getByTestId, queryByText } = render(
            <KonvaSwarmCanvas {...props} onLevelChange={onLevelChange} onChipClick={onChipClick} />);
        const canvas = getByTestId('konva-swarm-canvas');

        act(() => { fireEvent.wheel(canvas, { deltaY: 2000, clientX: 600, clientY: 350 }); });
        expect(getByTestId('konva-zoom-level').textContent).toMatch(/^Overview/);
        expect(onLevelChange).toHaveBeenLastCalledWith('out');

        // Overview draws exactly one Circle per completion — the dot itself.
        expect(circles).toHaveLength(1);
        const [dot] = circles;
        expect(dot.onMouseEnter).toBeTypeOf('function');

        const stage = { getPointerPosition: () => ({ x: 100, y: 120 }), container: () => ({ style: {} }) };
        act(() => { dot.onMouseEnter({ target: { getStage: () => stage } }); });
        expect(queryByText(/Test req/)).toBeTruthy();

        act(() => { dot.onMouseLeave({ target: { getStage: () => stage } }); });
        expect(queryByText(/Test req/)).toBeNull();

        dot.onActivate();
        expect(onChipClick).toHaveBeenCalledWith(901);
    });
});
