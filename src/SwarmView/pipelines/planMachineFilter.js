// planMachineFilter.js — the Plan visualizer's machine filter (req #3708).
//
// User directive: "In the top toolbar add a machine ID filter for MCHP Windows
// or Mac Mini, deselecting a filter means machine specific requirements will
// not be displayed anywhere in the visualizer."
//
// THE STATE IS THE DESELECTED SET, NOT THE SELECTED ONE. A machine the reader
// has never touched is shown, so a machine added tomorrow appears pressed
// without anybody editing a stored list, and the default (nothing hidden) is
// the empty string — exactly what the plan looked like before this control.
// Stored as one space-separated string of machine ids, the encoding
// `planCollapse.js` uses and for the same reason: `useViewPreference` stores a
// string, and a list of words has nothing to fail to parse.
//
// ANY IS A FILTER TOO (req #3708 follow-up, user directive: "add an any filter
// as well, so Any can be seen/hidden along with the specific settings"). A
// requirement pinned to Any (`machine_fk` NULL) belongs to no machine, so it
// gets a chip of its own: `ANY_MACHINE` (0 — never a real machine id, which
// are positive) sits in the same deselected set and is what a NULL
// `machine_fk` is tested against.

/** The pseudo machine id the Any chip toggles; `machine_fk` NULL maps to it. */
export const ANY_MACHINE = 0;

const tokensOf = (raw) => (typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : []);

/**
 * The machine ids the reader has deselected.
 *
 * @param {string} raw  the `hiddenMachines` setting's value
 * @returns {Set<number>}
 */
export function parseHiddenMachines(raw) {
    const out = new Set();
    for (const t of tokensOf(raw)) {
        const n = Number(t);
        if (Number.isInteger(n) && n >= 0) out.add(n);
    }
    return out;
}

/**
 * The stored value after clicking a machine's chip: a shown machine becomes
 * hidden and a hidden one shown.
 *
 * @param {string} raw
 * @param {number} machineId
 * @returns {string}
 */
export function toggleHiddenMachine(raw, machineId) {
    const set = parseHiddenMachines(raw);
    if (set.has(machineId)) set.delete(machineId);
    else set.add(machineId);
    return [...set].sort((a, b) => a - b).join(' ');
}

/** True when a requirement pinned to `machineFk` (null = Any) is hidden by `hidden`. */
export function isMachineHidden(machineFk, hidden) {
    if (!hidden || hidden.size === 0) return false;
    return hidden.has(machineFk == null ? ANY_MACHINE : Number(machineFk));
}

/**
 * Drop each row's requirements pinned to a deselected machine, from rows
 * already run through `orderStepReqs`. `reqDoneFrom` (the index where the
 * closed tail starts, which positions the dashed complete line) shifts down by
 * the number of dropped ids that sat BEFORE it, so the line stays between the
 * same two surviving requirements. A row with nothing to drop is returned as
 * the same object.
 *
 * @param {Object[]} rows
 * @param {Set<number>} hidden       deselected machine ids
 * @param {function(number): ?number} machineOf  requirement id -> machine_fk
 */
export function hideMachineReqs(rows, hidden, machineOf) {
    if (!hidden || hidden.size === 0) return rows;
    return (rows || []).map((r) => {
        const ids = r.reqIds || [];
        const doneFrom = r.reqDoneFrom ?? ids.length;
        const kept = [];
        let keptBeforeDone = 0;
        ids.forEach((id, i) => {
            if (isMachineHidden(machineOf(id), hidden)) return;
            kept.push(id);
            if (i < doneFrom) keptBeforeDone += 1;
        });
        if (kept.length === ids.length) return r;
        return { ...r, reqIds: kept, reqDoneFrom: keptBeforeDone };
    });
}

/** The chip label for a machine: the WSL platform reads "WSL" (req #3806), any other its title. */
export const machineChipLabel = (m) =>
    (m.platform === 'wsl' ? 'WSL' : (m.title || `Machine ${m.id}`));

/**
 * The filter chips in toolbar order (req #3806): Any, then the machine this
 * browser is on, then the rest in dictionary order.
 *
 * @param {Object[]} machines   the open machines
 * @param {?number} currentId   `resolveThisMachineId`'s answer, or null
 */
export function orderMachineChips(machines, currentId) {
    const list = machines || [];
    const current = list.filter((m) => m.id === currentId);
    const others = list.filter((m) => m.id !== currentId);
    return [{ id: ANY_MACHINE, title: 'Any' }, ...current, ...others];
}
