// Req #3642 — the Dev Servers nav item expands to one pill per running dev
// server. Pure, so the scoping and ordering rules are testable without
// rendering the sidebar.
//
// A dev server is NUMBERED by its port everywhere else in Darwin (the Sessions
// grid's Dev Server column, the plan visualizer's `3002` pill), so the pill
// says the port, and the pills run in port order — the Dev Servers page's own
// default sort.
//
// PORTS ARE MACHINE-LOCAL: the Mac and WSL each run the full 3000-3007 pool, so
// `https://localhost:3001` opens THIS machine's 3001. The pills are scoped to
// the machine this browser resolves to — the Dev Servers page's default
// selection (req #3556) — and fall back to every server when it cannot tell,
// rather than showing nothing. A pill only links when its claim is on the
// resolved machine; otherwise it is still drawn, because the server is still
// running, just not reachable from here, and its title names the machine so
// two machines' same-numbered ports can be told apart. Until the machines read
// settles there are NO pills, so the row never flashes every machine's servers
// and then narrows; a failed machines read is passed in as [] by the caller,
// which resolves to no machine and so shows everything.

import { resolveThisMachineId } from '../SwarmView/terminalFocus';

/**
 * @param {?Array<Object>} devServers  `dev_servers` rows.
 * @param {?Array<Object>} machines    `machines` rows; undefined while loading.
 * @param {Object} [nav]               navigator override (tests).
 * @returns {Array<{key, label, href: ?string, title: string}>} in port order.
 */
export function devServerNavPills(devServers, machines, nav) {
    if (!machines) return [];
    const thisMachineId = resolveThisMachineId(machines, nav);
    const machineTitle = (id) => machines.find(m => m.id === id)?.title
        || (id != null ? `machine ${id}` : 'an unknown machine');
    return (devServers || [])
        .filter(s => s && s.port != null)
        .filter(s => thisMachineId == null || s.machine_fk === thisMachineId)
        .sort((a, b) => (a.port - b.port) || ((a.machine_fk ?? 0) - (b.machine_fk ?? 0)) || (a.id - b.id))
        .map(s => {
            const url = `https://localhost:${s.port}`;
            const local = thisMachineId != null && s.machine_fk === thisMachineId;
            const terminal = s.terminal_number != null ? ` · Terminal ${s.terminal_number}` : '';
            return {
                key: s.id,
                label: String(s.port),
                href: local ? url : null,
                title: local
                    ? `Open ${url}${terminal}`
                    : `Port ${s.port} on ${machineTitle(s.machine_fk)}${terminal}`,
            };
        });
}
