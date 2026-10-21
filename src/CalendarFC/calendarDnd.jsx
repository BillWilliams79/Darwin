// calendarDnd.jsx — the phone calendar list's drag surface (req #3664, on the
// dnd-kit foundation req #3662 shipped). Below 900 px the calendar is a
// scrolling list of days; a task or a requirement in it moves to another date
// by being carried onto that day. (The desktop month grid drags through
// FullCalendar's own interactionPlugin and is not on this surface.)
//
// Events have no stored order within a day, so a day never honours a
// position: it highlights as a whole while an event hovers it, and the drop
// is a date move. Dropping an event on its own day is a no-op. Activities are
// shown in the day but do not lift.

import React from 'react';
import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import {
    defineDropPolicy, createDragSession, DarwinSortableList, useDarwinDrag, useDarwinDropZone,
    beginSession, trackPlacement, endSession, listIdOf,
} from '../dnd';

export const calendarIds = {
    day: (date) => `cal-day:${date}`,
    event: (id) => `cal-event:${id}`,
};

/** The date a day's list id names. */
const dateOf = (listId) => listId.slice('cal-day:'.length);

/** A day of the phone list: takes a task or a requirement as a whole. */
// The keyboard: Space lifts a focused event, Up / Down step it day by day,
// Space drops it on the day it is over.
export const CALENDAR_DAY = defineDropPolicy({
    accepts: ['calendar-event'], orientation: 'vertical', keyboardBetweenLists: true,
});

export const useCalendarDragStore = createDragSession();

/** The lifted row, as it looked before the foundation: itself, on the selected tint. */
export const CALENDAR_LIFT_SX = { bgcolor: 'action.selected' };

const noList = () => null;

/**
 * The phone list's drag handlers. `moveEvent(event, date)` writes the date move
 * for a calendar event (`ev`) dropped on another day.
 */
export function calendarDragHandlers(moveEvent) {
    return {
        onDragStart: (event) => beginSession(useCalendarDragStore, event),
        onDragOver: (event) => trackPlacement(useCalendarDragStore, noList, event),
        onDragCancel: () => useCalendarDragStore.getState().end(),
        onDragEnd: ({ over }) => {
            const { active } = endSession(useCalendarDragStore);
            const target = listIdOf(over);
            if (!active || !target || target === active.origin) return;
            moveEvent(active.row, dateOf(target));
        },
    };
}

/**
 * One day of the phone list as a drop zone; `draggableIds` are its lifting
 * events. `disabled` while neither tasks nor requirements are shown.
 */
export function CalendarDayZone({ date, draggableIds, disabled = false, children, ...boxProps }) {
    const id = calendarIds.day(date);
    const { setNodeRef } = useDarwinDropZone({ id, policy: CALENDAR_DAY, row: date, disabled });
    const highlighted = useCalendarDragStore(s => s.highlight === id);
    return (
        <Box ref={setNodeRef} {...boxProps}
             data-testid={`cal-mobile-day-${date}`}
             data-drop-highlight={highlighted ? 'true' : undefined}
             sx={(theme) => ({
                 transition: 'background-color 160ms ease, box-shadow 160ms ease',
                 ...(highlighted && {
                     backgroundColor: alpha(theme.palette.primary.main, 0.08),
                     boxShadow: `inset 0 0 0 2px ${alpha(theme.palette.primary.main, 0.55)}`,
                 }),
             })}>
            <DarwinSortableList id={id} items={draggableIds} policy={CALENDAR_DAY}>
                {children}
            </DarwinSortableList>
        </Box>
    );
}

/**
 * A task or requirement row of the phone list: the whole row is the grip — a
 * tap opens it, a hold lifts it (a quick swipe still scrolls the list). While
 * lifted, the row it left is an empty gap: the day takes no position.
 */
export function CalendarDragRow({ ev, date, sx, children, ...boxProps }) {
    const { ref, style, attributes, listeners, isDragging } = useDarwinDrag({
        id: calendarIds.event(ev.id), type: 'calendar-event',
        containerId: calendarIds.day(date), policy: CALENDAR_DAY, row: ev,
    });
    return (
        <Box ref={ref} {...attributes} {...listeners} style={style} {...boxProps}
             data-testid={`cal-mobile-event-${ev.id}`}
             data-dragging={isDragging ? 'true' : undefined}
             sx={[sx, isDragging && { visibility: 'hidden' }]}>
            {children}
        </Box>
    );
}
