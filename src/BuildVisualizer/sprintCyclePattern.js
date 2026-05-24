// Sprint Cycle pattern generator (req #2602).
//
// Produces a builds.json-shaped object describing:
//   - Trunk with 8-10 random main builds per sprint period (10 sprints total).
//   - A sprint release branch at the end of each period; each sprint release
//     has 1-5 builds; the last sprint build is colored gray (retired).
//   - 4 dev branches per sprint, sprinkled across the period's main builds
//     (random parent main build, not all clustered on one).
//   - Dev-branch length is bimodal: 90% short (1-2 builds), 10% long (8-10).
//   - One more 8-10 build main span, then a release branch with 2 yellow
//     sprint-end builds + 1 green final release.
//   - Tail off the release branch: 3 hotfix, 5 bootleg, 1 CSR — each attached
//     to a randomly chosen release-branch build (NOT all clustered on the
//     final release dot).
//
// Counts use a seeded RNG so the seeded library output is deterministic.

const SPRINT_COUNT = 10;
const DEV_BRANCHES_PER_SPRINT = 4;
const RELEASE_BRANCH_SPRINT_END_BUILDS = 2;
const TAIL_CSR_COUNT = 1;
const TAIL_BOOTLEG_COUNT = 5;
const TAIL_HOTFIX_COUNT = 3;
const LONG_DEV_BRANCH_PROBABILITY = 0.10;

function makeRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

export function generateSprintCyclePattern({ seed = 2602 } = {}) {
    const rng = makeRng(seed);
    const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];

    const branches = [];
    const builds = {};
    let nextBuildNumber = 1;

    const addBuild = (branchId, dotColor = null) => {
        const id = `b${nextBuildNumber}`;
        builds[id] = { id, number: nextBuildNumber, branchId, dotColor };
        nextBuildNumber += 1;
        return id;
    };

    const main = {
        id: 'main',
        type: 'main',
        name: 'Main',
        labelEnd: 'Final Release',
        parentBranchId: null,
        parentBuildId: null,
        side: 'center',
        buildIds: [],
    };
    branches.push(main);

    const addDevBranch = (devId, parentMainBuildId) => {
        const isLong = rng() < LONG_DEV_BRANCH_PROBABILITY;
        const buildCount = isLong ? randInt(8, 10) : randInt(1, 2);
        const dev = {
            id: devId,
            type: 'development',
            name: 'Development Branches',
            parentBranchId: 'main',
            parentBuildId: parentMainBuildId,
            side: 'below',
            buildIds: [],
        };
        for (let i = 0; i < buildCount; i += 1) {
            dev.buildIds.push(addBuild(devId));
        }
        branches.push(dev);
    };

    // For each sprint period: add 8-10 main builds, sprinkle 4 dev branches
    // across them (random parents from THIS period's main builds), then cut a
    // sprint release branch off the last main build of the period.
    for (let s = 0; s < SPRINT_COUNT; s += 1) {
        const periodLength = randInt(8, 10);
        const periodMainBuildIds = [];
        for (let i = 0; i < periodLength; i += 1) {
            const id = addBuild('main');
            main.buildIds.push(id);
            periodMainBuildIds.push(id);
        }

        for (let d = 0; d < DEV_BRANCHES_PER_SPRINT; d += 1) {
            const parentMainBuildId = pick(periodMainBuildIds);
            addDevBranch(`sprint-${s + 1}-dev-${d + 1}`, parentMainBuildId);
        }

        const sprintParent = periodMainBuildIds[periodMainBuildIds.length - 1];
        const sprintId = `sprint-${s + 1}`;
        const sprintBuildCount = randInt(1, 5);
        const sprint = {
            id: sprintId,
            type: 'sample-release',
            name: `Sprint ${s + 1}\nRelease`,
            parentBranchId: 'main',
            parentBuildId: sprintParent,
            side: 'above',
            buildIds: [],
        };
        for (let i = 0; i < sprintBuildCount; i += 1) {
            const isLast = i === sprintBuildCount - 1;
            sprint.buildIds.push(addBuild(sprintId, isLast ? 'gray' : null));
        }
        branches.push(sprint);
    }

    // One more 8-10 build main span before the release branch.
    const finalSpanLength = randInt(8, 10);
    for (let i = 0; i < finalSpanLength; i += 1) {
        main.buildIds.push(addBuild('main'));
    }
    const releaseParent = main.buildIds[main.buildIds.length - 1];

    const releaseId = 'release-1';
    const release = {
        id: releaseId,
        type: 'release',
        name: 'Release 1',
        parentBranchId: 'main',
        parentBuildId: releaseParent,
        side: 'above',
        buildIds: [],
        major: 1,
        minor: 0,
    };
    for (let i = 0; i < RELEASE_BRANCH_SPRINT_END_BUILDS; i += 1) {
        release.buildIds.push(addBuild(releaseId, 'yellow'));
    }
    const finalReleaseBuildId = addBuild(releaseId, 'green');
    release.buildIds.push(finalReleaseBuildId);
    branches.push(release);

    // Tail branches attached to RANDOM release-branch builds, so they don't
    // all cluster on the final release dot.
    const pushTailScattered = (typePrefix, type, name, rowOrder, dotColor, count) => {
        for (let i = 0; i < count; i += 1) {
            const parentBuildId = pick(release.buildIds);
            const id = `${typePrefix}-${i + 1}`;
            branches.push({
                id,
                type,
                name,
                parentBranchId: releaseId,
                parentBuildId,
                side: 'above',
                rowOrder,
                buildIds: [addBuild(id, dotColor)],
            });
        }
    };
    pushTailScattered('hotfix', 'hotfix', 'Hot Fix', 1, 'red', TAIL_HOTFIX_COUNT);
    pushTailScattered('bootleg', 'bootleg', 'Bootleg', 2, 'yellow', TAIL_BOOTLEG_COUNT);
    pushTailScattered('csr', 'csr', 'CSR', 3, null, TAIL_CSR_COUNT);

    const nextBranchNumber = branches.length + 1;

    return {
        version: 1,
        currentMajor: 1,
        currentMinor: 0,
        nextBuildNumber,
        nextBranchNumber,
        branches,
        builds,
    };
}

export const SPRINT_CYCLE_PATTERN_NAME = 'Sprint Cycle';
