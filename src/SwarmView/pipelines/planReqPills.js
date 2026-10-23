// planReqPills.js — WHERE a requirement's work can be reached right now: its
// terminal and its dev server (req #3587).
//
// The plan visualizer draws a requirement row as `3572   Terminal 2  3002 -
// Title`, the two middle tokens as pills. This file is the JOIN that answers
// "which terminal, which port" — pure, plain objects in and a Map out, so it is
// testable without a canvas and the layout module stays free of session data.
//
// THREE BOUNDED LIST READS, NEVER A PER-REQUIREMENT FETCH: the requirement ->
// session junction (already read by the plan page for Cost), a light
// swarm_sessions projection, and `dev_servers`. Joined here in one pass.
//
// ── WHICH SESSION ────────────────────────────────────────────────────────────
// A requirement can carry many sessions over its life (an undo, a pause and
// resume, a re-launch). Only a LIVE one has a terminal worth naming — a
// completed session's window number is history, and a paused session's worker
// has exited — so the terminal comes from the NEWEST linked session that is not
// `completed` or `paused` (highest id: ids are allocation order).
//
// A DEV SERVER IS ITS OWN PROOF OF LIFE. `dev_servers` holds only currently
// claimed servers (a release deletes the row), so a row's presence means the
// server is up, whatever the session's status says. The port therefore comes
// from the newest linked session that HAS a claimed server, and a claim's own
// `terminal_number` stands in for a session that never recorded one.
//
// The terminal's state (clickable, remote, no handle…) is NOT decided here: it
// is `terminalFocusState`, the same judgement the Sessions grid's chip uses, so
// the two surfaces cannot disagree about whether a window can be focused.
//
// THE PORT GETS THE SAME MACHINE CHECK. A port is machine-local — the Mac and
// WSL each run the full 3000-3007 pool (`uq_machine_port`) — so
// `https://localhost:3001` from the Mac opens the MAC's 3001, which may be a
// different requirement's server entirely. The pill is `local` (and so
// clickable) only when the claim's machine is the one this browser resolves to;
// otherwise it is still drawn, because the port is still a fact.

import { terminalFocusState, TERMINAL_VISIBLE, resolveThisMachineId } from '../terminalFocus';

// req #3587 — the requirement row's Terminal and Dev Server pills: how they
// LOOK, shared by the epic card (Konva) and the Active box (HTML, req #3721).
//
// A PILL IS ITS OWN ELEMENT: a rounded box with its label drawn CENTRED inside
// it (`align`/`verticalAlign`), never an outline behind the row's own glyphs.
// The first version traced the row's characters, so its centring hung on two
// independent width measurements agreeing to the sub-pixel, and the token took
// the row's bold status colour — measured off-centre and heavy (user review,
// 2026-10-17). Now the row text carries BLANKS where a token sat (the layout
// still reserves exactly those characters, so wrap and card height are
// untouched) and the pill owns its label, centred by construction.
//
// Each kind has its own quiet palette, independent of the row's colour key: a
// dark tinted fill, a softened edge and a light label. The terminal is the
// requirement-id blue (`P.req`, an MUI primary chip's role); the dev server the
// Swarm visualizer's dark-mode dev-server green, so a port reads the same on
// both canvases.
export const REQ_PILL_STYLE = {
    terminal: { fill: '#7fb4ff26', stroke: '#7fb4ff8c', text: '#d3e5ff' },
    devserver: { fill: '#81c78426', stroke: '#81c7848c', text: '#d5f1d7' },
};
export const REQ_PILL_STROKE = 1.25;
export const REQ_PILL_H_EM = 1.3;                  // pill height, in req font sizes
export const REQ_PILL_FONT_EM = 0.78;              // label size, in req font sizes
export const REQ_PILL_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

// THE PILL HUGS ITS LABEL (user review, 2026-10-17: "the bubble around
// terminal is too wide — minimize the white space without making it feel
// cramped"). The box used to span every MONO character the layout reserved,
// but the label is drawn in the UI sans at `REQ_PILL_FONT_EM` of the row's
// size — about half the mono advance — so "Terminal 2" sat in a box nearly
// twice its width. Now the box is the label's own measured width plus this
// much air each side (0.6em — an MUI small chip's proportion), CENTRED on the
// reserved characters and never wider than they allow. The same rule for both
// kinds: a terminal and a port pill differ only in palette.
export const REQ_PILL_LABEL_PAD_EM = 0.6;

// Session statuses whose terminal is no longer the worker's.
export const NOT_LIVE_SESSION_STATUSES = ['completed', 'paused'];

const isLive = (s) => !!s && !NOT_LIVE_SESSION_STATUSES.includes(s.swarm_status);

/**
 * @param {{requirementSessions?: Array<{requirement_fk, session_fk}>,
 *          sessions?: Array<Object>, devServers?: Array<Object>,
 *          machines?: ?Array<Object>, nav?: Object}} sources
 *   `machines` is passed through to `terminalFocusState` verbatim — undefined
 *   while that read is in flight means LOADING, not "no machines".
 * @returns {Map<number, {terminal: ?{label, state, title, href},
 *                        devServer: ?{port, url, local, title}}>}
 *   Only requirements with at least one pill have an entry.
 */
export function buildReqPills({ requirementSessions, sessions, devServers, machines, nav } = {}) {
    const out = new Map();
    if (!requirementSessions?.length) return out;
    const thisMachineId = machines ? resolveThisMachineId(machines, nav) : null;
    const machineTitle = (id) => (machines || []).find((m) => m.id === id)?.title
        || (id != null ? `machine ${id}` : 'an unknown machine');

    const sessionById = new Map();
    for (const s of (sessions || [])) {
        if (s && s.id != null) sessionById.set(Number(s.id), s);
    }
    // Newest claim per session — the Swarm visualizer's own tie-break.
    const serverBySession = new Map();
    for (const ds of (devServers || [])) {
        if (!ds || ds.session_fk == null || ds.port == null) continue;
        const k = Number(ds.session_fk);
        const prev = serverBySession.get(k);
        if (!prev || (ds.id ?? 0) > (prev.id ?? 0)) serverBySession.set(k, ds);
    }

    const sessionIdsByReq = new Map();
    for (const link of requirementSessions) {
        if (!link || link.requirement_fk == null || link.session_fk == null) continue;
        const reqId = Number(link.requirement_fk);
        if (!sessionIdsByReq.has(reqId)) sessionIdsByReq.set(reqId, []);
        sessionIdsByReq.get(reqId).push(Number(link.session_fk));
    }

    for (const [reqId, ids] of sessionIdsByReq) {
        const newestFirst = [...new Set(ids)].sort((a, b) => b - a);
        const liveId = newestFirst.find((id) => isLive(sessionById.get(id)));
        const serverId = newestFirst.find((id) => serverBySession.has(id));
        const ds = serverId != null ? serverBySession.get(serverId) : null;

        let terminal = null;
        const live = liveId != null ? sessionById.get(liveId) : null;
        // The session the terminal belongs to: the live one, or — when the only
        // evidence of life is a claimed server — that server's session, with the
        // claim's terminal number filling a gap the session row left.
        const owner = live || (serverId != null ? sessionById.get(serverId) : null);
        if (owner || ds) {
            const base = owner || { id: serverId };
            const subject = (base.terminal_number == null && ds?.terminal_number != null
                && (!owner || owner.id === serverId))
                ? { ...base, terminal_number: ds.terminal_number }
                : base;
            const state = terminalFocusState(subject, machines, nav);
            if (TERMINAL_VISIBLE(state.state)) terminal = state;
        }

        let devServer = null;
        if (ds) {
            const url = `https://localhost:${ds.port}`;
            const local = thisMachineId != null && ds.machine_fk === thisMachineId;
            devServer = {
                port: String(ds.port), url, local,
                title: local
                    ? `Open ${url} on ${machineTitle(ds.machine_fk)}`
                    : `Port ${ds.port} on ${machineTitle(ds.machine_fk)} — not this browser's machine, so localhost here is a different server.`,
            };
        }

        if (terminal || devServer) out.set(reqId, { terminal, devServer });
    }
    return out;
}
