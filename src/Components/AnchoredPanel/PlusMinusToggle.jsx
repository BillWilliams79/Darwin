// PlusMinusToggle.jsx — the Plan visualizer's −/+ fold button: first drawn by
// the Orchestrables box (req #3648), and the Active box's upper-left control
// (req #3729, user directive: "Active panels upper left control should be the
// same as orchestrables"). One component, so the two stay the same button.
//
// Sized in em off its host's type: 1.25em glyph in a 1.6em square of its own
// type, i.e. 2em of the host's — the head row it sits in is that tall — and
// in the Orchestrables title bar's weight wherever it is drawn.

import Box from '@mui/material/Box';

import { PLAN_VIZ_PALETTE as P } from '../../SwarmView/pipelines/pipelinePlanLayout';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

/**
 * @param {Object} props
 * @param {boolean} props.open        the panel is showing its body
 * @param {function} props.onToggle   the click
 * @param {string} props.label        accessible name (the state is aria-expanded)
 * @param {string} [props.title]      hover tooltip
 * @param {string} [props.testid]
 */
export default function PlusMinusToggle({ open, onToggle, label, title, testid }) {
    return (
        <Box component="button" type="button"
             onClick={onToggle}
             aria-expanded={open}
             aria-label={label}
             title={title}
             data-testid={testid}
             sx={{ width: '1.6em', height: '1.6em', p: 0, display: 'flex', flexShrink: 0,
                    alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none',
                    borderRadius: '0.4em', color: P.text, cursor: 'pointer',
                    fontFamily: MONO, fontSize: '1.25em', fontWeight: 600, lineHeight: 1,
                    '&:hover': { color: P.accent } }}>
            {open ? '−' : '+'}
        </Box>
    );
}
