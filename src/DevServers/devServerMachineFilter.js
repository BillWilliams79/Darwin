// devServerMachineFilter.js — the Dev Servers page's per-machine pill selector
// (req #3556). Pure functions, so the selection rules are testable without
// rendering the page.
//
// Selection model: `null` means "not chosen yet" and resolves to the DEFAULT —
// only this browser's machine. When the browser's machine cannot be resolved
// (resolveThisMachineId refuses a guess), the default is every machine, because
// hiding everything would read as "no dev servers" rather than "unknown host".
// Once the user toggles a pill the selection is an explicit array; an empty
// array is a legal "show nothing" (same contract as ChipFilter).

import { resolveThisMachineId } from '../SwarmView/terminalFocus';
import { UNASSIGNED_MACHINE } from '../SwarmView/machineChipStyles';

// A dev server's pill key. Rows with no machine_fk, or one pointing at a
// closed/deleted machine (no pill of its own), fall under Unassigned so they
// stay reachable.
export const machineKeyFor = (server, openMachineIds) =>
    (server.machine_fk != null && openMachineIds.includes(server.machine_fk))
        ? server.machine_fk
        : UNASSIGNED_MACHINE;

/**
 * Pill options: one per open machine (sorted by id so palette colors stay put),
 * plus Unassigned only when some server actually falls under it.
 * Each option carries its server `count`.
 */
export const buildMachineOptions = (machines, servers) => {
    const open = [...(machines || [])].filter(m => !m.closed).sort((a, b) => a.id - b.id);
    const openIds = open.map(m => m.id);
    const counts = new Map();
    (servers || []).forEach(s => {
        const key = machineKeyFor(s, openIds);
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    const options = open.map(m => ({
        value: m.id,
        label: m.title || m.hostname || `Machine ${m.id}`,
        count: counts.get(m.id) || 0,
    }));
    if (counts.get(UNASSIGNED_MACHINE)) {
        options.push({ value: UNASSIGNED_MACHINE, label: 'Unassigned', count: counts.get(UNASSIGNED_MACHINE) });
    }
    return options;
};

/** The selection in force: explicit choice, else this machine, else everything. */
export const effectiveSelection = (selected, machines, optionValues, nav) => {
    if (selected !== null && selected !== undefined) return selected;
    const thisId = resolveThisMachineId(machines, nav);
    return thisId != null && optionValues.includes(thisId) ? [thisId] : optionValues;
};

export const toggleSelection = (current, value) =>
    current.includes(value) ? current.filter(v => v !== value) : [...current, value];

export const filterServersByMachine = (servers, selection, openMachineIds) =>
    (servers || []).filter(s => selection.includes(machineKeyFor(s, openMachineIds)));
