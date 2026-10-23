// useCreatePipeline.js — the one create path behind both of the Pipelines
// page's create controls (req #3773): the header's "New pipeline" dialog and
// the Cards view's "New pipeline" tile. Two controls, one write, one
// validation, one landing — so the trial between them is a trial of the
// CONTROL, not of two subtly different behaviours.
//
// A created plan is OPENED at once: it is born `draft` and empty, and the plan
// page is where its first epic and step are added (`EmptyPlanAddStep.jsx`).

import { useCallback, useContext, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { pipelineKeys } from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { planDetailPath } from '../SwarmView/pipelines/planEra';
import { createPipeline, isRestNullLiteral, REST_NULL } from './pipelinesApi';

/**
 * `{ create, creating }`. `create(fields)` resolves `true` once the plan is
 * written (the caller closes its control), `false` when it refused or failed
 * (the caller keeps the typed title so nothing is lost).
 */
export default function useCreatePipeline() {
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const showError = useSnackBarStore((s) => s.showError);
    const [creating, setCreating] = useState(false);
    // The in-flight guard is a ref, not `creating`: a second Enter must never
    // reach a closure that has not yet seen the first — a duplicate POST is a
    // second pipeline.
    const inFlightRef = useRef(false);

    const create = useCallback(async ({ title, description = '', execution_mode = 'parallel',
        machine_fk = null }) => {
        if (inFlightRef.current) return false;
        const trimmed = (title ?? '').trim();
        if (!trimmed) {
            showError('Title is required');
            return false;
        }
        if (isRestNullLiteral(trimmed)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return false;
        }
        inFlightRef.current = true;
        setCreating(true);
        try {
            const id = await createPipeline(darwinUri, idToken, {
                title: trimmed,
                description: description.trim() || null,
                execution_mode,
                machine_fk,
            });
            if (id == null) {
                // Written but not read back — creating again would make a twin.
                showError('The pipeline may have been created — check the list before '
                    + 'creating it again');
                return true;
            }
            const to = planDetailPath(id);
            if (to) navigate(to);
            return true;
        } catch (error) {
            showError(error, 'Could not create the pipeline');
            return false;
        } finally {
            inFlightRef.current = false;
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: pipelineKeys.all(profile?.userName) });
        }
    }, [darwinUri, idToken, navigate, profile?.userName, queryClient, showError]);

    return { create, creating };
}
