// req #3455 — the browser half of click-to-focus.
//
// The MAC half is asserted by tests/swarm/test-terminal-focus.sh in
// DarwinAI-Config. The two cannot share code (a browser bundle and a shell
// script on another machine), so the URL SHAPE is asserted independently on
// both sides; if these two files disagree, the click silently does nothing.

import { describe, it, expect } from 'vitest';
import {
    TERMINAL_FOCUS_SCHEME,
    TERMINAL_STATE,
    TERMINAL_VISIBLE,
    browserPlatformFamily,
    resolveThisMachineId,
    terminalFocusUrl,
    terminalFocusState,
} from '../terminalFocus';

const MAC = { id: 2, title: 'Mac Mini', hostname: 'Macmini', platform: 'darwin', closed: 0 };
const WIN = { id: 3, title: 'MCHP Windows', hostname: 'SJO-LT-C72929B', platform: 'wsl', closed: 0 };
const MACHINES = [MAC, WIN];

const navFor = (platform) => ({ userAgentData: { platform } });

const session = (over = {}) => ({
    id: 2736,
    title: 'Terminal window on the session',
    machine_fk: 2,
    terminal_window_id: '23029',
    terminal_number: 4,
    ...over,
});

describe('browserPlatformFamily', () => {
    it('maps macOS to the darwin platform family', () => {
        expect(browserPlatformFamily(navFor('macOS'))).toBe('darwin');
        expect(browserPlatformFamily({ platform: 'MacIntel' })).toBe('darwin');
    });

    it('maps Windows to wsl, because that is where the worker actually lives', () => {
        // The browser runs on Windows; Windows Terminal's swarm worker runs in
        // WSL and its machines row says `wsl`. Mapping Windows anywhere else
        // would make machine 3 permanently unmatchable.
        expect(browserPlatformFamily(navFor('Windows'))).toBe('wsl');
        expect(browserPlatformFamily({ platform: 'Win32' })).toBe('wsl');
    });

    it('maps Linux to linux and an unrecognised platform to null', () => {
        expect(browserPlatformFamily(navFor('Linux'))).toBe('linux');
        expect(browserPlatformFamily(navFor('FreeBSD'))).toBeNull();
        expect(browserPlatformFamily(null)).toBeNull();
    });
});

describe('resolveThisMachineId', () => {
    it('resolves the unique open machine of the browser platform family', () => {
        expect(resolveThisMachineId(MACHINES, navFor('macOS'))).toBe(2);
        expect(resolveThisMachineId(MACHINES, navFor('Windows'))).toBe(3);
    });

    it('refuses to guess when TWO machines share the family', () => {
        // The whole reason this returns an id rather than a boolean: guessing
        // between two Macs offers a link that focuses a window on another desk,
        // which is worse than offering none.
        const twoMacs = [MAC, { id: 9, title: 'MacBook', platform: 'darwin', closed: 0 }];
        expect(resolveThisMachineId(twoMacs, navFor('macOS'))).toBeNull();
    });

    it('ignores closed machines', () => {
        const retired = [{ ...MAC, closed: 1 }, { id: 9, title: 'New Mac', platform: 'darwin', closed: 0 }];
        expect(resolveThisMachineId(retired, navFor('macOS'))).toBe(9);
    });

    it('returns null when no machine matches, or the platform is unknown', () => {
        expect(resolveThisMachineId([WIN], navFor('macOS'))).toBeNull();
        expect(resolveThisMachineId(MACHINES, navFor('FreeBSD'))).toBeNull();
        expect(resolveThisMachineId(null, navFor('macOS'))).toBeNull();
    });
});

describe('terminalFocusUrl — the shared click contract', () => {
    it('builds darwin-term://focus with window, session and label', () => {
        const url = new URL(terminalFocusUrl(session()));
        expect(url.protocol).toBe(`${TERMINAL_FOCUS_SCHEME}:`);
        expect(url.host).toBe('focus');
        expect(url.searchParams.get('window')).toBe('23029');
        expect(url.searchParams.get('session')).toBe('2736');
        expect(url.searchParams.get('label')).toBe('Terminal window on the session');
    });

    it('carries the DURABLE handle, never the positional number', () => {
        // terminal_number is display only — it goes stale the moment a window
        // closes. A link keyed on it would focus whatever window later took
        // that position.
        const url = new URL(terminalFocusUrl(session({ terminal_window_id: '999', terminal_number: 1 })));
        expect(url.searchParams.get('window')).toBe('999');
    });

    it('percent-encodes a title containing & and #', () => {
        // A raw & splits the query string and a raw # truncates it; either
        // silently drops every parameter after the label.
        const raw = terminalFocusUrl(session({ title: 'Fix A & B #now' }));
        expect(raw).not.toContain('& B');
        expect(new URL(raw).searchParams.get('label')).toBe('Fix A & B #now');
        expect(new URL(raw).searchParams.get('session')).toBe('2736');
    });

    it('falls back to task_name when there is no title, and omits label when neither', () => {
        expect(new URL(terminalFocusUrl(session({ title: null, task_name: 'tn' })))
            .searchParams.get('label')).toBe('tn');
        expect(new URL(terminalFocusUrl(session({ title: null, task_name: null })))
            .searchParams.has('label')).toBe(false);
    });

    it('returns null when the session has no handle', () => {
        expect(terminalFocusUrl(session({ terminal_window_id: null }))).toBeNull();
        expect(terminalFocusUrl(null)).toBeNull();
    });

    it('carries the TARGET machine hostname, which is the only guard that works', () => {
        // resolveThisMachineId cannot tell an unregistered Mac from the Mac
        // mini. The handler can, because it knows its own hostname — so the
        // hostname has to travel in the URL for it to check.
        const url = new URL(terminalFocusUrl(session(), MACHINES));
        expect(url.searchParams.get('host')).toBe('Macmini');
    });

    it('omits host when the machine is unknown, rather than inventing one', () => {
        // The handler treats an absent host as "unchecked". Sending a wrong or
        // guessed one would be worse than sending none.
        expect(new URL(terminalFocusUrl(session({ machine_fk: 77 }), MACHINES))
            .searchParams.has('host')).toBe(false);
        expect(new URL(terminalFocusUrl(session(), []))
            .searchParams.has('host')).toBe(false);
        expect(new URL(terminalFocusUrl(session()))
            .searchParams.has('host')).toBe(false);
    });
});

describe('terminalFocusState', () => {
    it('offers a clickable link for a terminal on THIS browser\'s machine', () => {
        const state = terminalFocusState(session(), MACHINES, navFor('macOS'));
        expect(state.state).toBe(TERMINAL_STATE.LINK);
        expect(state.label).toBe('Terminal 4');
        expect(state.href).toContain('darwin-term://focus?');
    });

    it('shows but does NOT link a terminal on a different machine', () => {
        // The requirement is explicit: do not offer the link for a session on a
        // different machine than the browser is on.
        const state = terminalFocusState(session({ machine_fk: 3 }), MACHINES, navFor('macOS'));
        expect(state.state).toBe(TERMINAL_STATE.REMOTE);
        expect(state.href).toBeNull();
        expect(state.label).toBe('Terminal 4');
        expect(state.title).toMatch(/different machine/i);
        expect(state.title).toContain('MCHP Windows');
    });

    it('shows but does NOT link when the browser cannot identify its own machine', () => {
        const twoMacs = [MAC, { id: 9, title: 'MacBook', platform: 'darwin', closed: 0 }];
        const state = terminalFocusState(session(), twoMacs, navFor('macOS'));
        expect(state.state).toBe(TERMINAL_STATE.UNKNOWN_HOST);
        expect(state.href).toBeNull();
        expect(state.title).toMatch(/cannot tell which machine/i);
    });

    it('renders NONE for a session with no terminal recorded', () => {
        // Every pre-#3455 session. NULL means NOT RECORDED and must not be
        // dressed up as a window.
        const state = terminalFocusState(
            session({ terminal_window_id: null, terminal_number: null }), MACHINES, navFor('macOS'));
        expect(state.state).toBe(TERMINAL_STATE.NONE);
        expect(state.label).toBeNull();
        expect(state.href).toBeNull();
    });

    it('labels by handle when a number was never recorded', () => {
        const state = terminalFocusState(
            session({ terminal_number: null }), MACHINES, navFor('macOS'));
        expect(state.state).toBe(TERMINAL_STATE.LINK);
        expect(state.label).toBe('Terminal 23029');
    });

    it('gives a number-with-no-handle its OWN state, visible but not clickable', () => {
        // It used to reuse NONE while still carrying a label — so the grid
        // rendered it and the mobile card and detail page suppressed it. One
        // state cannot mean both "nothing to show" and "show this".
        const state = terminalFocusState(
            session({ terminal_window_id: null }), MACHINES, navFor('macOS'));
        expect(state.state).toBe(TERMINAL_STATE.NO_HANDLE);
        expect(TERMINAL_VISIBLE(state.state)).toBe(true);
        expect(state.label).toBe('Terminal 4');
        expect(state.href).toBeNull();
        expect(state.title).toMatch(/no window handle/i);
    });

    it('says LOADING, not UNKNOWN_HOST, while the machines list is in flight', () => {
        // useMachines returns undefined until its query lands. Answering
        // UNKNOWN_HOST there asserts "this browser cannot tell which machine it
        // is on" — a definite claim about a question nobody has answered yet,
        // which then flips to a clickable link a moment later.
        const loading = terminalFocusState(session(), undefined, navFor('macOS'));
        expect(loading.state).toBe(TERMINAL_STATE.LOADING);
        expect(loading.href).toBeNull();
        expect(loading.title).not.toMatch(/cannot tell/i);

        // An empty ARRAY is a real answer — no machines registered — and does
        // resolve to UNKNOWN_HOST.
        expect(terminalFocusState(session(), [], navFor('macOS')).state)
            .toBe(TERMINAL_STATE.UNKNOWN_HOST);
    });

    it('TERMINAL_VISIBLE hides only NONE, so the three consumers agree', () => {
        expect(TERMINAL_VISIBLE(TERMINAL_STATE.NONE)).toBe(false);
        for (const s of [TERMINAL_STATE.LINK, TERMINAL_STATE.REMOTE,
                         TERMINAL_STATE.NO_HANDLE, TERMINAL_STATE.UNKNOWN_HOST,
                         TERMINAL_STATE.LOADING]) {
            expect(TERMINAL_VISIBLE(s)).toBe(true);
        }
    });

    it('names the machine the click assumes, since that machine is a guess', () => {
        const state = terminalFocusState(session(), MACHINES, navFor('macOS'));
        expect(state.title).toContain('Mac Mini');
    });

    it('names an unresolved machine by id rather than pretending it has none', () => {
        const state = terminalFocusState(session({ machine_fk: 77 }), MACHINES, navFor('macOS'));
        expect(state.state).toBe(TERMINAL_STATE.REMOTE);
        expect(state.title).toContain('machine #77');
    });
});
