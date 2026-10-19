// planCollapse.js — which epic bands and step cards the reader has folded
// (req #3650).
//
// User direction: "pipeline and step should both have UI options in a single
// button to collapse or expand their view. the small one we had in the
// topology TPU 3D visualizer was nice and we could use that here and keep it
// in the upper left corner as in TPU 3D Vis." So every epic chip and every step
// card carries its OWN fold, independent of every other box: an epic folds its
// steps away, a step folds its requirement rows away.
//
// THE STATE IS ONE STRING, stored as the `collapsed` row of
// `planViewSettings.js` so a fold survives every transition and a reload the
// way the colour key's popout does (req #3651). It is a space-separated list of
// TOKENS — `e<epicId>` for a folded epic, `s<stepId>` for a folded step, and
// `enone` for the label-less "No epic" band, which has no id to name. Epic and
// step ids are database ids, unique across every plan, so one list serves every
// pipeline without a per-plan key; a token naming a box this plan does not have
// is simply never asked about. The one exception is `enone`: the "No epic" band
// has no id, so folding it folds every plan's "No epic" band alike — a band only
// legacy rows with no epic can produce at all.
//
// The token, not a JSON record, because `useViewPreference` stores a string and
// a list of words is the one encoding with nothing to fail to parse: an
// unrecognised word is ignored rather than throwing away the reader's folds.

const NO_EPIC = 'enone';

const epicToken = (epicId) => (epicId == null ? NO_EPIC : `e${epicId}`);
const stepToken = (stepId) => `s${stepId}`;

const tokensOf = (raw) => (typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : []);

/**
 * The folded boxes in a stored `collapsed` string.
 *
 * @param {string} raw  the setting's value
 * @returns {{epicIds: Set<?number>, stepIds: Set<number>}} epic ids (`null`
 *   for the "No epic" band) and step ids, each a number as the plan rows carry
 *   them
 */
export function parseCollapsed(raw) {
    const epicIds = new Set();
    const stepIds = new Set();
    for (const tok of tokensOf(raw)) {
        if (tok === NO_EPIC) { epicIds.add(null); continue; }
        const m = /^([es])(\d+)$/.exec(tok);
        if (!m) continue;
        (m[1] === 'e' ? epicIds : stepIds).add(Number(m[2]));
    }
    return { epicIds, stepIds };
}

const toggleToken = (raw, tok) => {
    const tokens = tokensOf(raw);
    return tokens.includes(tok)
        ? tokens.filter((t) => t !== tok).join(' ')
        : [...tokens, tok].join(' ');
};

/** `raw` with this epic's fold flipped. `epicId` null is the "No epic" band. */
export const toggleEpicCollapsed = (raw, epicId) => toggleToken(raw, epicToken(epicId));

/** `raw` with this step's fold flipped. */
export const toggleStepCollapsed = (raw, stepId) => toggleToken(raw, stepToken(stepId));

const removeToken = (raw, tok) => tokensOf(raw).filter((t) => t !== tok).join(' ');

/** `raw` with this epic UNFOLDED — unchanged when it was not folded. */
export const expandEpic = (raw, epicId) => removeToken(raw, epicToken(epicId));

/** `raw` with this step UNFOLDED — unchanged when it was not folded. */
export const expandStep = (raw, stepId) => removeToken(raw, stepToken(stepId));
