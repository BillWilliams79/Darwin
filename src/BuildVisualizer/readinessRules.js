// req #2772 — Build Visualizer readiness / release-type rules.
//
// The build-dot "ready" toggle is a single boolean on the build
// (`approved_for_release`), but its DISPLAYED label and the TYPE of release
// event it later produces both vary by the build's branch type. This module is
// the single source of truth for that mapping — components import it; no inline
// branch-type → label switches live anywhere else (mirrors starColors.js,
// deleteRules.js, etc.).
//
// Mapping (req #2772, user-specified):
//
//   | Toggle label      | Release type | Branch types                      |
//   |-------------------|--------------|-----------------------------------|
//   | Production Ready  | Production   | main, release, csr                |
//   | Sample Ready      | Sample       | development, sample-release       |
//   | Debug Ready       | Debug        | bootleg                           |
//   | Hot Fix Ready     | Hot Fix      | hotfix                            |
//
// `releaseType` is the value RECORDED on a customer release event (the data
// model for persisting it is owned by data-architect — req #2772 part B).
// `label` is the toggle's switch label in the build-dot menu.

export const READINESS_BY_TYPE = {
    main:             { releaseType: 'Production', label: 'Production Ready' },
    release:          { releaseType: 'Production', label: 'Production Ready' },
    csr:              { releaseType: 'Production', label: 'Production Ready' },
    'sample-release': { releaseType: 'Sample',     label: 'Sample Ready' },
    development:      { releaseType: 'Sample',     label: 'Sample Ready' },
    bootleg:          { releaseType: 'Debug',      label: 'Debug Ready' },
    hotfix:           { releaseType: 'Hot Fix',    label: 'Hot Fix Ready' },
};

// Fallback for an unrecognized branch type — treat as Production (the most
// conservative "this ships" reading), matching the historical single label.
export const DEFAULT_READINESS = { releaseType: 'Production', label: 'Production Ready' };

/**
 * Resolve the readiness label + release type for a branch type.
 * @param {string} branchType — one of the REGISTRY keys.
 * @returns {{releaseType: string, label: string}}
 */
export function readinessFor(branchType) {
    return READINESS_BY_TYPE[branchType] || DEFAULT_READINESS;
}

/** The toggle label shown in the build-dot menu for a branch type. */
export function readinessLabelFor(branchType) {
    return readinessFor(branchType).label;
}

/** The release-event type recorded for a release shipped off a branch type. */
export function releaseTypeFor(branchType) {
    return readinessFor(branchType).releaseType;
}
