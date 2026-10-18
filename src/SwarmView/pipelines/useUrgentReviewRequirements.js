// useUrgentReviewRequirements.js — the rows the Plan visualizer's "Urgent
// Review" box lists (req #3622).
//
// Three bounded list reads. The requirement_sessions junction and the
// projected swarm_sessions read carrying `swarm_status` are the SAME two the
// plan page already folds into its Cost column and Session colour key (same
// query keys, so they share its cache entries). The requirement id/title
// projection is the app-wide one other pages share; on the plan page it is one
// new read (every requirement, two short columns — far under the gateway's
// payload cap). Kept out of the box component so that file exports components
// only (React Fast Refresh).
//
// THE TITLES ARE NOT THE ANSWER, THE SESSIONS ARE. A failed title read still
// lists every waiting requirement, by id; only a failed SESSION read is an
// error, because without it the box cannot say what is waiting.

import { useMemo } from 'react';

import {
    useAllRequirements,
    useAllRequirementSessions,
    useAllSessionCostRollups,
} from '../../hooks/useDataQueries';
import { buildSessionStatusIndex } from './pipelineViewModel';
import { urgentReviewRequirements } from './pipelineUrgentReview';

/**
 * @param {string} creatorFk  the profile userName; falsy disables the reads.
 * @returns {{items: Object[], isLoading: boolean, isError: boolean}}
 */
export function useUrgentReviewRequirements(creatorFk) {
    const junction = useAllRequirementSessions(creatorFk);
    const sessions = useAllSessionCostRollups(creatorFk);
    const reqs = useAllRequirements(creatorFk);
    // "Has data", not `isSuccess`, for the Session key's reason: a failed
    // background refetch keeps the last good rows, and so does this box.
    const titlesSettled = reqs.data !== undefined || reqs.isError;
    const ready = junction.data !== undefined && sessions.data !== undefined
        && titlesSettled;
    const items = useMemo(() => (ready
        ? urgentReviewRequirements(
            buildSessionStatusIndex({
                requirementSessions: junction.data, sessions: sessions.data,
            }),
            reqs.data)
        : []), [ready, junction.data, sessions.data, reqs.data]);
    const isError = !ready && !!(junction.isError || sessions.isError);
    return { items, isLoading: !ready && !isError, isError };
}
