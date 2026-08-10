// The gold mark an ORCHESTRATED requirement's title box wears — req #3419.
//
// THE MARK IS A GOLD BACKGROUND. No outline at rest, no outline on hover; the
// rounded gold field IS the signal. The ONE border it draws is the focus ring,
// in gold at the theme's own focus width — see the `Mui-focused` rule below for
// why that is a requirement rather than a decoration.
//
// This settled after two rounds of toning down and one round of user-facing
// controls, all of which are GONE (user direction, 2026-08-10: "Remove all UI
// options added. Choose to have the gold background and no border whatsoever").
// What that removed, deliberately and in full: a persisted preference store, two
// toggles and a four-rung border-size ladder in the gear menu, and a generic
// `choiceItems` prop on `SettingsMenu` that existed only to host the ladder. One
// appearance, no settings, nothing to keep in sync — which is this requirement's
// own YONO principle applied to its own UI.
//
// A pure function rather than `sx` inlined in the row, because it answers ONE
// question — what does a marked title box look like — and a test can reach it
// without a DOM. Whether a row IS orchestrated is a different question, answered
// once in `hooks/useRequirementVisibility.js` from the same set the visibility
// toggle hides by.

// `#B8860B` (dark goldenrod) at low alpha. A TINT, not a fill: the title is
// editable text, so the gold has to carry over whatever surface the theme
// provides while leaving the theme's own text colour readable on top of it. A
// solid gold would black out in dark mode.
//
// With no resting outline, this value is the whole mark in every state but
// focus — so it is the one dial worth turning if the signal reads too strong or
// too weak.
export const ORCHESTRATED_GOLD = '#B8860B';
export const ORCHESTRATED_GOLD_FILL = 'rgba(184, 134, 11, 0.14)';

// MUI's OutlinedInput thickens its notched outline to 2px on focus. The gold
// focus ring MATCHES that width exactly, so a marked field and a plain one
// focus identically and only the hue differs — the same rule the rest of this
// mark follows.
//
// It is stated here rather than read from the theme because this module is pure
// (no hook, no `useTheme`), which is what lets every case be tested without a
// DOM. If MUI's default ever moves, a marked field would focus at the old width
// while a plain one moved — visible immediately on screen, and the one-line fix
// is here.
export const FOCUS_BORDER_WIDTH = '2px';

/**
 * The `sx` fragment for a requirement title box.
 *
 * @param {object} opts
 * @param {boolean} opts.isOrchestrated  from `useRequirementVisibility`
 * @returns {object} an `sx` object — EMPTY for an unorchestrated row, so it
 *   renders byte-identically to how it did before this feature existed.
 */
export const orchestratedMarkSx = ({ isOrchestrated } = {}) => {
    if (!isOrchestrated) return {};

    // `borderWidth: 0` rather than `border: 'none'`: MUI's notched outline is a
    // fieldset whose border it also animates, and zeroing the width leaves that
    // machinery intact instead of fighting it.
    const noOutline = { borderWidth: 0 };

    return {
        '& .MuiOutlinedInput-root': {
            backgroundColor: ORCHESTRATED_GOLD_FILL,
            // A rounded RECTANGLE — the shape was the original ask, and with no
            // outline the radius is the only thing giving the field its form.
            borderRadius: '8px',
            '& .MuiOutlinedInput-notchedOutline': noOutline,
            '&:hover .MuiOutlinedInput-notchedOutline': noOutline,
            // FOCUS IS THE ONE EXCEPTION, and it is now GOLD rather than the
            // theme's own colour. Leaving it to the theme did not work: the
            // default ring is `primary.main`, and blue drawn on the gold field
            // is overshadowed by it — measured on screen, the field read as
            // having no focus indicator at all. Same WIDTH as an unmarked
            // field's ring, so the two focus identically and only the hue
            // differs.
            //
            // This is the one place the mark draws a border, and it is not a
            // decoration: a text input the reader can click into with no sign
            // of where the caret went is an accessibility defect.
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderWidth: FOCUS_BORDER_WIDTH,
                borderColor: ORCHESTRATED_GOLD,
            },
        },
    };
};
