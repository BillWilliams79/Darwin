// devServerDashboardModel.js — the pure half of the Dev Servers dashboard (req #3643):
// which rows it lists, and its own sizes and home. Pure, so the scoping is
// testable without rendering.
//
// ── WHICH ROWS ─────────────────────────────────────────────────────────────
// A dev server is NUMBERED by its port everywhere in Darwin, so the rows run in
// port order — the Dev Servers page's own default sort.
//
// PORTS ARE MACHINE-LOCAL: the Mac and WSL each run the full 3000-3007 pool, so
// `https://localhost:3001` opens THIS machine's 3001. The rows are scoped to
// the machine this browser resolves to — the Dev Servers page's default
// selection (req #3556) — and fall back to every server when it cannot tell,
// rather than showing nothing. A row only links when its claim is on the
// resolved machine; otherwise it is still drawn, because the server is still
// running, just not reachable from here, and its title names the machine so
// two machines' same-numbered ports can be told apart. Until the machines read
// settles there are NO rows, so the list never flashes every machine's servers
// and then narrows; a failed machines read is passed in as [] by the caller,
// which resolves to no machine and so shows everything.
//
// The requirement is read from the claim's own `workspace_path`, not joined
// through the session: a session directory is named `<reqId>-<taskName>`, so
// the path already says which requirement it serves. The row then shows that
// requirement's TITLE (user directive, `withRequirementTitles`), looked up in
// PRODUCTION — where the claim and the id both come from — never through the
// dev/prod-split requirements read, which in a dev build is darwin_dev.
//
// ── WHERE IT SITS ──────────────────────────────────────────────────────────
// The docking, reshaping and collapsing geometry is the shared AnchoredPanel's
// (Components/AnchoredPanel/anchoredPanelGeometry.js). This module holds only
// the dashboard's own numbers.

import { resolveThisMachineId, terminalFocusState, TERMINAL_STATE } from '../SwarmView/terminalFocus';

/** Viewport inset of the home corner, px. */
export const DASH_INSET = 16;
/** Smallest panel the edges will shape, px: a row's bar, port and terminal. */
export const DASH_MIN_W = 120;
export const DASH_MIN_H = 64;
/** Narrower than this, it drops the title too: bar, port and terminal only
 *  (user directive: "at its smallest"; 190 cut 20% by req #3718). */
export const DASH_TINY_W = 152;
/** At least this wide (shaped), the terminal reads "Term 4" rather than "T4"
 *  (req #3668). Content-sized is never "wider": it keeps the short form. */
export const DASH_WIDE_W = 340;
/** Content-sized, the panel is as wide as its rows, up to this, px. */
export const DASH_AUTO_MAX_W = 420;
/** Its id in the navbar's panel rack (req #3720). */
export const DASH_RACK_ID = 'devservers';

/** Home: the viewport's bottom-right corner, sized to its content on both
 *  axes (`w`/`ht` null — the minimum, user directive) until reshaped. */
export const DASH_HOME = Object.freeze({
    h: 'r', x: DASH_INSET, v: 'b', y: DASH_INSET, w: null, ht: null,
});

/**
 * What a claim's workspace path names: the requirement it serves (when the
 * directory is a swarm session's `<reqId>-<taskName>`) and a label.
 *
 * @param {?string} path
 * @returns {{reqId: ?number, label: string}}
 */
export function workspaceLabel(path) {
    const base = (path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    if (!base) return { reqId: null, label: '—' };
    const m = base.match(/^(\d+)-(.+)$/);
    if (m) return { reqId: Number(m[1]), label: m[2] };
    return { reqId: null, label: base };
}

/**
 * @param {?Array<Object>} devServers  `dev_servers` rows.
 * @param {?Array<Object>} machines    `machines` rows; undefined while loading.
 * @param {Object} [nav]               navigator override (tests).
 * @param {?number} [currentPort]      the port this page is served from.
 * @returns {Array<{key, port, href: ?string, title: string, machineId: ?number,
 *   terminal: ?number, reqId: ?number, label: string, current: boolean}>}
 */
export function devServerDashboardRows(devServers, machines, nav, currentPort = null) {
    if (!machines) return [];
    const thisMachineId = resolveThisMachineId(machines, nav);
    const machineTitle = (id) => machines.find(m => m.id === id)?.title
        || (id != null ? `machine ${id}` : 'an unknown machine');
    return (devServers || [])
        .filter(s => s && s.port != null)
        .filter(s => thisMachineId == null || s.machine_fk === thisMachineId)
        .sort((a, b) => (a.port - b.port) || ((a.machine_fk ?? 0) - (b.machine_fk ?? 0)) || (a.id - b.id))
        .map((s) => {
            const url = `https://localhost:${s.port}`;
            const local = thisMachineId != null && s.machine_fk === thisMachineId;
            const href = local ? url : null;
            const terminalNote = s.terminal_number != null ? ` · Terminal ${s.terminal_number}` : '';
            const where = local
                ? `Open ${url}${terminalNote}`
                : `Port ${s.port} on ${machineTitle(s.machine_fk)}${terminalNote}`;
            const { reqId, label } = workspaceLabel(s.workspace_path);
            return {
                key: s.id,
                port: s.port,
                href,
                title: s.workspace_path ? `${where}\n${s.workspace_path}` : where,
                machineId: s.machine_fk ?? null,
                sessionId: s.session_fk ?? null,
                terminal: s.terminal_number ?? null,
                reqId,
                label,
                // Only a LINKED row can be this page: an unlinked one is the same
                // port number on another machine.
                current: href != null && currentPort != null && s.port === currentPort,
            };
        });
}

/**
 * Rows with each one's description set to its requirement's TITLE (user
 * directive) where the title is known; until it is — or for a workspace that
 * serves no requirement — the row keeps its workspace label (the session's
 * task name, or the directory). The task name stays in the hover title.
 *
 * @param {Array<Object>} rows      devServerDashboardRows output.
 * @param {?Array<{id, title}>} reqs production requirement rows.
 */
export function withRequirementTitles(rows, reqs) {
    const titleById = new Map((reqs || []).filter(r => r && r.title).map(r => [Number(r.id), r.title]));
    return rows.map((r) => {
        const title = r.reqId != null ? titleById.get(r.reqId) : undefined;
        return title ? { ...r, label: title, title: `${r.title}\n${r.label}` } : r;
    });
}

/**
 * Rows with the terminal's focus link (req #3668): the `darwin-term://` URL
 * and tooltip `terminalFocusState` answers for the row's session — the same
 * judgement the Sessions grid's chip makes — set only when it is a LINK (this
 * browser's machine, a durable window handle). Any other state leaves the
 * terminal plain text, as before.
 *
 * @param {Array<Object>} rows        devServerDashboardRows output.
 * @param {?Array<Object>} sessions   swarm_sessions rows (terminal columns).
 * @param {?Array<Object>} machines
 * @param {Object} [nav]              navigator override (tests).
 */
export function withTerminalLinks(rows, sessions, machines, nav) {
    const byId = new Map((sessions || []).filter(x => x).map(x => [Number(x.id), x]));
    return rows.map((r) => {
        const session = r.sessionId != null ? byId.get(Number(r.sessionId)) : undefined;
        if (!session) return r;
        const t = terminalFocusState(session, machines, nav);
        return t.state === TERMINAL_STATE.LINK
            ? { ...r, terminalHref: t.href, terminalTitle: t.title } : r;
    });
}
