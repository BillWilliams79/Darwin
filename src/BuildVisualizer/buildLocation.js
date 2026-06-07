// req #2753 — Branch location string shown when a build or branch is clicked.
//
// The location is purely informational (NOT a link): the user copies it into a
// browser. Per the requirement, no scheme is included — the bare host/path is
// enough info. Shape:
//
//   jira.microchip.com/{Build-project-name}/{branch name}/{version of first build}
//
// The location identifies the BRANCH, so it is the same string for the branch
// itself and for every build on it: the version segment is always the version
// of the branch's FIRST build (not the clicked build). The branch name segment
// is always present, including for `main`.
//
// Branch names in this app can carry embedded newlines (multi-line labels), so
// each segment is flattened to single-line and trimmed before composing.

function clean(value) {
    return (value ?? '')
        .toString()
        .replace(/\s+/g, ' ')
        .trim();
}

// Compose the branch-location string from project name, branch name, and the
// version of the branch's first build. `version` may be empty (e.g. a branch
// with no builds yet); in that case the trailing version segment is omitted.
export function formatBranchLocation(projectName, branchName, version) {
    const project = clean(projectName) || 'project';
    const branch = clean(branchName) || 'branch';
    const ver = clean(version);
    const base = `jira.microchip.com/${project}/${branch}`;
    return ver ? `${base}/${ver}` : base;
}
