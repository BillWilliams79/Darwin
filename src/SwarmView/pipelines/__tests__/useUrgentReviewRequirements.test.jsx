// @vitest-environment jsdom
//
// req #3622 — the Urgent Review box's reads: loading until the session reads
// land, an error only when a SESSION read fails, and a failed title read still
// lists the waiting requirements by id.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const reads = vi.hoisted(() => ({ junction: {}, sessions: {}, reqs: {} }));
vi.mock('../../../hooks/useDataQueries', () => ({
    useAllRequirementSessions: () => reads.junction,
    useAllSessionCostRollups: () => reads.sessions,
    useAllRequirements: () => reads.reqs,
}));

import { useUrgentReviewRequirements } from '../useUrgentReviewRequirements';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
let result;
function Probe() {
    result = useUrgentReviewRequirements('me');
    return null;
}
const render = () => act(() => root.render(<Probe />));

const JUNCTION = [{ requirement_fk: 7, session_fk: 70 }, { requirement_fk: 8, session_fk: 80 }];
const SESSIONS = [{ id: 70, swarm_status: 'review' }, { id: 80, swarm_status: 'active' }];

beforeEach(() => {
    host = document.createElement('div');
    root = createRoot(host);
    reads.junction = { data: JUNCTION };
    reads.sessions = { data: SESSIONS };
    reads.reqs = { data: [{ id: 7, title: 'Seven' }, { id: 8, title: 'Eight' }] };
});
afterEach(() => act(() => root.unmount()));

describe('useUrgentReviewRequirements', () => {
    it('lists requirements whose latest session waits on the user', () => {
        render();
        expect(result).toEqual({
            items: [{ id: 7, title: 'Seven', sessionStatus: 'review' }],
            isLoading: false, isError: false,
        });
    });

    it('is loading, not empty, until every read has settled', () => {
        reads.sessions = { data: undefined };
        render();
        expect(result).toEqual({ items: [], isLoading: true, isError: false });
        reads.sessions = { data: SESSIONS };
        reads.reqs = { data: undefined };
        render();
        expect(result.isLoading).toBe(true);
    });

    it('is an error when a session read fails', () => {
        reads.junction = { data: undefined, isError: true };
        render();
        expect(result).toEqual({ items: [], isLoading: false, isError: true });
    });

    it('still lists by id when only the title read fails', () => {
        reads.reqs = { data: undefined, isError: true };
        render();
        expect(result).toEqual({
            items: [{ id: 7, title: '', sessionStatus: 'review' }],
            isLoading: false, isError: false,
        });
    });

    it('keeps the last good rows through a failed background refetch', () => {
        reads.sessions = { data: SESSIONS, isError: true };
        render();
        expect(result.isError).toBe(false);
        expect(result.items.map((r) => r.id)).toEqual([7]);
    });
});
