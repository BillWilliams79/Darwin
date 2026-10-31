// PlanTitle.jsx — the plan's name in the plan page's header, with the
// initiative and epic names' gestures (req #3853).
//
// User directive: "Pipeline title name should give us: same interactivity and
// editing that Initiative and Epic has. I want the zoom from pipeline title to
// active epics view." So the name and its counts read exactly as an
// initiative's name and closure count do on the canvas (req #3580, #3742):
//
//   the NAME     quick click ... the plan's single editor (`PipelineEditDialog`,
//                                rewritten to the epic/initiative editors' form by
//                                req #4128 — its Delete leaves through `onDeleted`)
//                double click .. zoom straight to the plan's active epics
//                long press .... rename in place (F2 from the keyboard)
//                Enter/Space ... the editor, as the quick click
//   the COUNTS   click ......... the zoom cycle — active epics, then the whole plan
//                double click .. the active epics
//
// The camera is the canvas's: `onZoom({ deep })` reaches it through the page
// (`titleZoom`'s nonce, `PipelinePlanVisualizer.jsx` `activatePlanTitle`). It is
// null while no plan canvas is drawn, and then nothing here offers a zoom.
//
// The Typography keeps `data-testid="pipeline-title"` and NO aria-label of its
// own (req #3648 — its text is its accessible name). Each part names its
// gestures in `aria-description`, never `aria-label`: a label on a child
// replaces that child's text in the heading's computed name.

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { pipelineKeys } from '../../hooks/useDataQueries';
import { pipelineComposeKeys } from '../../hooks/useQueryKeys';
import { updatePipeline } from '../../Pipelines/pipelinesApi';
import PipelineEditDialog from '../../Pipelines/PipelineEditDialog';
import PlanInPlaceInput, { titleProblem } from './PlanInPlaceInput';
import { createPressTracker, DOUBLE_CLICK_MS } from './planPressGesture';
import { PLAN_TITLE_ZOOM_HINT } from './pipelineInitiativeZoom';

const LOCKED = 'This pipeline is locked — unlock it first';

const hover = {
    cursor: 'pointer',
    '&:hover': { textDecoration: 'underline', textDecorationThickness: '1px',
        textUnderlineOffset: '3px' },
    '&:focus-visible': { outline: '2px solid', outlineOffset: '2px', borderRadius: '2px' },
};

/**
 * @param {Object} props
 * @param {Object} props.pipeline     the plan row (title, description, machine_fk, locked)
 * @param {string} props.countsText   "EE  -  MM/TT", or '' for none
 * @param {string} props.variant      the header's Typography variant (h5 / h6)
 * @param {Object[]} [props.machines] the machine dictionary, for the editor
 * @param {?function} [props.onZoom]  `({ deep }) => void`, or null with no canvas
 * @param {?Object} [props.deletion]  the editor's Delete (req #4128): `{ initiatives,
 *                                    epics, requirements, orchestrated }`, or null for none
 * @param {function} [props.onDeleted] after the editor deleted the plan
 */
export default function PlanTitle({ pipeline, countsText, variant, machines = [], onZoom = null,
    deletion = null, onDeleted }) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);

    // `{ saving, at }` while the in-place rename is open; `at` is the long
    // press's point (the caret goes there), null from F2 (the name is selected).
    const [edit, setEdit] = useState(null);
    // `key` changes per open so the editor seeds afresh from the stored row.
    const [editor, setEditor] = useState({ key: 0, open: false });
    // The second click of a quick double click lands on the dialog's backdrop,
    // which must not close it at once (the canvas editor's rule).
    const openedAtRef = useRef(0);

    const pressRef = useRef(null);
    if (!pressRef.current) pressRef.current = createPressTracker();
    useEffect(() => () => pressRef.current?.dispose(), []);

    const locked = !!Number(pipeline?.locked ?? 0);

    const refresh = useCallback(() => Promise.all([
        queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline?.id) }),
        profile?.userName && queryClient.invalidateQueries({
            queryKey: pipelineKeys.all(profile.userName) }),
    ]), [queryClient, pipeline?.id, profile?.userName]);

    const openEditor = () => {
        openedAtRef.current = Date.now();
        setEditor((ed) => ({ key: ed.key + 1, open: true }));
    };
    const closeEditor = (reason) => {
        if (reason === 'backdropClick' && Date.now() - openedAtRef.current < DOUBLE_CLICK_MS) return;
        setEditor((ed) => ({ ...ed, open: false }));
    };
    const startEdit = (at = null) => {
        if (locked) { showError(LOCKED); return; }
        setEdit({ saving: false, at });
    };

    // The canvas names' commit rule (`commitTitle`): an unchanged name closes
    // without a write, a refused one says why and keeps the stored name.
    const commitTitle = async (raw) => {
        const next = String(raw ?? '').trim();
        if (next === (pipeline?.title ?? '')) { setEdit(null); return; }
        const problem = titleProblem(next);
        if (problem) { showError(problem); setEdit(null); return; }
        setEdit((cur) => (cur ? { ...cur, saving: true } : cur));
        try {
            await updatePipeline(darwinUri, idToken, pipeline.id, { title: next });
            await refresh();
        } catch (err) {
            showError(err, 'Could not rename the pipeline');
        } finally {
            setEdit(null);
        }
    };

    const zoom = (deep) => onZoom?.({ deep });
    const press = (part, cbs) => ({
        onPointerDown: (ev) => {
            if (ev.button !== 0) return;
            pressRef.current.down(`plan-title-${part}`, ev.clientX, ev.clientY, cbs);
        },
        onPointerMove: (ev) => pressRef.current.move(ev.clientX, ev.clientY),
        onPointerUp: () => pressRef.current.up(`plan-title-${part}`),
        onPointerCancel: () => pressRef.current.cancel(),
        onPointerLeave: () => pressRef.current.cancel(),
    });
    const title = pipeline?.title ?? '';

    return (
        <>
            <Typography variant={variant} noWrap
                        sx={{ flex: '0 1 auto', minWidth: 0 }}
                        data-editing={edit ? 'true' : undefined}
                        data-testid="pipeline-title">
                {edit ? (
                    <PlanInPlaceInput
                        initial={title}
                        saving={!!edit.saving}
                        ariaLabel={`Rename pipeline ${title}`}
                        testId="pipeline-title-edit"
                        onCommit={commitTitle}
                        onCancel={() => setEdit(null)}
                        caretAt={edit.at}
                        growCh
                        style={{ fontSize: 'inherit' }}
                        // The header's own type, not the canvas's: the name is
                        // edited where and as it is drawn.
                        sx={{ fontFamily: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit',
                            color: 'text.primary', background: 'transparent', maxWidth: '100%' }}
                    />
                ) : (
                    <Box component="span" role="button" tabIndex={0}
                         data-testid="pipeline-title-name"
                         aria-description={'Click to edit the pipeline'
                             + (onZoom ? ', double click to zoom to the active epics' : '')
                             + ', press F2 to rename'}
                         {...press('name', {
                             onClick: openEditor,
                             ...(onZoom ? { onDoubleClick: () => zoom(true) } : null),
                             onLongPress: startEdit,
                         })}
                         // A touch long press would otherwise also open the
                         // browser's own menu.
                         onContextMenu={(ev) => ev.preventDefault()}
                         onKeyDown={(ev) => {
                             if (ev.key === 'F2') { ev.preventDefault(); startEdit(); return; }
                             if (ev.key !== 'Enter' && ev.key !== ' ') return;
                             ev.preventDefault();
                             openEditor();
                         }}
                         sx={{ ...hover, userSelect: 'none' }}>
                        {title}
                    </Box>
                )}
                {/* A REAL SPACE, not just the margin below (measured — the
                    first cut had only the margin and the row's `textContent`
                    read "…Agent Harness4 Initiatives, 73/115…"). The margin is
                    what the eye sees; this is what a COPY-PASTE carries. */}
                {countsText && ' '}
                {countsText && (
                    <Box component="span"
                         data-testid="pipeline-title-counts"
                         {...(onZoom ? {
                             role: 'button', tabIndex: 0,
                             'aria-description': PLAN_TITLE_ZOOM_HINT,
                             ...press('counts', {
                                 onClick: () => zoom(false),
                                 onDoubleClick: () => zoom(true),
                             }),
                             onKeyDown: (ev) => {
                                 if (ev.key !== 'Enter' && ev.key !== ' ') return;
                                 ev.preventDefault();
                                 zoom(false);
                             },
                         } : null)}
                         sx={{
                             // `em`, so the counts stay in proportion through
                             // the `h6`/`h5` breakpoint swap.
                             fontSize: '0.62em',
                             fontWeight: 400,
                             color: 'text.secondary',
                             // A margin rather than a space in the string so it
                             // does not collapse against the ellipsis. The
                             // counts come LAST so a clip spends the name first.
                             ml: 1,
                             ...(onZoom ? { ...hover, userSelect: 'none' } : null),
                         }}>
                        {countsText}
                    </Box>
                )}
            </Typography>
            {editor.key > 0 && (
                <PipelineEditDialog
                    key={editor.key}
                    open={editor.open}
                    pipeline={pipeline}
                    machines={machines}
                    onClose={closeEditor}
                    onSaved={refresh}
                    deletion={deletion}
                    onDeleted={onDeleted}
                />
            )}
        </>
    );
}
