// planCollapse.js — which initiative bands and step cards the reader has folded
// (req #3650).
//
// User direction: "pipeline and step should both have UI options in a single
// button to collapse or expand their view. the small one we had in the
// topology TPU 3D visualizer was nice and we could use that here and keep it
// in the upper left corner as in TPU 3D Vis." So every initiative chip and every step
// card carries its OWN fold, independent of every other box: an initiative folds its
// steps away, a step folds its requirement rows away.
//
// THE STATE IS ONE STRING, stored as the `collapsed` row of
// `planViewSettings.js` so a fold survives every transition and a reload the
// way the colour key's popout does (req #3651). It is a space-separated list of
// TOKENS — `i<initiativeId>` for a folded initiative, `s<stepId>` for a folded step, and
// `inone` for the label-less "No initiative" band, which has no id to name. Initiative and
// step ids are database ids, unique across every plan, so one list serves every
// pipeline without a per-plan key; a token naming a box this plan does not have
// is simply never asked about. The one exception is `inone`: the "No initiative" band
// has no id, so folding it folds every plan's "No initiative" band alike — a band only
// legacy rows with no initiative can produce at all.
//
// The token, not a JSON record, because `useViewPreference` stores a string and
// a list of words is the one encoding with nothing to fail to parse: an
// unrecognised word is ignored rather than throwing away the reader's folds.

const NO_INITIATIVE = 'inone';

const initiativeToken = (initiativeId) => (initiativeId == null ? NO_INITIATIVE : `i${initiativeId}`);
const stepToken = (stepId) => `s${stepId}`;

const tokensOf = (raw) => (typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : []);

/**
 * The folded boxes in a stored `collapsed` string.
 *
 * @param {string} raw  the setting's value
 * @returns {{initiativeIds: Set<?number>, stepIds: Set<number>}} initiative ids (`null`
 *   for the "No initiative" band) and step ids, each a number as the plan rows carry
 *   them
 */
export function parseCollapsed(raw) {
    const initiativeIds = new Set();
    const stepIds = new Set();
    for (const tok of tokensOf(raw)) {
        if (tok === NO_INITIATIVE) { initiativeIds.add(null); continue; }
        const m = /^([is])(\d+)$/.exec(tok);
        if (!m) continue;
        (m[1] === 'i' ? initiativeIds : stepIds).add(Number(m[2]));
    }
    return { initiativeIds, stepIds };
}

const toggleToken = (raw, tok) => {
    const tokens = tokensOf(raw);
    return tokens.includes(tok)
        ? tokens.filter((t) => t !== tok).join(' ')
        : [...tokens, tok].join(' ');
};

/** `raw` with this initiative's fold flipped. `initiativeId` null is the "No initiative" band. */
export const toggleInitiativeCollapsed = (raw, initiativeId) => toggleToken(raw, initiativeToken(initiativeId));

/** `raw` with this step's fold flipped. */
export const toggleStepCollapsed = (raw, stepId) => toggleToken(raw, stepToken(stepId));

const removeToken = (raw, tok) => tokensOf(raw).filter((t) => t !== tok).join(' ');

/** `raw` with this initiative UNFOLDED — unchanged when it was not folded. */
export const expandInitiative = (raw, initiativeId) => removeToken(raw, initiativeToken(initiativeId));

/** `raw` with this step UNFOLDED — unchanged when it was not folded. */
export const expandStep = (raw, stepId) => removeToken(raw, stepToken(stepId));
