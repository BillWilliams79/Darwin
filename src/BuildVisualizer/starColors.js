// Release-event star color keyed by the BRANCH TYPE the release shipped off
// (req #2741): release → gold, hot fix → silver, bootleg → red. Everything else
// defaults to gold.
//
// Extracted from BuildVisualizerCanvas (req #2741) so the mapping is testable
// independently of the React component.

export const STAR_COLORS = {
    release:          { fill: '#fbbf24', stroke: '#b45309' }, // gold
    'sample-release': { fill: '#fbbf24', stroke: '#b45309' }, // gold (Sprint/Sample)
    csr:              { fill: '#fbbf24', stroke: '#b45309' }, // gold (req #2741)
    hotfix:           { fill: '#d4d4d8', stroke: '#71717a' }, // silver
    bootleg:          { fill: '#ef4444', stroke: '#991b1b' }, // red
};

export const DEFAULT_STAR_COLOR = { fill: '#fbbf24', stroke: '#b45309' };

export function starColorFor(branchType) {
    return STAR_COLORS[branchType] || DEFAULT_STAR_COLOR;
}
