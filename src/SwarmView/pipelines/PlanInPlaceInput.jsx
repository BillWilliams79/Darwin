// PlanInPlaceInput.jsx — the Plan visualizer's in-place name editor (req #3580).
//
// Its own module so it can be exercised without the canvas: the visualizer
// imports Konva, which a jsdom test cannot draw.

import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';

import { isRestNullLiteral, REST_NULL } from '../../Epics/epicsApi';
import { PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import { inputCaretAt } from './planCaretPoint';

export const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

// The longest title either editable column holds — `initiatives.title` and
// `epics.title` are both VARCHAR(256), the cap the Initiatives and Epics
// editors already put on their own title fields.
export const TITLE_MAX = 256;

// Why a typed title cannot be saved, or null when it can. The same two refusals
// the Initiatives and Epics dialogs make: the column is NOT NULL, and the literal
// `NULL` is Lambda-Rest's clear-this-column sentinel, which would land as SQL
// NULL and surface as an opaque 500 rather than a readable refusal.
export function titleProblem(title) {
    if (!title) return 'A title is required';
    if (isRestNullLiteral(title)) {
        return `"${REST_NULL}" is the API's clear-this-column sentinel and cannot be a title.`;
    }
    return null;
}

// ── THE IN-PLACE EDITOR (req #3580) ─────────────────────────────────────────
// One input for both editable names (initiative and epic). Enter or blur commits,
// Escape cancels, and `doneRef` makes the FIRST of those win: an Enter that
// commits also blurs the input as the editor unmounts, and without the latch
// that blur would commit a second time.
//
// `data-viz-chrome` is load-bearing, not a label: d3-zoom's gesture filter and
// the manual world-click hit-test both reject anything inside it, so selecting
// text with the mouse never starts a pan and never fires the bead beneath.
// React's `stopPropagation` cannot do that job — d3 listens natively on the
// container, which runs before React's delegated root handler.
//
// UNMOUNTED WITHOUT ENDING IS A COMMIT, not a discard. The canvas can take the
// editor away under the reader — a wheel zoom out to the level that draws no
// names, or a pan that drops the initiative's chip — and a wheel never blurs the
// input, so neither path above would fire and the typed text would vanish
// unsaved. The check is deferred one tick so React's StrictMode
// unmount-then-remount (which re-runs the setup and sets `mountedRef` again)
// is not mistaken for a real removal. `valueRef`/`onCommitRef` hold the latest
// of each, because the cleanup closes over the FIRST render's.

// The latch and the unmount-commit above, shared by the one-line input and the
// requirement title's wrapping editor (req #3661) — one copy of the rule that
// the FIRST ending wins and that being taken away is a commit.
// `focusSelect` runs once on mount; `valueRef` is read at unmount.
export function useInPlaceEnding({ onCommit, onCancel, valueRef, focusSelect }) {
    const doneRef = useRef(false);
    const mountedRef = useRef(false);
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;
    useEffect(() => {
        mountedRef.current = true;
        focusSelect?.();
        return () => {
            mountedRef.current = false;
            setTimeout(() => {
                if (mountedRef.current || doneRef.current) return;
                doneRef.current = true;
                onCommitRef.current(valueRef.current);
            }, 0);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return (commit) => {
        if (doneRef.current) return;
        doneRef.current = true;
        if (commit) onCommitRef.current(valueRef.current);
        else onCancel();
    };
}

// `growCh` (the initiative chip): the box widens with what is typed rather than
// staying the width of the name it opened on.
// `caretAt` (req #3665): the client point a long press opened the editor at —
// the caret goes there, as a click into a field puts it. Without one (F2) the
// name opens selected.
export default function PlanInPlaceInput({
    initial, onCommit, onCancel, saving, ariaLabel, testId, style, sx, growCh = false,
    caretAt = null,
}) {
    const [value, setValue] = useState(initial);
    const ref = useRef(null);
    const valueRef = useRef(value);
    valueRef.current = value;
    const finish = useInPlaceEnding({
        onCommit, onCancel, valueRef,
        focusSelect: () => {
            const input = ref.current;
            if (!input) return;
            input.focus();
            const at = caretAt ? inputCaretAt(input, caretAt) : null;
            if (at == null) input.select();
            else input.setSelectionRange(at, at);
        },
    });
    return (
        <Box component="input" ref={ref} data-viz-chrome="edit" data-testid={testId}
             aria-label={ariaLabel} value={value} maxLength={TITLE_MAX}
             readOnly={saving} aria-busy={saving || undefined}
             onChange={(ev) => setValue(ev.target.value)}
             onKeyDown={(ev) => {
                 // Kept inside the editor: Space must type a space, not reach
                 // a chip's own Enter/Space handler.
                 ev.stopPropagation();
                 // An Enter that CONFIRMS an input-method composition is not a
                 // commit of the half-typed name.
                 if (ev.nativeEvent?.isComposing) return;
                 if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
                 else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
             }}
             onBlur={() => finish(true)}
             onClick={(ev) => ev.stopPropagation()}
             style={growCh
                 ? { ...style, width: `${Math.max(12, value.length + 2)}ch` }
                 : style}
             sx={{
                 boxSizing: 'border-box', m: 0, outline: 'none',
                 fontFamily: MONO, fontWeight: 700, color: P.text,
                 background: P.panel, border: `1px solid ${P.accent}`,
                 borderRadius: '4px', px: '4px', py: 0,
                 opacity: saving ? 0.6 : 1,
                 ...sx,
             }} />
    );
}

