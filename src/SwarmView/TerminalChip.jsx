// The terminal pill (req #3455). ONE component, four surfaces: the Sessions
// grid, its mobile card, the session detail page, and the requirement editor's
// linked-sessions grid.
//
// It lives in its own file because the interesting behaviour is all about when
// the pill must NOT be clickable — a different machine, an ambiguous host, a
// window number with no durable handle — and four copies of that judgement
// would drift. `terminalFocusState` decides; this only draws.
//
// A non-clickable state still RENDERS. A chip that silently disappears reads as
// "no terminal recorded", which is a different and wrong answer; the tooltip
// carries the reason in every state.

import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

import { TERMINAL_STATE, TERMINAL_VISIBLE } from './terminalFocus';

const TerminalChip = ({ terminal, testId, size = 'small' }) => {
    // An ELEMENT, not a bare string: inside the mobile card's <Stack> a text
    // node does not match the `& > :not(style) ~ :not(style)` spacing selector,
    // so a bare '—' sat flush against the neighbouring pill.
    if (!terminal || !TERMINAL_VISIBLE(terminal.state)) {
        return <Box component="span">—</Box>;
    }

    const clickable = terminal.state === TERMINAL_STATE.LINK;

    return (
        <Tooltip title={terminal.title || ''}>
            {/* span wrapper: MUI Tooltip needs a child that fires pointer
                events, and a non-clickable Chip does not. */}
            <span>
                <Chip
                    label={terminal.label}
                    size={size}
                    variant="outlined"
                    color={clickable ? 'primary' : 'default'}
                    {...(clickable
                        ? {
                            component: 'a',
                            href: terminal.href,
                            clickable: true,
                            // Grid rows navigate to the session on click; without
                            // this, focusing a terminal also changes the page.
                            onClick: (e) => e.stopPropagation(),
                          }
                        : {})}
                    data-testid={testId}
                    data-terminal-state={terminal.state}
                />
            </span>
        </Tooltip>
    );
};

export default TerminalChip;
