// filerEpicAim.js — the filer's + aimed at an epic (req #3854): "if you hover
// the req generator over an epic in visualizer view and you click create a
// requirement it will place it in that epic".
//
// The plan visualizer (PipelinePlanVisualizer.jsx) is the only page that knows
// where its epic cards are — they are Konva shapes, not DOM — so while it is
// mounted it REGISTERS an aim here: `at(clientX, clientY)` answers the epic card
// beneath a client point, looking through the filer itself (its own seat
// hit-test, the one the unorchestrated box drops with), `highlight(target)`
// outlines that card, and `seated(epicId)` refreshes the plan once a filed
// requirement has been seated in it. With no visualizer mounted every call
// answers nothing, so the filer behaves exactly as before on every other page.
//
// A target is `{ epicId, ok, title, darwinUri }`: `ok` false is a locked epic
// (it takes no new work), and `darwinUri` is the database the PLAN was read from
// — on a dev server that is darwin_dev while the filer files into production
// (req #3888), and a production requirement cannot be seated in a darwin_dev
// epic (seatableFrom).

let current = null;

/** Registers the visualizer's aim; returns its unregister. The newest wins. */
export function registerEpicAim(aim) {
    current = aim;
    return () => { if (current === aim) current = null; };
}

/** The epic beneath a client point, or null (no plan on the page, no epic there). */
export function epicAimAt(clientX, clientY) {
    if (!current || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    try {
        return current.at(clientX, clientY) ?? null;
    } catch {
        return null;
    }
}

/** Outlines `target`'s epic on the plan (null clears it). */
export function highlightEpicAim(target) {
    current?.highlight?.(target ?? null);
}

/** The plan refreshes after a requirement was seated in `epicId`. */
export function notifyEpicSeated(epicId) {
    current?.seated?.(epicId);
}

/** Why the requirement filed through `filerUri` cannot be seated in `seat`, or
 *  null when it can: a locked epic, or a plan read from another database. */
export function seatProblem(seat, filerUri) {
    if (!seat) return null;
    if (!seat.ok) return 'is locked — it takes no new work';
    if (seat.darwinUri && filerUri && seat.darwinUri !== filerUri) {
        const db = String(seat.darwinUri).split('/').pop();
        return `is in ${db}, and the filer files into production — it will not be placed`;
    }
    return null;
}
