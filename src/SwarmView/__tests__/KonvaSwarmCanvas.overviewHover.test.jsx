// @vitest-environment jsdom
//
// req #3872 — zoomed out to the Overview level the canvas swaps beads for
// sized/coloured density dots, and those dots must keep the bead's hover
// datacard (session details) and click-to-open. react-konva is stubbed so each
// Circle's props are inspectable; a wheel event drives d3-zoom to the Overview.

import React from 'react';
import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { createTheme } from '@mui/material/styles';
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

// req #3876 — an in-flight requirement's dot keeps the incomplete look at
// Overview: a category-colour ring on the outside, the larger centre clear.
describe('KonvaSwarmCanvas — Overview in-flight dot (req #3876)', () => {
    // Pinned mid-day: with the 36h window a start just after UTC midnight
    // would put both chips on two rows.
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    it('draws an in-flight dot as a category ring with a clear centre; a completed dot stays solid', () => {
        const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
        const now = new Date();
        const start = new Date(now.getTime() - 5 * 60 * 1000);
        const today = fmt(now).slice(0, 10);
        const startDay = fmt(start).slice(0, 10);
        const done = { ...requirements[0], completed_at: `${today} 00:00:01` };
        const open = {
            id: 902, title: 'Open req', completed_at: null,
            category_fk: 1, requirement_status: 'development', coordination_type: 'implemented',
        };
        const live = { id: 5002, source_ref: 'requirement:902', swarm_status: 'active', started_at: fmt(start) };
        render(<KonvaSwarmCanvas {...props}
            requirements={[done, open]} allRequirements={[done, open]}
            sessions={[{ ...sessions[0], started_at: `${today} 00:00:00` }, live]}
            swarmStarts={[{ id: 77, started_at: fmt(start), arguments: '902' }]}
            swarmStartSessions={[{ swarm_start_fk: 77, session_fk: 5002 }]}
            selectedDate={today} rangeStart={startDay} rangeEnd={today} />);
        const canvas = document.querySelector('[data-testid="konva-swarm-canvas"]');
        act(() => { fireEvent.wheel(canvas, { deltaY: 2000, clientX: 600, clientY: 350 }); });
        expect(document.querySelector('[data-testid="konva-zoom-level"]').textContent).toMatch(/^Overview/);

        expect(circles).toHaveLength(2);
        const ringed = circles.filter(c => c.strokeWidth > 0);
        const solid = circles.filter(c => !(c.strokeWidth > 0));
        expect(ringed).toHaveLength(1);
        expect(solid).toHaveLength(1);
        expect(ringed[0].stroke).toBe('#1976d2');
        expect(ringed[0].fill).toBe(createTheme().palette.text.secondary);
        expect(solid[0].fill).toBe('#1976d2');
        expect(solid[0].stroke).toBeUndefined();
    });
});
