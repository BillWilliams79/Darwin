import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import TOOLBAR_CAPTION_SX from '../Components/toolbarStyles';
import { CLOSED_WINDOWS } from './closedTasks';
import { useClosedTasksStore } from '../stores/useClosedTasksStore';

// req #3506 — the Tasks page's "Closed" title option: how far back closed tasks
// are pulled back into the area cards.
//
// A CAPTIONED GROUP rather than three bare buttons, per `toolbarStyles.js`: with
// no caption the group's name would have to live inside its first option and
// "1h | 24h | All" reads as a control about nothing in particular.
//
// Exclusive, and clicking the selected button turns the option OFF — MUI sends
// `null` for that, which the store takes as its default state. That is what
// makes the three buttons a complete control: there is no fourth "off" button to
// explain, and the page's default (open tasks only) is one click away from any
// window.
const ClosedTasksControl = () => {
    const closedWindow = useClosedTasksStore(s => s.closedWindow);
    const setClosedWindow = useClosedTasksStore(s => s.setClosedWindow);

    return (
        <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, mr: 1 }}
            data-testid="closed-tasks-control"
        >
            <Typography sx={TOOLBAR_CAPTION_SX}>Closed</Typography>
            <Tooltip title="Show tasks closed within this window">
                <ToggleButtonGroup
                    value={closedWindow}
                    exclusive
                    onChange={(event, value) => setClosedWindow(value)}
                    size="small"
                    aria-label="Show closed tasks"
                >
                    {CLOSED_WINDOWS.map(({ value, label }) => (
                        <ToggleButton
                            key={value}
                            value={value}
                            aria-label={`Closed ${label}`}
                            data-testid={`closed-window-${value}`}
                            sx={{ px: 1, py: 0.25, textTransform: 'none' }}
                        >
                            {label}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            </Tooltip>
        </Box>
    );
};

export default ClosedTasksControl;
