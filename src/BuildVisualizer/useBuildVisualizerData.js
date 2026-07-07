// req #2694 / #2720 — Build Visualizer data hook.
//
// Fetches the SQL-backed build data for one `build_projects` row and normalizes
// it into an in-memory model keyed by `external_id` slugs.
//
// Three GETs in parallel after the project_fk is known:
//   /branches?project_fk=<id>
//   /builds?branch_fk=(<csv of branch ids>)
//   /customer_releases?build_fk=(<csv of build ids>)
//
// The two cascading IN-clause queries are sequential (each needs the prior
// result's id list). Customers names are joined client-side from a customers
// fetch, since /customer_releases stores customer_fk only.

import { useContext, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { fetchEntity } from '../hooks/factory/createEntityQueries';
import { releaseTypeFor } from './readinessRules';
import { branchLevelAtsFor, runsBuildAt } from './acceptanceTestConfig';

function csv(ids) {
    return ids.map(n => Number(n)).filter(Number.isFinite).join(',');
}

export function useBuildVisualizerData(projectId) {
    // Build Visualizer is a dev-only tool pinned to `darwin_dev` (req #2760).
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const creatorFk = profile?.id || null;
    const enabled = !!idToken && !!creatorFk && !!darwinUri && !!projectId;

    // req #2895 — every query carries `placeholderData: keepPreviousData` so a
    // query-key change (below, the builds/releases keys embed CSVs of the prior
    // level's ids) returns the PREVIOUS result during the refetch instead of
    // undefined. Without it, adding/running a build changes `buildIdsCsv`, the
    // releases query gets a brand-new key with no cache, `isLoading` spikes true,
    // and the page swaps the canvas for a spinner — unmounting KonvaBuildCanvas
    // and destroying its pan/zoom transform, which then re-frames from scratch
    // (the "re-center on redraw" bug). Mirrors the Swarm canvas fix
    // (SwarmVisualizerView.jsx / hooks/useDataQueries.js).
    const branchesQuery = useQuery({
        queryKey: ['bv-d3-branches', creatorFk, projectId],
        queryFn: () => fetchEntity(`${darwinUri}/branches?project_fk=${projectId}`, idToken),
        enabled,
        placeholderData: keepPreviousData,
    });

    const branchRows = useMemo(
        () => (Array.isArray(branchesQuery.data) ? branchesQuery.data : []),
        [branchesQuery.data],
    );
    const branchIdsCsv = useMemo(() => csv(branchRows.map(b => b.id)), [branchRows]);

    const buildsQuery = useQuery({
        queryKey: ['bv-d3-builds', creatorFk, projectId, branchIdsCsv],
        queryFn: () => fetchEntity(
            `${darwinUri}/builds?branch_fk=(${branchIdsCsv})`,
            idToken,
        ),
        enabled: enabled && !!branchIdsCsv,
        placeholderData: keepPreviousData,
    });

    const buildRows = useMemo(
        () => (Array.isArray(buildsQuery.data) ? buildsQuery.data : []),
        [buildsQuery.data],
    );
    const buildIdsCsv = useMemo(() => csv(buildRows.map(b => b.id)), [buildRows]);

    const releasesQuery = useQuery({
        queryKey: ['bv-d3-customer-releases', creatorFk, projectId, buildIdsCsv],
        queryFn: () => fetchEntity(
            `${darwinUri}/customer_releases?build_fk=(${buildIdsCsv})`,
            idToken,
        ),
        enabled: enabled && !!buildIdsCsv,
        placeholderData: keepPreviousData,
    });

    const customersQuery = useQuery({
        queryKey: ['bv-d3-customers', creatorFk],
        queryFn: () => fetchEntity(`${darwinUri}/customers`, idToken),
        enabled,
        placeholderData: keepPreviousData,
    });

    const isLoading =
        branchesQuery.isLoading
        || buildsQuery.isLoading
        || releasesQuery.isLoading
        || customersQuery.isLoading;

    // req #2895 — first-ever load (nothing to draw yet) vs a background refetch
    // (branches already in hand). The page gates the full-canvas spinner on this
    // so a mid-session refetch never unmounts KonvaBuildCanvas. With
    // keepPreviousData above, `branchRows` stays populated through a refetch, so
    // this only trips before the very first successful load.
    const isInitialLoad = isLoading && !branchRows.length;

    const error =
        branchesQuery.error
        || buildsQuery.error
        || releasesQuery.error
        || customersQuery.error
        || null;

    // ─── Normalize ──────────────────────────────────────────────────────
    //
    // Output shape:
    //   branches: array of {id (extId), type, name, parentBuildId, parentBranchId,
    //                       side, rowOrder, major, minor, labelEnd, buildIds[]}
    //   builds:   object keyed by extId of {id, branchId, position, build, branchNum,
    //                                       dotColor, approvedForRelease}
    //   releaseEvents: object keyed by build extId of [customer name, …]
    //
    // External IDs (slugs) are the canonical join keys the D3 layout engine
    // uses.
    const model = useMemo(() => {
        if (!branchRows.length) {
            return { branches: [], builds: {}, releaseEvents: {}, releaseEventDetails: {} };
        }

        const branchBySqlId = new Map(branchRows.map(b => [Number(b.id), b]));
        const buildBySqlId = new Map(buildRows.map(b => [Number(b.id), b]));

        // Identify trunk first so we know which branch is `main`. The trunk_branch_fk
        // lives on build_projects but we don't fetch the project row here; instead we
        // recognize the trunk by external_id === 'main' (the seed/import scripts
        // guarantee this slug).
        let trunkSqlId = null;
        for (const [id, br] of branchBySqlId.entries()) {
            if (br.external_id === 'main') { trunkSqlId = id; break; }
        }

        // Builds grouped by their owning branch SQL id, ordered by position.
        const buildsByBranchSqlId = new Map();
        for (const b of buildRows) {
            const k = Number(b.branch_fk);
            if (!buildsByBranchSqlId.has(k)) buildsByBranchSqlId.set(k, []);
            buildsByBranchSqlId.get(k).push(b);
        }
        for (const arr of buildsByBranchSqlId.values()) {
            arr.sort((a, b) => Number(a.position) - Number(b.position));
        }

        // Builds normalized.
        const builds = {};
        for (const b of buildRows) {
            if (!b.external_id) continue;
            const parent = branchBySqlId.get(Number(b.branch_fk));
            builds[b.external_id] = {
                id: b.external_id,
                branchId: parent?.external_id || null,
                position: Number(b.position) || 0,
                build: Number(b.build_number) || 0,
                branchNum: Number(b.branch_number) || 0,
                dotColor: b.dot_color || null,
                approvedForRelease: Number(b.approved_for_release) === 1,
                // Req #2720: per-build M.m — stamped at creation, no look-back.
                // Use nullish (not ||) so an explicit Major=0 / Minor=0 is
                // preserved rather than coerced to the 1 / 0 fallback (req #2737).
                major: b.major != null ? Number(b.major) : 1,
                minor: b.minor != null ? Number(b.minor) : 0,
                createdAt: b.create_ts || null,
            };
        }

        // Branches normalized. Trunk first, then everything else in SQL-id order
        // so parents typically come before children — important for the layout
        // step.
        const branches = [];
        const pushBranch = (br) => {
            if (!br.external_id) return;
            const myBuilds = (buildsByBranchSqlId.get(Number(br.id)) || [])
                .filter(b => b.external_id)
                .map(b => b.external_id);
            const isTrunk = Number(br.id) === trunkSqlId;
            const parentBuildSqlId = br.parent_build_fk != null ? Number(br.parent_build_fk) : null;
            const parentBuildRow = parentBuildSqlId ? buildBySqlId.get(parentBuildSqlId) : null;
            const parentBranchSqlId = parentBuildRow ? Number(parentBuildRow.branch_fk) : null;
            const parentBranchRow = parentBranchSqlId ? branchBySqlId.get(parentBranchSqlId) : null;
            const effType = isTrunk ? 'main' : (br.branch_type || 'development');
            branches.push({
                id: br.external_id,
                type: effType,
                name: br.name || '',
                parentBuildId: isTrunk ? null : (parentBuildRow?.external_id || null),
                parentBranchId: isTrunk ? null : (parentBranchRow?.external_id || null),
                side: br.side || (isTrunk ? 'center' : 'above'),
                rowOrder: br.row_order != null ? Number(br.row_order) : null,
                // Nullish, not ||, so an explicit Major=0 survives (req #2737).
                major: br.major != null ? Number(br.major) : 1,
                minor: br.minor != null ? Number(br.minor) : 0,
                labelEnd: br.label_end || null,
                buildIds: myBuilds,
                // req #2633 — Acceptance Tests. Branch-level AT names come from
                // the frontend matrix (acceptanceTestConfig); the single pass/fail
                // is the branches.acceptance_test_status column; Build AT is the
                // per-build loop flag.
                acceptanceTests: branchLevelAtsFor(effType),
                acceptanceStatus: (br.acceptance_test_status === 'fail') ? 'fail' : 'pass',
                buildAT: runsBuildAt(effType),
            });
        };
        if (trunkSqlId != null) pushBranch(branchBySqlId.get(trunkSqlId));
        const rest = branchRows
            .filter(br => Number(br.id) !== trunkSqlId)
            .sort((a, b) => Number(a.id) - Number(b.id));
        for (const br of rest) pushBranch(br);

        // Customer release events.
        const customerRows = Array.isArray(customersQuery.data) ? customersQuery.data : [];
        const customerNameById = new Map(
            customerRows.map(c => [Number(c.id), c.customer_name || c.name || `customer-${c.id}`]),
        );
        const releaseRows = Array.isArray(releasesQuery.data) ? releasesQuery.data : [];
        const releaseEvents = {};
        // Parallel detail map for the hover tooltip: per build extId, each
        // release event's customer name + date (req #2741). `releaseEvents`
        // (names only) stays the glyph's source of truth so the overlay
        // renderers are untouched.
        const releaseEventDetails = {};
        for (const row of releaseRows) {
            const buildSqlId = Number(row.build_fk);
            const buildRow = buildBySqlId.get(buildSqlId);
            if (!buildRow?.external_id) continue;
            const name = customerNameById.get(Number(row.customer_fk));
            if (!name) continue;
            const extId = buildRow.external_id;
            // Release type (Production / Sample / Debug / Hot Fix) is DERIVED
            // from the build's branch type — a deterministic classification, not
            // stored data, so a mapping change applies retroactively (req #2772;
            // data-architect: derive, don't persist). Resolve the effective type
            // the same way the branch model does (trunk → 'main').
            const branchRow = branchBySqlId.get(Number(buildRow.branch_fk));
            const effType = branchRow
                ? (Number(branchRow.id) === trunkSqlId ? 'main' : (branchRow.branch_type || 'development'))
                : 'development';
            const releaseType = releaseTypeFor(effType);
            if (!releaseEvents[extId]) releaseEvents[extId] = [];
            releaseEvents[extId].push(name);
            if (!releaseEventDetails[extId]) releaseEventDetails[extId] = [];
            releaseEventDetails[extId].push({
                name,
                date: row.release_date || row.create_ts || null,
                releaseType,
            });
        }

        return { branches, builds, releaseEvents, releaseEventDetails };
    }, [branchRows, buildRows, releasesQuery.data, customersQuery.data]);

    return {
        isLoading,
        isInitialLoad,
        isReady: enabled && !!branchesQuery.isSuccess,
        error,
        model,
    };
}

export default useBuildVisualizerData;
