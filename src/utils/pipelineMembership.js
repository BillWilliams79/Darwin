// Pipeline membership — req #3180.
//
// THE browser's one answer to "does a pipeline step carry this requirement".
// Both consumers (the SwarmStartCard aggregator and the requirements page
// filter) read it from here; computing it a second way is how the two surfaces
// start disagreeing, which is the same defect class this requirement removes at
// the data layer.
//
// WHICH QUESTION THIS ANSWERS: STEP association — a direct
// `pipeline_step_requirements` junction row, i.e. "is this scheduled". It is NOT
// epic association (requirement -> feature -> epic), which answers "does this
// belong to a body of work" and is true of plenty of requirements no step will
// ever run. Those two populations differ, and the gap between them — work
// correctly filed under an epic that no step will run — is exactly what the
// requirements-page filter exists to expose. Every label built on this says
// "pipeline step" so it cannot be read as answering the other question.
//
// The daemon derives the same fact server-side as `requirement.pipelined`
// (darwin-mcp/services/requirements.py). The two cannot share code — the browser
// reaches Lambda-Rest, the daemon reaches it from a localhost process — so they
// are deliberate duplicates of one rule, exactly like pipelineModel.js and
// pipeline_derive.py.

/**
 * @param {Array<{requirement_fk: number}>} stepRequirements  rows from
 *        `useAllPipelineStepRequirements` (the junction, whole-table read).
 * @returns {Set<number>} requirement ids at least one pipeline step carries.
 */
export const pipelinedRequirementIds = (stepRequirements) => {
    const ids = new Set();
    if (!Array.isArray(stepRequirements)) return ids;
    for (const link of stepRequirements) {
        // A junction row with no requirement_fk cannot name a requirement. Skip
        // it rather than seeding the set with null/undefined, which would make
        // `has(r.id)` answer true for any row whose own id was missing.
        if (!link || link.requirement_fk === null || link.requirement_fk === undefined) continue;
        ids.add(Number(link.requirement_fk));
    }
    return ids;
};

/**
 * Drop every requirement a pipeline step carries.
 *
 * `enabled === false` returns the input array UNCHANGED (same reference), so a
 * caller that has not opted in — or whose junction read has not resolved — pays
 * nothing and cannot trip a referential-equality dependency.
 *
 * WHILE THE JUNCTION READ IS IN FLIGHT the set is empty, so nothing is dropped
 * and the surface shows MORE than it eventually will. That direction is the
 * deliberate one: the alternative (treat unknown as pipelined) would blank a
 * launch surface on every page load and, worse, would hide eligible work behind
 * a fetch failure.
 *
 * @param {Array<{id: number}>} requirements
 * @param {Set<number>} pipelinedIds  from `pipelinedRequirementIds`
 * @param {boolean} [enabled=true]
 */
export const excludePipelined = (requirements, pipelinedIds, enabled = true) => {
    if (!enabled || !Array.isArray(requirements)) return requirements;
    if (!pipelinedIds || pipelinedIds.size === 0) return requirements;
    return requirements.filter(r => !pipelinedIds.has(Number(r?.id)));
};
