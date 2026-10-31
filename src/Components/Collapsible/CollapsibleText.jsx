// Read-only long text, collapsed to a few lines in a list (req #3572).
//
// A list row exists to show its data points — chips, counts, actions — and one
// 25,000-character instruction rendered in full pushes every other row off the
// screen. Collapsed, the text is line-clamped; clicking the clamped text or the
// Show more toggle discloses the whole thing. Expanded text is NOT click-to-
// collapse, so selecting a passage to copy it does not snap it shut.
//
// The toggle sits above the text (see CollapseToggle) and is rendered only when
// the clamped text really hides something (req #4144; it used to be always
// there). The same overflow measure (useOverflow) decides whether clicking the
// clamped text itself expands it — short text has nothing to disclose.

import { useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import CollapseToggle from './CollapseToggle';
import { useOverflow } from './useOverflow';

const CollapsibleText = ({
    text,
    lines = 4,
    variant = 'body2',
    color,
    sx = {},
    testId,
}) => {
    const [expanded, setExpanded] = useState(false);
    const ref = useRef(null);
    const overflowing = useOverflow(ref, !expanded, [text, lines]);
    const collapsed = !expanded && overflowing;

    return (
        <Box>
            {(overflowing || expanded) && (
                <CollapseToggle
                    expanded={expanded}
                    onToggle={() => setExpanded(v => !v)}
                    testId={testId ? `${testId}-toggle` : undefined}
                />
            )}
            <Typography
                ref={ref}
                variant={variant}
                color={color}
                // A drag-select also ends in a click; only a plain click expands.
                onClick={collapsed ? () => {
                    if (window.getSelection?.()?.isCollapsed === false) return;
                    setExpanded(true);
                } : undefined}
                title={collapsed ? 'Click to show all' : undefined}
                sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    ...(!expanded && {
                        display: '-webkit-box',
                        WebkitLineClamp: lines,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }),
                    ...(collapsed && { cursor: 'pointer' }),
                    ...sx,
                }}
                data-testid={testId}
                data-collapsed={collapsed ? 'true' : 'false'}
            >
                {text}
            </Typography>
        </Box>
    );
};

export default CollapsibleText;
