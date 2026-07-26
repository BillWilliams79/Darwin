// Shared edit-in-place text field (req #3063).
//
// Renders as PLAIN TEXT until touched: no label, no box, no Save button. Hover
// reveals a hairline underline, focus turns it primary, blur commits. This is the
// same design language as the map cards (RouteCard) and the Maps table
// (MapRuns/GhostCellEditors), which hand-rolled it per field against the shared
// `ghostBase` sx.
//
// Req #3073 migrated both of those onto this component, so the list below is now
// a record of what the migration FIXED in the Maps views rather than of how they
// still differ.
//
// What this component adds over those two, and the reason it exists rather than
// a third copy:
//
//   * VALIDATION WITH A VERDICT. The Maps editors skip the save when a value
//     fails to parse (`if (!isNaN(v))`) and leave no trace, so a bad value looks
//     saved until the next refetch silently reverts it. Here an invalid value
//     stays on screen, in red, with the reason under it, and no write is issued.
//   * REQUIRED FIELDS. Emptying a NOT NULL column reverts to the stored value
//     instead of writing an empty string — the behaviour AgentDetail's overview
//     field already had, generalized.
//   * FAILED-WRITE ROLLBACK. `onCommit` is awaited; a rejection reverts the text
//     so the field never displays a value the database does not hold.
//   * NO CLOBBERING MID-EDIT. An external refetch re-seeds the field only when
//     it is neither focused NOR dirty. The Maps editors re-seed on any value
//     change, which is harmless for their own round-trip but overwrites work in
//     progress when a genuinely external change lands. That matters far more here
//     than there: the instruction card writes a SIBLING entity (the agent
//     junction) on every chip click, and each of those invalidates the row query
//     — so a refetch landing while another field sits dirty is routine, not
//     exotic. Without the dirty half of the guard, binding an agent would silently
//     discard the invalid-and-still-being-fixed text in the field above it.
//
// The commit contract: `onCommit(next)` is called ONLY when the value actually
// changed AND passed validation. Callers own the PUT and the cache invalidation;
// they must let a failure reject so the rollback above can happen.

import { useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ghostBase } from '../../utils/ghostFieldStyles';

const GhostTextField = ({
    value,
    onCommit,
    // Supply to run CONTROLLED (draft) mode — see the two-modes note below.
    onChangeText,
    // (text) => the value to validate, display and store. Applied at commit time,
    // e.g. trimming a name so the stored value cannot carry invisible padding.
    normalize,
    // (text) => error string | null. Blocks the write and shows the string.
    validate,
    // (text) => hint string | null. Advisory only — never blocks a write.
    hint,
    // NOT NULL column: an emptied field reverts rather than writing ''.
    required = false,
    // Passed straight to the underlying input. `datetime-local` is the one that
    // matters: the Maps start_time fields need a native date/time picker AND the
    // commit contract, and there is nothing about the contract that is specific to
    // free text — validate/normalize just operate on the picker's string form.
    //
    // Undefined by default rather than 'text', and suppressed on a multiline field:
    // `type` is not a valid attribute on a <textarea>, so defaulting it would put a
    // React DOM warning and a stray attribute on every multiline field in the app.
    type,
    multiline = false,
    // Enter commits instead of inserting a newline. Defaults to "whenever this is
    // not a multiline field", but the two are separable: a NAME is single-line
    // semantically while still needing to WRAP rather than scroll out of sight.
    commitOnEnter = !multiline,
    minRows,
    maxRows,
    placeholder,
    disabled = false,
    // Lay the field out as part of the surrounding line rather than as a block of
    // its own. RouteCard's stats table renders the value and its unit as one run of
    // text — `12.5` + ` mi` — and the default block wrapper would drop the unit onto
    // the next line. The verdict/hint caption still stacks underneath.
    //
    // Specifically inline-FLEX-column, not inline-block. An inline-block takes its
    // baseline from its LAST line box, so the instant a verdict appeared under the
    // value the trailing ` mi` would jump up beside the caption — the same
    // line-breaking bug this prop exists to prevent, merely deferred to the first
    // invalid keystroke. A flex container baselines on its FIRST item, so the input
    // sits on the row's baseline whether or not a message is showing.
    //
    // Meaningless on a multiline field, which is a block of text by definition.
    inline = false,
    // Take the verdict/hint caption OUT of flow and hang it below the field.
    // For the Maps DataGrid: rows are `getRowHeight: 'auto'` inside an `autoHeight`
    // grid, and validation runs per keystroke, so an in-flow caption re-measures the
    // row and shifts every row under it on and off with each character typed.
    overlayMessage = false,
    // Merged into the input sx so the idle field inherits the typography of
    // whatever it replaced and looks unchanged until hovered.
    //
    // A PLAIN OBJECT, not the theme callback or array that MUI's own `sx` also
    // accepts: the ghost branch spreads this and reads its nested
    // '& .MuiInputBase-input' key by hand, so a function would spread to nothing and
    // the caller's styling would vanish with no error. Resolve the theme in the
    // caller if you need it.
    sx = {},
    inputProps = {},
    inputRef,
    testId,
    // Fires on focus/blur so a card can surface a pre-commit warning (e.g. the
    // blast radius of the edit) for exactly as long as the field is being edited.
    onEditingChange,
    // Fires whenever the verdict changes. A blocked value has no Save button to
    // leave disabled, so the CARD has to be able to say "this is not saved".
    onErrorChange,
    // Suppress the inline error/hint caption THIS COMPONENT renders — display only.
    //
    // For a DataGrid cell (req #3067), where the row height is fixed and a caption
    // would either overflow the row or steal a line from the value. Nothing about
    // WHEN it writes changes, the field still turns red, and `onErrorChange` still
    // fires — which is the point: the verdict is not suppressed, it is HOISTED. The
    // table surfaces it as a row-level marker plus a tooltip, because the V-rule
    // that a blocked value must be visible without hovering holds in every view;
    // only the place the message can fit differs.
    hideMessage = false,
    // Render as a conventional bordered field with a notched label instead of as
    // plain text. Everything about WHEN it writes is unchanged.
    outlined = false,
    label,
    fullWidth = false,
    // Size the input to its own live text, floored at this many characters.
    // Without it a single-line ghost field claims a fixed box and shoves the rest
    // of the header row out of the way.
    autoWidthCh,
    // ...and CAPPED here, because the inline width it sets is explicit: a
    // 90-character instruction name would otherwise claim 91ch inside the header
    // flex row, which `minWidth: 0` on the wrapper cannot shrink, and the header
    // would overflow the card.
    maxWidthCh = 48,
}) => {
    const stored = value ?? '';

    // TWO MODES.
    //
    // Uncontrolled (the default, for a field backed by a stored column): the
    // component owns the text between focus and blur, and blur decides whether
    // to write.
    //
    // Controlled (`onChangeText` supplied, for a DRAFT field whose value lives in
    // the parent — the template row): every keystroke goes straight to the parent
    // and `value` is rendered directly. There is no local copy, so there is
    // nothing that can go stale: when the parent clears the draft after a
    // successful create, the field empties immediately even while it holds focus.
    // Getting that wrong is how a "blank" template row silently inherits the
    // previous row's binding text.
    const controlled = typeof onChangeText === 'function';

    const [localText, setLocalText] = useState(stored);
    const text = controlled ? stored : localText;
    const applyText = (next) => {
        if (controlled) onChangeText(next); else setLocalText(next);
    };

    const [error, setError] = useState(null);
    const focused = useRef(false);

    // Dirtiness is measured against the value this field was LAST SEEDED WITH,
    // never against the incoming `stored` prop. Comparing to `stored` looks
    // equivalent and is not: the moment an external change arrives, `text` and
    // `stored` differ for that reason alone, the field would call itself dirty,
    // and the re-seed it is guarding would never happen again.
    const lastSeeded = useRef(stored);

    // The `stored` value a commit was issued against, held until the prop moves off
    // it — see the re-seed effect below. Null when no write is outstanding; `stored`
    // is always a string, so null is an unambiguous sentinel.
    const staleStored = useRef(null);

    useEffect(() => {
        if (controlled) return;                    // no local copy to re-seed
        if (focused.current) return;
        // OUR OWN WRITE HAS NOT COME BACK YET. `stored` is still the value from
        // before the commit, and it stays that way until the caller's invalidation
        // round-trips. Meanwhile the field has already adopted the committed text,
        // so by the dirty test below it looks clean — and the re-seed would paint
        // the pre-edit value back over the user's own successful edit.
        //
        // That is not a flicker: it lasts a whole network round trip, it reads as
        // "the save failed", and the retry it invites writes the same value a second
        // time. It only bites when `normalize` rewrites the text — typing `20` into
        // a one-decimal column, `45:00` into a duration — which is why it stayed
        // latent until the Maps migration gave every numeric field a normalizer.
        //
        // The latch is released by the PROP MOVING, not by the promise settling: the
        // write resolves a microtask before React commits the render this guard has
        // to survive, so anything cleared in a `finally` would already be gone.
        if (staleStored.current !== null && stored === staleStored.current) return;
        staleStored.current = null;
        if (text !== lastSeeded.current) return;   // dirty — keep the user's work
        lastSeeded.current = stored;
        setLocalText(stored);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stored, text]);

    // Reported from an effect rather than from the setError call sites so the
    // parent hears about every transition exactly once, including the clears.
    useEffect(() => {
        onErrorChange?.(error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error]);

    // Retract the verdict on unmount. Parents key their "unsaved" state by field,
    // and a field that disappears while blocked (row filtered out, list refetched)
    // would otherwise leave a permanent error behind for a row that no longer
    // renders — and it would reappear as a phantom the next time it did. Read
    // through a ref so the cleanup calls the CURRENT callback and the effect can
    // still run exactly once.
    const errorCallback = useRef(onErrorChange);
    useEffect(() => { errorCallback.current = onErrorChange; });
    useEffect(() => () => errorCallback.current?.(null), []);

    /**
     * The real <input>/<textarea>, for programmatic blur.
     *
     * NEVER use `e.currentTarget` for that. MUI's TextField routes `onBlur`,
     * `onChange` and `onFocus` to the input but lets `onKeyDown` fall through to the
     * root FormControl DIV — so in outlined mode `e.currentTarget.blur()` was a
     * silent no-op on a div. The handler still FIRED (events bubble up from the
     * input), which is what made this so quiet: Escape looked like it worked because
     * `revert()` repainted the stored text, while the field kept focus and the
     * abandon latch stayed armed — then swallowed the user's NEXT real edit with no
     * error, no `unsaved` chip and no write. InputBase (ghost mode) does route
     * onKeyDown to the input, which is why only the outlined fields bled.
     */
    const inputEl = useRef(null);
    const attachInput = (el) => {
        inputEl.current = el;
        if (typeof inputRef === 'function') inputRef(el);
        else if (inputRef) inputRef.current = el;
    };

    const setEditing = (next) => {
        focused.current = next;
        // Clear the Escape latch on focus as well as in `commit`. It is set
        // immediately before a programmatic blur, so if that blur ever failed to
        // reach `commit` the flag would swallow the NEXT real commit on this field.
        if (next) abandoning.current = false;
        onEditingChange?.(next);
    };

    // Set for the duration of one Escape keystroke — see `commit`.
    const abandoning = useRef(false);

    const revert = () => {
        lastSeeded.current = stored;
        // Whatever write was outstanding is over — a rejection, or an abandoned
        // edit. The field is back on the stored value, so the stale-prop latch has
        // nothing left to protect.
        staleStored.current = null;
        applyText(stored);
        setError(null);
    };

    const handleChange = (e) => {
        const next = e.target.value;
        applyText(next);
        // Live, so the message clears as the user fixes the value rather than
        // waiting for another blur to re-test it.
        setError(validate ? validate(next) : null);
    };

    const commit = async () => {
        setEditing(false);

        // Escape reverts and then blurs, and that blur lands HERE — synchronously,
        // before React has re-rendered, so `text` in this closure is still the
        // abandoned value. Without this flag, Escape would commit the very edit it
        // was pressed to throw away.
        if (abandoning.current) { abandoning.current = false; return; }

        // DID THE USER ACTUALLY CHANGE ANYTHING? Measured against the last-seeded
        // value, NEVER against `stored`.
        //
        // `text !== stored` looks like the same question and is not. The re-seed
        // effect above deliberately refuses to update a FOCUSED field, so an
        // external write landing while the user merely has the caret parked in a
        // field they are reading leaves the two unequal with nothing typed. Writing
        // on that basis silently reverts the newer value — no error, no warning,
        // the user's only action having been to click in and back out.
        const untouched = text === lastSeeded.current;
        if (!controlled && untouched) {
            // Nothing typed. If the server moved while we held focus, adopt that
            // value now — this is the re-seed the effect had to skip.
            //
            // `stored !== staleStored.current` is the same guard the effect applies:
            // a write of ours may still be outstanding, in which case `stored` is
            // the value from BEFORE it and adopting it would undo the edit. Clicking
            // into a field and straight back out is exactly how a user checks that
            // an edit took, so this path is anything but hypothetical.
            if (text !== stored && stored !== staleStored.current) revert();
            return;
        }

        if (required && !text.trim()) { revert(); return; }

        const next = normalize ? normalize(text) : text;

        const err = validate ? validate(next) : null;
        if (err) { setError(err); return; }        // keep the dirty text visible
        setError(null);

        // Show what will actually be stored, rather than letting a normalized
        // write and an un-normalized display disagree until the next refetch.
        if (next !== text) applyText(next);

        // A draft field (controlled) commits on EVERY blur: its "commit" is a
        // parent-level create, not a column write, so the parent — not this
        // component — decides whether there is anything to do. That is also what
        // makes a failed create retryable by simply clicking back into the field.
        if (!controlled && next === stored) {
            // Somebody else already stored exactly this. Nothing to write, but the
            // baseline MUST move: leaving it behind marks the field permanently
            // dirty and it would never accept a server update again.
            lastSeeded.current = next;
            return;
        }

        try {
            // Adopt the committed value as the new baseline BEFORE awaiting: the
            // invalidation that follows a successful write brings `stored` up to
            // this same text, and the re-seed effect has to recognise that as
            // clean rather than as an external change arriving over a dirty field.
            lastSeeded.current = next;
            // Until the prop catches up with this write, THIS FIELD — not the stale
            // `stored` it was issued against — is the authority on its own value.
            //
            // Uncontrolled only, and stated rather than left to fall out: a draft
            // field has no local copy to protect, so both readers of this ref (the
            // re-seed effect and the `untouched` branch above) are behind
            // `!controlled` already. Setting it there would be inert state that
            // reads as meaningful.
            if (!controlled) staleStored.current = stored;
            await onCommit(next);
        } catch {
            // The caller reports the failure; this only makes sure the field
            // stops showing a value the database rejected.
            revert();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            abandoning.current = true;
            revert();
            inputEl.current?.blur();
            return;
        }
        // Enter commits, unless this is a field whose newlines are real content —
        // instruction body text is prose and needs them.
        if (e.key === 'Enter' && commitOnEnter) {
            e.preventDefault();
            inputEl.current?.blur();
            return;
        }
        // Belt and braces for the latch: any other keystroke means the user is still
        // editing, so an Escape whose blur somehow never reached `commit` cannot go
        // on to eat this edit.
        abandoning.current = false;
    };

    const advisory = error ? null : (hint ? hint(text) : null);

    // OUTLINED mode: a conventional bordered field with its name notched into the
    // top-left of the border. Same commit contract as the ghost mode above — still
    // inline on the card, still saves on blur, still no dialog and no Save button.
    // The two modes differ only in whether the field advertises itself as editable
    // before you touch it.
    if (outlined) {
        return (
            <TextField
                value={text}
                onChange={handleChange}
                onFocus={() => setEditing(true)}
                onBlur={commit}
                onKeyDown={handleKeyDown}
                label={label}
                variant="outlined"
                size="small"
                type={multiline ? undefined : type}
                multiline={multiline}
                minRows={minRows}
                maxRows={maxRows}
                placeholder={placeholder}
                disabled={disabled}
                inputRef={attachInput}
                fullWidth={fullWidth}
                error={!!error}
                // The message the ghost mode renders itself belongs in the
                // field's own helper slot here, where MUI already reserves and
                // colours it.
                helperText={hideMessage ? undefined : (error || advisory || undefined)}
                inputProps={{ ...inputProps, 'data-testid': testId }}
                sx={sx}
            />
        );
    }

    return (
        <Box sx={{
            minWidth: 0,
            ...(inline && !multiline && {
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                verticalAlign: 'baseline',
            }),
            ...(overlayMessage && { position: 'relative' }),
        }}>
            <InputBase
                value={text}
                onChange={handleChange}
                onFocus={() => setEditing(true)}
                onBlur={commit}
                onKeyDown={handleKeyDown}
                type={multiline ? undefined : type}
                multiline={multiline}
                minRows={minRows}
                maxRows={maxRows}
                placeholder={placeholder}
                disabled={disabled}
                inputRef={attachInput}
                inputProps={{
                    ...inputProps,
                    ...(autoWidthCh && {
                        style: {
                            ...(inputProps.style || {}),
                            // +1 so the caret has somewhere to sit at the end.
                            width: `${Math.min(
                                Math.max(text.length + 1, autoWidthCh),
                                maxWidthCh)}ch`,
                            maxWidth: '100%',
                        },
                    }),
                    'data-testid': testId,
                }}
                sx={(theme) => {
                    const base = ghostBase(theme);
                    return {
                        ...base,
                        // A content-sized multiline field (autoWidthCh) must NOT be
                        // stretched to full width — it wraps inside the width its own
                        // text asks for.
                        ...(multiline && {
                            display: 'flex',
                            ...(autoWidthCh ? {} : { width: '100%' }),
                        }),
                        ...sx,
                        '& .MuiInputBase-input': {
                            ...base['& .MuiInputBase-input'],
                            ...(sx['& .MuiInputBase-input'] || {}),
                            ...(error && { color: theme.palette.error.main }),
                            // Only the ERROR case differs from the shared base, so
                            // only that is restated: a blocked field underlines in
                            // red rather than primary while it holds focus.
                            ...(error && {
                                '&:focus': {
                                    outline: 'none',
                                    borderBottomColor: theme.palette.error.main,
                                },
                            }),
                            '&::placeholder': { color: theme.palette.text.disabled, opacity: 1 },
                        },
                    };
                }}
            />
            {!hideMessage && (error || advisory) && (
                <Typography
                    variant="caption"
                    color={error ? 'error' : 'text.secondary'}
                    sx={{
                        display: 'block',
                        mt: 0.25,
                        ...(overlayMessage && {
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 2,
                            mt: 0,
                            whiteSpace: 'nowrap',
                            // It is floating over whatever is beneath it, so it needs
                            // its own surface to stay legible.
                            px: 0.5,
                            borderRadius: 0.5,
                            bgcolor: 'background.paper',
                            boxShadow: 1,
                        }),
                    }}
                    data-testid={testId ? `${testId}-message` : undefined}
                >
                    {error || advisory}
                </Typography>
            )}
        </Box>
    );
};

export default GhostTextField;
