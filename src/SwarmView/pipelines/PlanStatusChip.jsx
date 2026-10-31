// PlanStatusChip.jsx — the plan page header's status editor (req #3965).
//
// It replaced the conditional "Paused" chip (req #3226): a plan no longer
// pauses, and its status is now one of seven values the reader must be able to
// see AND change from the plan itself — a reader who reached the plan by a deep
// link never saw the Pipelines list. Always shown, on every mode.
//
// The control is the shared `PipelineStatusChip`; this file is its write: the
// status alone through pipelinesApi (the gateway derives the timestamps, and a
// status write is allowed on a locked plan), then the same re-read PlanTitle's
// editor makes — the composed plan and the pipelines list.

import { useCallback, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { pipelineKeys } from '../../hooks/useDataQueries';
import { pipelineComposeKeys } from '../../hooks/useQueryKeys';
import { updatePipeline } from '../../Pipelines/pipelinesApi';
import PipelineStatusChip from '../../Pipelines/PipelineStatusChip';
import { ORCHESTRATING_STATUS, pipelineStatusLabel } from './pipelineChipStyles';

/**
 * @param {Object} props
 * @param {Object} props.pipeline  the plan row (id, pipeline_status)
 */
export default function PlanStatusChip({ pipeline }) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);

    const change = useCallback(async (next) => {
        try {
            await updatePipeline(darwinUri, idToken, pipeline.id, { pipeline_status: next });
        } catch (err) {
            showError(err, 'Could not change the pipeline status');
        } finally {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) }),
                profile?.userName && queryClient.invalidateQueries({
                    queryKey: pipelineKeys.all(profile.userName) }),
            ]);
        }
    }, [darwinUri, idToken, pipeline?.id, queryClient, profile?.userName, showError]);

    if (!pipeline) return null;
    const status = pipeline.pipeline_status;
    return (
        <PipelineStatusChip
            status={status}
            onChange={change}
            testId="pipeline-detail-status"
            tooltip={status === ORCHESTRATING_STATUS
                ? 'Running — its epics launch. Click to change the status.'
                : `${pipelineStatusLabel(status)} — only a Running plan launches work. `
                    + 'Click to change the status.'}
        />
    );
}
