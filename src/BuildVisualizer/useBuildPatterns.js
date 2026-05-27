// Req #2648 — SQL-backed pattern library.
//
// Replaces `usePatternLibrary.js` (localStorage-only). Each "pattern" in the
// dropdown is a row in `build_projects` — the iframe loads its branches +
// builds from SQL via SqlBackedStorageAdapter when the user activates one.
//
// Surface kept compatible with the consumers of `usePatternLibrary` (
// BuildPatternMenu + BuildVisualizerPage) so the call sites need only the
// import-name flip plus async/await on the mutation callbacks:
//   { isReady, error, clearError, library, patterns, activeId, activePattern,
//     selectPattern, createNew, rename, remove, saveAs,
//     exportAll, importAll }
//
// Differences from the old hook:
//   • `library` is { version, activeId, patterns: {} } reassembled from the
//     SQL result so the shape stays consistent with the consumer.
//   • `patterns` is sorted by updatedAt desc (same as before).
//   • `activePattern.data` is the SQL projectId (NOT a builds.json blob — the
//     iframe fetches its own data via bv:sql-init). Consumers that previously
//     read `.data` to send via bv:load now read `.projectId` and post
//     bv:sql-init instead.
//   • `exportAll` / `importAll` are stubbed for v1 (req #2648 deferred — not
//     in acceptance criteria). They keep a working shape so the menu doesn't
//     crash, but the import path no-ops with a helpful error.
//   • `saveActiveData` is removed — the iframe now persists directly via the
//     SqlBackedStorageAdapter on every model mutation. Consumers that used
//     it (BuildVisualizerPage's bv:changed handler) drop the call.

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

const ACTIVE_ID_STORAGE_KEY = 'darwin.buildVisualizer.activeProjectId.v1';

const readActiveId = () => {
    try {
        const v = window.localStorage.getItem(ACTIVE_ID_STORAGE_KEY);
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch (_) {
        return null;
    }
};

const writeActiveId = (id) => {
    try {
        if (id == null) window.localStorage.removeItem(ACTIVE_ID_STORAGE_KEY);
        else window.localStorage.setItem(ACTIVE_ID_STORAGE_KEY, String(id));
    } catch (_) { /* private mode — accept transient state */ }
};

function buildPatternFromProject(row) {
    return {
        id: row.id,
        projectId: row.id,
        name: row.title || row.name || `Project ${row.id}`,
        createdAt: row.create_ts || null,
        updatedAt: row.update_ts || row.create_ts || null,
        description: row.description || '',
    };
}

export function useBuildPatterns() {
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const creatorFk = profile?.id || null;
    const queryClient = useQueryClient();

    const projectsQuery = useQuery({
        queryKey: ['build_projects', creatorFk],
        queryFn: () => fetchEntity(`${darwinUri}/build_projects`, idToken),
        enabled: !!idToken && !!creatorFk && !!darwinUri,
    });

    const [activeId, setActiveId] = useState(() => readActiveId());
    const [error, setError] = useState(null);

    const patterns = useMemo(() => {
        const rows = Array.isArray(projectsQuery.data) ? projectsQuery.data : [];
        return rows
            .map(buildPatternFromProject)
            .sort((a, b) => {
                if (!a.updatedAt && !b.updatedAt) return a.name.localeCompare(b.name);
                if (!a.updatedAt) return 1;
                if (!b.updatedAt) return -1;
                return a.updatedAt < b.updatedAt ? 1 : -1;
            });
    }, [projectsQuery.data]);

    // If the saved activeId no longer matches any project (deleted from another
    // session, or first-ever load), fall back to the first available pattern.
    useEffect(() => {
        if (!projectsQuery.isSuccess) return;
        if (!patterns.length) {
            if (activeId !== null) {
                setActiveId(null);
                writeActiveId(null);
            }
            return;
        }
        if (!activeId || !patterns.find(p => p.id === activeId)) {
            const next = patterns[0].id;
            setActiveId(next);
            writeActiveId(next);
        }
    }, [projectsQuery.isSuccess, patterns, activeId]);

    const activePattern = useMemo(
        () => (activeId ? patterns.find(p => p.id === activeId) || null : null),
        [activeId, patterns],
    );

    const invalidateProjects = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['build_projects', creatorFk] });
    }, [queryClient, creatorFk]);

    // -----------------------------------------------------------------------
    // Mutations. All mutations talk directly to Lambda-Rest via call_rest_api
    // so the hook owns its own write path (no separate mutation hook layer
    // needed for v1). Each mutation invalidates the projects list on success.
    // -----------------------------------------------------------------------

    const handleApiResult = (result, opName) => {
        if (!result || !result.httpStatus
                || result.httpStatus.httpStatus < 200
                || result.httpStatus.httpStatus >= 300) {
            const msg = `${opName} failed (status=${result?.httpStatus?.httpStatus ?? '???'})`;
            throw new Error(msg);
        }
        return result.data;
    };

    const createMutation = useMutation({
        mutationFn: async ({ title, description }) => {
            // Lookup the Build Projects category id (matches seed_build_projects.py).
            const catUri = `${darwinUri}/categories?category_name=Build%20Projects`;
            const catRes = await call_rest_api(catUri, 'GET', '', idToken);
            const catRows = handleApiResult(catRes, 'GET categories');
            const categoryId = Array.isArray(catRows) && catRows.length ? catRows[0].id : null;
            if (!categoryId) {
                throw new Error('Build Projects category not found; run seed_build_projects.py first.');
            }
            // POST /build_projects
            const projRes = await call_rest_api(
                `${darwinUri}/build_projects`, 'POST',
                {
                    title,
                    description: description || '',
                    project_status: 'active',
                    category_fk: categoryId,
                },
                idToken,
            );
            const proj = handleApiResult(projRes, 'POST build_projects');
            const newProjectId = Array.isArray(proj) ? proj[0]?.id : proj?.id;
            if (!newProjectId) throw new Error('build_projects POST returned no id');

            // POST trunk branch.
            const branchRes = await call_rest_api(
                `${darwinUri}/branches`, 'POST',
                {
                    project_fk: newProjectId,
                    branch_type: 'release',
                    name: 'Main',
                    major: 1,
                    minor: 0,
                    external_id: 'main',
                    side: 'center',
                },
                idToken,
            );
            const branch = handleApiResult(branchRes, 'POST branches');
            const trunkId = Array.isArray(branch) ? branch[0]?.id : branch?.id;
            if (!trunkId) throw new Error('branches POST returned no id');

            // PUT project trunk_branch_fk.
            await call_rest_api(
                `${darwinUri}/build_projects`, 'PUT',
                [{ id: newProjectId, trunk_branch_fk: trunkId }],
                idToken,
            );

            // POST first build.
            await call_rest_api(
                `${darwinUri}/builds`, 'POST',
                {
                    branch_fk: trunkId,
                    position: 0,
                    build_number: 1,
                    branch_number: 0,
                    external_id: 'm1',
                },
                idToken,
            );
            return newProjectId;
        },
        onSuccess: (newId) => {
            setActiveId(newId);
            writeActiveId(newId);
            invalidateProjects();
        },
        onError: (e) => setError(e?.message || 'create failed'),
    });

    const renameMutation = useMutation({
        mutationFn: async ({ id, title }) => {
            const res = await call_rest_api(
                `${darwinUri}/build_projects`, 'PUT',
                [{ id, title }],
                idToken,
            );
            return handleApiResult(res, 'PUT build_projects (rename)');
        },
        onSuccess: invalidateProjects,
        onError: (e) => setError(e?.message || 'rename failed'),
    });

    const removeMutation = useMutation({
        mutationFn: async ({ id }) => {
            const res = await call_rest_api(
                `${darwinUri}/build_projects`, 'DELETE',
                { id },
                idToken,
            );
            return handleApiResult(res, 'DELETE build_projects');
        },
        onSuccess: () => {
            // Active id may now point at a deleted project; the patterns effect
            // re-resolves on the next render.
            invalidateProjects();
        },
        onError: (e) => setError(e?.message || 'delete failed'),
    });

    // -----------------------------------------------------------------------
    // Surface
    // -----------------------------------------------------------------------

    const library = useMemo(
        () => ({
            version: 1,
            activeId,
            patterns: Object.fromEntries(patterns.map(p => [p.id, p])),
        }),
        [activeId, patterns],
    );

    const selectPattern = useCallback((id) => {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) return;
        setActiveId(numericId);
        writeActiveId(numericId);
    }, []);

    const createNew = useCallback(async (name /* opts unused — SQL initial build is always 1.0.1 */) => {
        const title = String(name || '').trim();
        if (!title) return { ok: false, error: 'name required' };
        try {
            await createMutation.mutateAsync({ title });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e?.message || 'create failed' };
        }
    }, [createMutation]);

    const rename = useCallback(async (id, name) => {
        const title = String(name || '').trim();
        if (!title) return { ok: false, error: 'name required' };
        try {
            await renameMutation.mutateAsync({ id, title });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e?.message || 'rename failed' };
        }
    }, [renameMutation]);

    const remove = useCallback(async (id) => {
        if (patterns.length <= 1) {
            return { ok: false, error: "Can't delete the last pattern" };
        }
        try {
            await removeMutation.mutateAsync({ id });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e?.message || 'delete failed' };
        }
    }, [removeMutation, patterns]);

    // saveAs / exportAll / importAll — v1 stubs. The SQL-backed pattern model
    // doesn't yet support deep clone (would require fetching all branches +
    // builds and reposting them with new external_id mappings). Keeping
    // working shapes so the menu items can stay visible-but-disabled until a
    // follow-up requirement lights them up. Each returns the unified
    // {ok, error} shape the consumer already understands.
    const saveAs = useCallback(async () => ({
        ok: false,
        error: 'Duplicate not yet implemented for SQL-backed patterns (req #2648 v1).',
    }), []);
    const exportAll = useCallback(() => new Blob(['{}'], { type: 'application/json' }), []);
    const importAll = useCallback(async () => ({
        ok: false,
        error: 'Import not yet implemented for SQL-backed patterns (req #2648 v1).',
    }), []);

    const isReady = !!projectsQuery.isSuccess || !!projectsQuery.data;
    const liveError = error || projectsQuery.error?.message || null;

    return {
        isReady,
        error: liveError,
        clearError: useCallback(() => setError(null), []),
        library,
        patterns,
        activeId,
        activePattern,
        selectPattern,
        saveActiveData: () => {}, // no-op — see header comment
        saveAs,
        createNew,
        rename,
        remove,
        exportAll,
        importAll,
    };
}

export default useBuildPatterns;
