// Model and Effort as ONE pill in two halves.
//
// They were two independent chips. They are two independent FACTS — a session
// picks a model and an effort separately — but they are always read together
// ("Opus at high"), so two free-floating chips made the reader do the pairing
// on every row.
//
// So: one pill, two halves. Each half keeps its OWN colour from its OWN
// existing palette (modelChipStyles / effortChipStyles, the shared red→green
// capability ramp), because that is what lets each value keep its voice; the
// single pill outline and the seam between the halves are what make the
// relationship real. Deliberately NOT a blended single colour — that would
// invent a third meaning neither axis has.
//
// NOT the same thing as ModelEffortIcon.jsx, which renders ONE value as a
// glyph for the dense requirement rows. This is the two-value pill for the
// wider session/complete tables, where there is room for the words.

import React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

import { AI_MODEL_COLOR, aiModelLabel } from './modelChipStyles';
import { EFFORT_COLOR, effortLabel, effortPulses } from './effortChipStyles';

// The top effort rung shares xhigh's dark green and is told apart by MOTION.
//
// A slow BREATHE, not a blink: the pill sits in a column of rows, and anything
// fast enough to read as "flashing" turns a data table into a distraction and
// starts to matter for photosensitivity. 1.6s, and the trough is a brightness
// lift rather than a fade to transparent so the black label never drops below
// its contrast floor at any point in the cycle.
//
// Under `prefers-reduced-motion` the animation is dropped entirely. Nothing is
// lost: the half still reads "Ultracode".
const PULSE_KEYFRAMES = {
    '@keyframes darwinEffortPulse': {
        '0%, 100%': { filter: 'brightness(1)' },
        '50%':      { filter: 'brightness(1.55)' },
    },
};

// Matched to a MUI `<Chip size="small">` — the Status pill — because that one
// reads easily and this one did not. The difference was never the two halves:
// it was 11px semibold text crammed into a 20px box with a hairline border,
// which reads as dense and busy beside a 24px chip with 13px regular text.
// Same height, same radius, same font size and weight, no outer border.
const CHIP_HEIGHT = 24;
const CHIP_RADIUS = '12px';     // height / 2 — a true pill, as Chip computes it

const HALF = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Sized off the LONGEST label in each palette ("Sonnet", "Ultracode") so the
    // divider lands in the same place on every row — a pill whose seam wanders
    // reads as noise in a column of them.
    px: 1,
    height: CHIP_HEIGHT,
    fontSize: '0.8125rem',      // Chip small
    fontWeight: 400,            // Chip small — was 600, which is what made it shout
    lineHeight: 1,
    color: '#000',          // every rung of both ramps is chosen to clear contrast on black text
    whiteSpace: 'nowrap',
};

const ModelEffortPill = ({ model, effort, testId }) => {
    const modelText = aiModelLabel(model);
    const effortText = effortLabel(effort);

    return (
        <Tooltip title={`Model: ${modelText} · Effort: ${effortText}`}
                 enterDelay={400} enterNextDelay={200}>
            <Box
                data-testid={testId}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'stretch',
                    height: CHIP_HEIGHT,
                    borderRadius: CHIP_RADIUS,
                    overflow: 'hidden',       // clips both halves to the pill's radius
                    // NO outer border: a filled Chip has none, and the ring was
                    // a third edge competing with the two fills and the seam.
                    lineHeight: 0,
                    verticalAlign: 'middle',
                }}
            >
                <Box sx={{ ...HALF, bgcolor: AI_MODEL_COLOR[model] || 'grey.400', minWidth: 52 }}
                     data-testid={testId ? `${testId}-model` : undefined}>
                    {modelText}
                </Box>
                {/* The seam. A hairline rather than a gap: a gap would read as
                    two pills again, which is the thing being fixed. */}
                <Box sx={{ width: '1px', bgcolor: 'rgba(0,0,0,0.35)' }} />
                <Box sx={{
                         ...HALF,
                         bgcolor: EFFORT_COLOR[effort] || 'grey.400',
                         minWidth: 64,
                         ...(effortPulses(effort) ? {
                             ...PULSE_KEYFRAMES,
                             animation: 'darwinEffortPulse 1.6s ease-in-out infinite',
                             '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                         } : {}),
                     }}
                     data-effort={effort}
                     data-pulsing={effortPulses(effort) ? 'true' : undefined}
                     data-testid={testId ? `${testId}-effort` : undefined}>
                    {effortText}
                </Box>
            </Box>
        </Tooltip>
    );
};

export default ModelEffortPill;
