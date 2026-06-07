// Req #2593 — Devops data-object query factory.
//
// Collapses the 5+ near-identical hook bodies that every devops table
// (dev_servers / swarm_sessions / swarm_starts / swarm_start_sessions and
// any future addition such as build_runs / deployment_logs / release_artifacts)
// would otherwise require into one declarative call.
//
// Output shape mirrors the pre-#2593 hand-written hooks exactly so cache-key
// invalidations, URL shapes, and `enabled` predicates all stay byte-identical
// across the refactor. The parity tests in __tests__/devopsQueriesParity.test.js
// enforce that.
//
// Usage:
//   const buildRuns = createEntityQueries({
//       entity: 'build_runs',
//       defaultFields: 'id,status,started_at,duration_sec',
//       fieldsInKey: true,
//       defaultSort: 'started_at:desc',
//       foreignKeys: [{ field: 'pipeline_fk', as: 'pipeline' }],
//   });
//   // → buildRuns.keys.{all, byId, byPipeline}
//   // → buildRuns.useAll, buildRuns.useById, buildRuns.useByPipeline

import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';

import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import call_rest_api from '../../RestApi/RestApi';

// Identical fetch wrapper to the one inlined in useDataQueries.js. Lives here
// so the factory and useDataQueries.js can share without circular imports
// (factory imports the util, useDataQueries.js re-imports the same util when
// any non-devops hook continues to call it directly).
export async function fetchEntity(uri, idToken) {
    try {
        const result = await call_rest_api(uri, 'GET', '', idToken);
        // call_rest_api returns (not throws) on network errors (e.g. CORS) with httpStatus 503.
        // Treat non-2xx returns as errors so TanStack Query gets error state, not bad data.
        if (result.httpStatus.httpStatus < 200 || result.httpStatus.httpStatus >= 300) {
            throw result;
        }
        return result.data;
    } catch (error) {
        if (error.httpStatus?.httpStatus === 404) {
            return [];
        }
        throw error;
    }
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function createEntityQueries({
    entity,
    defaultFields,
    fieldsInKey = false,
    defaultSort,
    byIdCreatorScoped = true,
    byIdReturnsArray = false,
    foreignKeys = [],
    // Req #2697 — operational tables (`dev_servers`, `swarm_sessions`,
    // `swarm_starts`, `swarm_start_sessions`) live exclusively in the
    // production `darwin` schema regardless of dev/prod mode. Set `ops: true`
    // and the factory picks `darwinOpsUri` from AppContext for every URL.
    ops = false,
}) {
    if (!entity) throw new Error('createEntityQueries: entity is required');

    // ----- cache keys -----

    const keys = {
        all: (creatorFk) => [entity, creatorFk],
        byId: byIdCreatorScoped
            ? (creatorFk, id) => [entity, creatorFk, { id }]
            : (id) => [entity, { id }],
    };

    foreignKeys.forEach((fk) => {
        const keyName = `by${capitalize(fk.as)}`;
        const creatorScoped = fk.creatorScoped !== false;
        // `keyParam` lets a declaration preserve a legacy cache-key object-key
        // name (e.g. dev_servers' historical `{ sessionId }`) while the REST
        // filter still uses the SQL column (`session_fk`). Defaults to fk.field
        // so a fresh entity gets the consistent SQL-column shape automatically.
        const keyParam = fk.keyParam || fk.field;
        if (creatorScoped) {
            keys[keyName] = (creatorFk, id) => [entity, creatorFk, { [keyParam]: id }];
        } else {
            keys[keyName] = (id) => [entity, { [keyParam]: id }];
        }
    });

    // ----- hooks -----

    function useAll(creatorFk, options = {}) {
        const { darwinUri, darwinOpsUri } = useContext(AppContext);
        const { idToken } = useContext(AuthContext);
        const { fields = defaultFields, sort = defaultSort, enabled = true, staleTime } = options;

        const uriRoot = ops ? darwinOpsUri : darwinUri;
        const params = [];
        if (fields) params.push(`fields=${fields}`);
        if (sort) params.push(`sort=${sort}`);
        const uri = params.length ? `${uriRoot}/${entity}?${params.join('&')}` : `${uriRoot}/${entity}`;

        const baseKey = keys.all(creatorFk);
        const queryKey = fieldsInKey && fields ? [...baseKey, { fields }] : baseKey;

        return useQuery({
            queryKey,
            queryFn: () => fetchEntity(uri, idToken),
            enabled: enabled && !!creatorFk && !!idToken,
            ...(staleTime !== undefined ? { staleTime } : {}),
        });
    }

    function useById(...args) {
        // Two call shapes match keys.byId:
        //   creatorScoped:  useById(creatorFk, id, options)
        //   not scoped:     useById(id, options)
        let creatorFk, id, options;
        if (byIdCreatorScoped) {
            [creatorFk, id, options = {}] = args;
        } else {
            [id, options = {}] = args;
            creatorFk = null;
        }
        const { darwinUri, darwinOpsUri } = useContext(AppContext);
        const { idToken } = useContext(AuthContext);
        const { fields, enabled = true } = options;

        const uriRoot = ops ? darwinOpsUri : darwinUri;
        const params = [`id=${id}`];
        if (fields) params.push(`fields=${fields}`);
        const uri = `${uriRoot}/${entity}?${params.join('&')}`;

        const queryKey = byIdCreatorScoped ? keys.byId(creatorFk, id) : keys.byId(id);

        const enabledFinal = byIdCreatorScoped
            ? enabled && !!creatorFk && !!id && !!idToken
            : enabled && !!id && !!idToken;

        return useQuery({
            queryKey,
            queryFn: async () => {
                const data = await fetchEntity(uri, idToken);
                if (byIdReturnsArray) return data;
                return data.length > 0 ? data[0] : null;
            },
            enabled: enabledFinal,
        });
    }

    // ----- foreign-key list hooks -----

    const fkHooks = {};
    foreignKeys.forEach((fk) => {
        const hookName = `useBy${capitalize(fk.as)}`;
        const keyFn = keys[`by${capitalize(fk.as)}`];
        const creatorScoped = fk.creatorScoped !== false;

        fkHooks[hookName] = function (...args) {
            let creatorFk, id, options;
            if (creatorScoped) {
                [creatorFk, id, options = {}] = args;
            } else {
                [id, options = {}] = args;
                creatorFk = null;
            }
            const { darwinUri, darwinOpsUri } = useContext(AppContext);
            const { idToken } = useContext(AuthContext);
            const { fields = defaultFields, enabled = true } = options;

            const uriRoot = ops ? darwinOpsUri : darwinUri;
            const params = [`${fk.field}=${id}`];
            if (fields) params.push(`fields=${fields}`);
            const uri = `${uriRoot}/${entity}?${params.join('&')}`;

            const queryKey = creatorScoped ? keyFn(creatorFk, id) : keyFn(id);

            const enabledFinal = creatorScoped
                ? enabled && !!creatorFk && !!id && !!idToken
                : enabled && !!id && !!idToken;

            return useQuery({
                queryKey,
                queryFn: () => fetchEntity(uri, idToken),
                enabled: enabledFinal,
            });
        };
    });

    return { keys, useAll, useById, ...fkHooks };
}
