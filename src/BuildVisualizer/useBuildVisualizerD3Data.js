// req #2694 — Build Visualizer D3
//
// Fetches the SQL-backed build data for one `build_projects` row and normalizes
// it into an in-memory model keyed by the iframe's `external_id` slugs (so this
// hook's output shape matches what the existing iframe also computes).
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
import { useQuery } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

function csv(ids) {
    return ids.map(n => Number(n)).filter(Number.isFinite).join(',');
}

export function useBuildVisualizerD3Data(projectId) {
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const creatorFk = profile?.id || null;
    const enabled = !!idToken && !!creatorFk && !!darwinUri && !!projectId;

    const branchesQuery = useQuery({
        queryKey: ['bv-d3-branches', creatorFk, projectId],
        queryFn: () => fetchEntity(`${darwinUri}/branches?project_fk=${projectId}`, idToken),
        enabled,
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
    });

    const customersQuery = useQuery({
        queryKey: ['bv-d3-customers', creatorFk],
        queryFn: () => fetchEntity(`${darwinUri}/customers`, idToken),
        enabled,
    });

    const isLoading =
        branchesQuery.isLoading
        || buildsQuery.isLoading
        || releasesQuery.isLoading
        || customersQuery.isLoading;

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
    // External IDs (slugs) are the canonical join keys — the iframe and any
    // future D3 layout engine can both use them.
    const model = useMemo(() => {
        if (!branchRows.length) {
            return { branches: [], builds: {}, releaseEvents: {} };
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
                major: Number(parent?.major) || 1,
                minor: Number(parent?.minor) || 0,
            };
        }

        // Branches normalized. Trunk first, then everything else in SQL-id order
        // (matches the iframe convention so parents typically come before
        // children — important for the layout step).
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
            branches.push({
                id: br.external_id,
                type: isTrunk ? 'main' : (br.branch_type || 'development'),
                name: br.name || '',
                parentBuildId: isTrunk ? null : (parentBuildRow?.external_id || null),
                parentBranchId: isTrunk ? null : (parentBranchRow?.external_id || null),
                side: br.side || (isTrunk ? 'center' : 'above'),
                rowOrder: br.row_order != null ? Number(br.row_order) : null,
                major: Number(br.major) || 1,
                minor: Number(br.minor) || 0,
                labelEnd: br.label_end || null,
                buildIds: myBuilds,
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
        for (const row of releaseRows) {
            const buildSqlId = Number(row.build_fk);
            const buildRow = buildBySqlId.get(buildSqlId);
            if (!buildRow?.external_id) continue;
            const name = customerNameById.get(Number(row.customer_fk));
            if (!name) continue;
            if (!releaseEvents[buildRow.external_id]) releaseEvents[buildRow.external_id] = [];
            releaseEvents[buildRow.external_id].push(name);
        }

        return { branches, builds, releaseEvents };
    }, [branchRows, buildRows, releasesQuery.data, customersQuery.data]);

    return {
        isLoading,
        isReady: enabled && !!branchesQuery.isSuccess,
        error,
        model,
    };
}

export default useBuildVisualizerD3Data;
