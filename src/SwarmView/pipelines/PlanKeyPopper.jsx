// PlanKeyPopper.jsx — the colour help's popup and its two building blocks
// (req #3722, shared with the Pipelines cards' preview by req #4063).
//
// The plan visualizer's colour chips explain themselves in a HOVER popup
// anchored under the chip; the Pipelines page's preview-colour chips are meant to
// behave identically (user, req #4063: "the color help should work like the
// color buttons in the pipeline visualizer"), so the popup shell, the section
// heading and the word-as-swatch entry live HERE, once, and both surfaces draw
// the same pixels. The hover/long-press/Esc behaviour is `useKeyHelp`
// (PipelinePlanToolbar.jsx).

import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

// The requirement channel's swatch: THE WORD IS THE SWATCH (user directive
// 2026-08-01 — "instead just list the statuses and make them their color").
// A dot beside a name spends width on a mark the canvas does not draw for this
// channel; the canvas colours TYPE, so the key colours type. It is also strictly
// more information per pixel — the reader matches the colour AND reads what it
// means in one glyph run — which is what let the key lose two rows without
// losing anything it said.
export function LegendWord({ color, label }) {
    return (
        // `data-testid` so a test can ask for the WORDS and not for every span in
        // the block (req #3422 review W1). `KeyGroup`'s own caption is a
        // `<span>` too, and it is painted `PLAN_VIZ_PALETTE.dim` — which is
        // EXACTLY the unknown swatch — so a "every entry has its own colour"
        // assertion scoped to `span` counts the caption as an entry and collides
        // with `unknown` the first time a plan contains one.
        <Typography variant="caption" data-testid="pipeline-viz-legend-word"
                    sx={{ color, fontFamily: MONO, fontWeight: 700, fontSize: 10.5,
                           lineHeight: 1.35, whiteSpace: 'nowrap' }}>
            {label}
        </Typography>
    );
}

// The key's own section heading — dim, uppercase, and narrow, so a section costs
// the corner ~54px rather than a row of its own.
// ONE SHAPE FOR EVERY SECTION (user directive 2026-08-01: "the key is a
// disaster… beautify"). What made it read as a jumble was that its three
// sections were three different objects: a caption sitting INLINE with its
// entries on two of them, MUI chips in a different type scale on the third, and
// the entries wrapping around the captions at the cap width so nothing lined up.
//
// Now every section is the same two lines — an uppercase caption on its own
// baseline, then its row, left-aligned to a single edge — separated by a
// hairline. Uniformity is the whole treatment: three sections that look alike
// read as one key, and the eye stops re-parsing each row.
export function KeyGroup({ title, children, first = false }) {
    return (
        <Stack direction="column" spacing={0.3} useFlexGap
               sx={{ pt: first ? 0 : 0.6, mt: first ? 0 : 0.15,
                      borderTop: first ? 'none' : `1px solid ${P.line}66` }}>
            <Typography variant="caption"
                        sx={{ color: P.dim, opacity: 0.7, whiteSpace: 'nowrap',
                               fontSize: 9, lineHeight: 1,
                               letterSpacing: '0.11em', fontWeight: 600,
                               textTransform: 'uppercase' }}>
                {title}
            </Typography>
            <Stack direction="row" spacing={1.1} alignItems="center"
                   flexWrap="nowrap" useFlexGap>
                {children}
            </Stack>
        </Stack>
    );
}

/**
 * The popup: a Popper (not a Popover — a Popover is a Modal and aria-hides the
 * whole app, chip included, while open), `pointerEvents: none` so it never takes
 * the pointer from the chip that opened it. Above the page's modals' floor but
 * not a modal itself.
 */
export function KeyPopper({ anchorEl, keyName, pinned = false, testid, children }) {
    return (
        <Popper open anchorEl={anchorEl} placement="bottom-start"
                sx={{ zIndex: 1400, pointerEvents: 'none' }}>
            <Paper
                role="tooltip"
                data-testid={testid}
                data-key={keyName}
                data-pinned={pinned ? 'true' : 'false'}
                sx={{
                    mt: 0.5, px: 1.25, py: 0.9, borderRadius: '10px',
                    background: 'rgba(13, 20, 32, 0.97)',
                    backgroundImage: 'none',
                    border: `1px solid ${P.line}`,
                    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
                    userSelect: 'none', maxWidth: 'calc(100vw - 16px)',
                    '@keyframes pipeKeyPulse': {
                        '0%, 100%': { opacity: 1 },
                        '50%': { opacity: 0.45 },
                    },
                    '@keyframes pipeKeyBreathe': {
                        '0%, 100%': { opacity: 1 },
                        '50%': { opacity: 0.25 },
                    },
                }}>
                {children}
            </Paper>
        </Popper>
    );
}
