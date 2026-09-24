// BuiltAtField — inline editor for builds.built_at on the build-dot card
// (req #3515). The value is stored UTC and edited in Pacific (BUILD_TIMEZONE)
// through a native datetime-local input.
//
// Commit model mirrors the page's other inline edits: the draft is local while
// typing (a datetime-local fires onChange per segment, so committing on change
// would PUT half-typed values), and it commits on blur or Enter — only when the
// UTC value actually differs. Escape reverts the draft. Clearing the input
// commits NULL ("not recorded"). The draft re-syncs whenever the stored value
// changes underneath it (the refetch after a save, or another build's card).
//
// A HALF-TYPED value is not a clear (code review, req #3515). Per the HTML spec a
// datetime-local whose segments are incomplete reports `value === ''` and sets
// `validity.badInput` — so backspacing the hour on a dated build and clicking away
// would otherwise PUT built_at = NULL and lose the time. Only a genuinely EMPTY
// field clears; bad input reverts. A rejected save reverts too, rather than
// leaving the field showing a value the database does not hold.

import { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';

import { builtAtFromInput, builtAtToInput } from './buildDateTime';

// Normalize a stored value to the same 'YYYY-MM-DD HH:MM:SS' shape
// builtAtFromInput emits, so "unchanged" compares like with like.
function storedAsUtcMinutes(value) {
    const local = builtAtToInput(value);
    return local ? builtAtFromInput(local) : null;
}

export default function BuiltAtField({ value, onCommit, disabled = false }) {
    const [draft, setDraft] = useState(() => builtAtToInput(value));
    // `true` while the input holds an incomplete datetime (value === '' with
    // validity.badInput). Never committed.
    const [badInput, setBadInput] = useState(false);

    useEffect(() => {
        setDraft(builtAtToInput(value));
        setBadInput(false);
    }, [value]);

    const revert = () => { setDraft(builtAtToInput(value)); setBadInput(false); };

    const commit = async () => {
        if (badInput) { revert(); return; }
        const next = builtAtFromInput(draft);
        if (next === storedAsUtcMinutes(value)) return;
        try {
            await onCommit?.(next);
        } catch {
            revert();   // the page reports the failure; the field must not lie
        }
    };

    return (
        <TextField
            label="Built (Pacific)"
            type="datetime-local"
            size="small"
            fullWidth
            margin="dense"
            value={draft}
            disabled={disabled}
            error={badInput}
            helperText={badInput ? 'Incomplete — finish the date/time or clear it' : ''}
            onChange={(e) => {
                setBadInput(!!e.target.validity?.badInput);
                setDraft(e.target.value);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.stopPropagation(); revert(); }
            }}
            slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { 'data-testid': 'bv-menu-built-at-input', step: 60 },
            }}
        />
    );
}
