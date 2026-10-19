// devServerDashboardModel.js — the pure half of the Dev Servers dashboard (req #3643):
// which rows it lists, and its own sizes and home. Pure, so the scoping is
// testable without rendering.
//
// ── THE ROWS ARE THE NAV PILLS' ROWS ───────────────────────────────────────
// Which servers appear, in what order, and which of them link, is exactly the
// Dev Servers nav item's rule (req #3642, `devServerNavPills`): this machine's
// servers in port order, every server when the machine cannot be resolved, a
// link only where the port is reachable from this browser. The dashboard joins
// each pill back to its claim for what the pill has no room for — the workspace
// it serves and its terminal.
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

import { devServerNavPills } from '../NavBar/navDevServers';

/** Viewport inset of the home corner, px. */
export const DASH_INSET = 16;
/** Smallest panel the edges will shape, px: a row's bar, port and terminal. */
export const DASH_MIN_W = 120;
export const DASH_MIN_H = 64;
/** Narrower than this (shaped), a row drops its bug # (user directive). */
export const DASH_COMPACT_W = 250;
/** Narrower than this, it drops the title too: bar, port and terminal only
 *  (user directive: "at its smallest"). */
export const DASH_TINY_W = 190;
/** Content-sized, the panel is as wide as its rows, up to this, px. */
export const DASH_AUTO_MAX_W = 420;

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
    const byId = new Map((devServers || []).filter(Boolean).map(s => [s.id, s]));
    return devServerNavPills(devServers, machines, nav).map((pill) => {
        const s = byId.get(pill.key);
        const { reqId, label } = workspaceLabel(s.workspace_path);
        return {
            key: pill.key,
            port: s.port,
            href: pill.href,
            title: s.workspace_path ? `${pill.title}\n${s.workspace_path}` : pill.title,
            machineId: s.machine_fk ?? null,
            terminal: s.terminal_number ?? null,
            reqId,
            label,
            // Only a LINKED row can be this page: an unlinked one is the same
            // port number on another machine.
            current: pill.href != null && currentPort != null && s.port === currentPort,
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
