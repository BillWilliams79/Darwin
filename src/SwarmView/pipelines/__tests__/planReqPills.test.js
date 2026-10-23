// planReqPills.test.js — req #3587: a requirement row on the plan visualizer
// reads `3572  Terminal 2  3002  Title`, the middle two tokens drawn as pills.
//
// Two halves: the JOIN (`buildReqPills` — which session, which terminal, which
// port) and the LAYOUT (`reqPillPrefix` / `computePlanLayout` — the tokens are
// measured text, and the label hands the renderer their character ranges).

import { describe, it, expect } from 'vitest';

import { buildReqPills, NOT_LIVE_SESSION_STATUSES } from '../planReqPills';
import { TERMINAL_STATE } from '../../terminalFocus';
import {
    computePlanLayout, reqLabelText, reqPillPrefix, REQ_PILL_SEP, CHW_REQ, CARD_SEP_CHARS,
} from '../pipelinePlanLayout';

const MAC = { id: 1, title: 'Mac Mini', platform: 'darwin', hostname: 'mini', closed: 0 };
const MAC_NAV = { platform: 'MacIntel' };

describe('buildReqPills — the join', () => {
    it('names the live session\'s terminal and its claimed dev server', () => {
        const m = buildReqPills({
            requirementSessions: [{ requirement_fk: 3572, session_fk: 10 }],
            sessions: [{ id: 10, swarm_status: 'active', terminal_number: 2,
                terminal_window_id: '555', machine_fk: 1 }],
            devServers: [{ id: 7, session_fk: 10, port: 3002, machine_fk: 1 }],
            machines: [MAC], nav: MAC_NAV,
        });
        const p = m.get(3572);
        expect(p.terminal.label).toBe('Terminal 2');
        expect(p.terminal.state).toBe(TERMINAL_STATE.LINK);
        expect(p.terminal.href).toMatch(/^darwin-term:\/\/focus\?/);
        expect(p.devServer).toMatchObject({ port: '3002', url: 'https://localhost:3002',
            local: true });
    });

    it('a port on ANOTHER machine is drawn but not local — localhost here is a different server', () => {
        const WSL = { id: 3, title: 'MCHP Windows', platform: 'wsl', closed: 0 };
        const sources = {
            requirementSessions: [{ requirement_fk: 1, session_fk: 10 }],
            sessions: [{ id: 10, swarm_status: 'active', machine_fk: 3 }],
            devServers: [{ id: 7, session_fk: 10, port: 3001, machine_fk: 3 }],
            machines: [MAC, WSL],
        };
        const fromMac = buildReqPills({ ...sources, nav: MAC_NAV }).get(1).devServer;
        expect(fromMac.port).toBe('3001');
        expect(fromMac.local).toBe(false);
        expect(fromMac.title).toMatch(/MCHP Windows/);
        // From the WSL machine's own browser it IS local.
        expect(buildReqPills({ ...sources, nav: { platform: 'Win32' } }).get(1).devServer.local)
            .toBe(true);
        // A machine this browser cannot resolve is never claimed local.
        expect(buildReqPills({ ...sources, machines: undefined, nav: MAC_NAV })
            .get(1).devServer.local).toBe(false);
    });

    it('takes the NEWEST live session, and ignores completed and paused ones', () => {
        expect(NOT_LIVE_SESSION_STATUSES).toEqual(['completed', 'paused']);
        const m = buildReqPills({
            requirementSessions: [
                { requirement_fk: 1, session_fk: 10 },
                { requirement_fk: 1, session_fk: 11 },
                { requirement_fk: 1, session_fk: 12 },
                { requirement_fk: 2, session_fk: 20 },
                { requirement_fk: 3, session_fk: 30 },
            ],
            sessions: [
                { id: 10, swarm_status: 'active', terminal_number: 4 },
                { id: 11, swarm_status: 'review', terminal_number: 5 },
                { id: 12, swarm_status: 'completed', terminal_number: 6 },
                { id: 20, swarm_status: 'completed', terminal_number: 7 },
                { id: 30, swarm_status: 'paused', terminal_number: 8 },
            ],
            devServers: [], machines: [MAC], nav: MAC_NAV,
        });
        expect(m.get(1).terminal.label).toBe('Terminal 5');
        // Finished or paused work has no terminal — and so no entry at all.
        expect(m.has(2)).toBe(false);
        expect(m.has(3)).toBe(false);
    });

    it('a claimed dev server is its own proof of life, and lends its terminal number', () => {
        const m = buildReqPills({
            requirementSessions: [{ requirement_fk: 9, session_fk: 40 }],
            sessions: [{ id: 40, swarm_status: 'completed', terminal_number: null }],
            devServers: [{ id: 1, session_fk: 40, port: 3007, terminal_number: 3 },
                { id: 2, session_fk: 40, port: 3008 }],
            machines: [MAC], nav: MAC_NAV,
        });
        const p = m.get(9);
        // Newest claim wins (highest id), the Swarm visualizer's tie-break.
        expect(p.devServer.port).toBe('3008');
        expect(m.get(9).terminal).toBe(null);
    });

    it('uses the claim\'s terminal number when the live session recorded none', () => {
        const m = buildReqPills({
            requirementSessions: [{ requirement_fk: 9, session_fk: 40 }],
            sessions: [{ id: 40, swarm_status: 'active', terminal_number: null, machine_fk: 1 }],
            devServers: [{ id: 1, session_fk: 40, port: 3007, terminal_number: 3 }],
            machines: [MAC], nav: MAC_NAV,
        });
        expect(m.get(9).terminal.label).toBe('Terminal 3');
        // A number with no window handle is shown but cannot be focused.
        expect(m.get(9).terminal.state).toBe(TERMINAL_STATE.NO_HANDLE);
        expect(m.get(9).terminal.href).toBe(null);
    });

    it('a terminal on another machine is shown, not clickable', () => {
        const m = buildReqPills({
            requirementSessions: [{ requirement_fk: 5, session_fk: 50 }],
            sessions: [{ id: 50, swarm_status: 'active', terminal_number: 1,
                terminal_window_id: '9', machine_fk: 3 }],
            devServers: [],
            machines: [MAC, { id: 3, title: 'MCHP', platform: 'wsl', closed: 0 }],
            nav: MAC_NAV,
        });
        expect(m.get(5).terminal.state).toBe(TERMINAL_STATE.REMOTE);
        expect(m.get(5).terminal.href).toBe(null);
    });

    it('empty or missing inputs yield an empty map', () => {
        expect(buildReqPills().size).toBe(0);
        expect(buildReqPills({ requirementSessions: [] }).size).toBe(0);
        expect(buildReqPills({ requirementSessions: [{ requirement_fk: 1, session_fk: 2 }] })
            .size).toBe(0);
    });
});

describe('reqPillPrefix / reqLabelText — the tokens are text', () => {
    const pills = new Map([
        [3572, { terminal: { label: 'Terminal 2' }, devServer: { port: '3002' } }],
        [3573, { terminal: null, devServer: { port: '3004' } }],
        [3574, { terminal: { label: 'Terminal 11' }, devServer: null }],
    ]);

    it('reads `id   Terminal N  PORT   Title`, with ranges on the tokens', () => {
        const titles = new Map([[3572, 'Title']]);
        const text = reqLabelText(3572, {
            reqLabel: 'title', reqTitles: titles, reqPills: pills, maxChars: 84 });
        expect(text.replace(/ /g, ' ')).toBe('3572  Terminal 2  3002  Title');
        const { text: prefix, pills: ranges } = reqPillPrefix(3572, pills);
        expect(ranges.map((r) => prefix.slice(r.start, r.start + r.len)))
            .toEqual(['Terminal 2', '3002']);
        expect(ranges.map((r) => r.kind)).toEqual(['terminal', 'devserver']);
        expect(REQ_PILL_SEP).toBe('  ');
    });

    it('either pill alone, and none at all', () => {
        expect(reqPillPrefix(3573, pills).text).toBe('3573  3004');
        expect(reqPillPrefix(3574, pills).text).toBe('3574  Terminal 11');
        expect(reqPillPrefix(1, pills)).toEqual({ text: '1', pills: [] });
        expect(reqPillPrefix(1, null)).toEqual({ text: '1', pills: [] });
        // id mode carries the pills too.
        expect(reqLabelText(3573, { reqLabel: 'id', reqPills: pills })).toBe('3573  3004');
    });

    // req #3601 — the id owns a column (`id   `, the hanging indent's width)
    // and the first pill starts ON its far edge, where every title starts,
    // never inside it.
    it('the first pill starts on the title column, never inside the id column', () => {
        for (const id of [3572, 3573, 3574]) {
            const { pills: ranges } = reqPillPrefix(id, pills);
            expect(ranges[0].start).toBe(String(id).length + CARD_SEP_CHARS);
        }
        expect(reqPillPrefix(7, new Map([[7, { terminal: { label: 'Terminal 1' } }]]))
            .pills[0].start).toBe(1 + CARD_SEP_CHARS);
    });
});

describe('computePlanLayout — pills on the requirement rows', () => {
    const rows = [{
        id: 1, title: 'Epic one', run: 'auto', state: 'running', reqIds: [3572, 3573, 9],
        depIds: [], timeDeps: [], initiativeId: 1, initiative: 'E1',
        initiativeLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    }];
    const reqTitles = new Map([
        [3572, 'Visualizer show dev server and terminal on requirement'],
        [3573, 'Short'], [9, 'No session here'],
    ]);
    const reqPills = new Map([
        [3572, { terminal: { label: 'Terminal 2' }, devServer: { port: '3002' } }],
        [3573, { terminal: null, devServer: { port: '3004' } }],
    ]);

    it('emits the token ranges on the first line, and the prefix as the L1/L2 id text', () => {
        const l = computePlanLayout(rows, { epicLabel: 'title', reqLabel: 'title', reqTitles, reqPills });
        const reqs = l.labels.filter((x) => x.kind === 'req');
        const a = reqs.find((x) => x.reqId === 3572);
        expect(a.lines[0].startsWith(a.idText)).toBe(true);
        expect(a.idText.replace(/ /g, ' ')).toBe('3572  Terminal 2  3002');
        expect(a.pills.map((p) => a.lines[0].slice(p.start, p.start + p.len)))
            .toEqual(['Terminal 2', '3002']);
        // The id text never leaves the box the overlap sweep measured.
        expect(a.idW).toBeLessThanOrEqual(a.w);
        expect(a.idW).toBe(a.idText.length * CHW_REQ);
        // A pill is never split across lines.
        expect(a.lines.slice(1).some((ln) => ln.includes('Terminal'))).toBe(false);
        // req #3575 — a pill row's continuations hang at the BARE id's column
        // (`3572  `), the same column every other row's title uses, not past
        // the pills where the first line's title happens to start.
        expect(a.lines.length).toBeGreaterThan(1);
        for (const ln of a.lines.slice(1)) {
            expect(ln.slice(0, 6)).toBe(' '.repeat(6));
            expect(ln[6]).not.toBe(' ');
        }

        const b = reqs.find((x) => x.reqId === 3573);
        expect(b.text).toBe('3573  3004  Short');
        expect(b.pills).toEqual([{ kind: 'devserver', start: 6, len: 4 }]);

        const c = reqs.find((x) => x.reqId === 9);
        expect(c.idText).toBe('9');
        expect(c.pills).toEqual([]);
    });

    it('no reqPills draws every row exactly as before', () => {
        const before = computePlanLayout(rows, { epicLabel: 'title', reqLabel: 'title', reqTitles });
        const reqs = before.labels.filter((x) => x.kind === 'req');
        expect(reqs[0].text.startsWith('3572  Visualizer')).toBe(true);
        expect(reqs.slice(1).map((x) => x.text)).toEqual(['3573  Short', '9  No session here']);
        expect(reqs.every((x) => x.idText === String(x.reqId))).toBe(true);
        expect(reqs.every((x) => x.pills.length === 0)).toBe(true);
    });
});
