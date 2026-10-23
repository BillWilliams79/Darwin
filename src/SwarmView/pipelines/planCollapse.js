// planCollapse.js — which initiative bands and epic cards the reader has folded
// (req #3650).
//
// User direction: "pipeline and epic should both have UI options in a single
// button to collapse or expand their view. the small one we had in the
// topology TPU 3D visualizer was nice and we could use that here and keep it
// in the upper left corner as in TPU 3D Vis." So every initiative chip and every epic
// card carries its OWN fold, independent of every other box: an initiative folds its
// epics away, an epic folds its requirement rows away.
//
// THE STATE IS ONE STRING, stored as the `collapsed` row of
// `planViewSettings.js` so a fold survives every transition and a reload the
// way the colour key's popout does (req #3651). It is a space-separated list of
// TOKENS — `i<initiativeId>` for a folded initiative, `e<epicId>` for a folded epic, and
// `inone` for the label-less "No initiative" band, which has no id to name. The setting's
// storage key carries a `-v2` suffix (req #3780; spelled once, in planViewSettings.js): before pass 1 of the plan-vocabulary
// rename the `e<id>` letter named an INITIATIVE, so a value saved under the old key would fold an
// unrelated epic — the renamed key simply starts fresh. Initiative and
// epic ids are database ids, unique across every plan, so one list serves every
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
const epicToken = (epicId) => `e${epicId}`;

const tokensOf = (raw) => (typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : []);

/**
 * The folded boxes in a stored `collapsed` string.
 *
 * @param {string} raw  the setting's value
 * @returns {{initiativeIds: Set<?number>, epicIds: Set<number>}} initiative ids (`null`
 *   for the "No initiative" band) and epic ids, each a number as the plan rows carry
 *   them
 */
export function parseCollapsed(raw) {
    const initiativeIds = new Set();
    const epicIds = new Set();
    for (const tok of tokensOf(raw)) {
        if (tok === NO_INITIATIVE) { initiativeIds.add(null); continue; }
        const m = /^([ie])(\d+)$/.exec(tok);
        if (!m) continue;
        (m[1] === 'i' ? initiativeIds : epicIds).add(Number(m[2]));
    }
    return { initiativeIds, epicIds };
}

const toggleToken = (raw, tok) => {
    const tokens = tokensOf(raw);
    return tokens.includes(tok)
        ? tokens.filter((t) => t !== tok).join(' ')
        : [...tokens, tok].join(' ');
};

/** `raw` with this initiative's fold flipped. `initiativeId` null is the "No initiative" band. */
export const toggleInitiativeCollapsed = (raw, initiativeId) => toggleToken(raw, initiativeToken(initiativeId));

/** `raw` with this epic's fold flipped. */
export const toggleEpicCollapsed = (raw, epicId) => toggleToken(raw, epicToken(epicId));

const removeToken = (raw, tok) => tokensOf(raw).filter((t) => t !== tok).join(' ');

/** `raw` with this initiative UNFOLDED — unchanged when it was not folded. */
export const expandInitiative = (raw, initiativeId) => removeToken(raw, initiativeToken(initiativeId));

/** `raw` with this epic UNFOLDED — unchanged when it was not folded. */
export const expandEpic = (raw, epicId) => removeToken(raw, epicToken(epicId));
