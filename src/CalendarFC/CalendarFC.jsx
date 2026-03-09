import React, { useState, useCallback, useContext, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import './CalendarFC.css';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useCalendarViewStore } from '../stores/useCalendarViewStore';
import { toLocaleDateString } from '../utils/dateFormat';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { TaskActionsContext } from '../hooks/useTaskActions';
import { useTasksDone, usePrioritiesDone } from '../hooks/useDataQueries';
import { taskKeys } from '../hooks/useQueryKeys';
import TaskEditDialog from '../Components/TaskEditDialog/TaskEditDialog';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import useMediaQuery from '@mui/material/useMediaQuery';

// Module-level: session scroll memory for mobile (survives remount, cleared on page reload)
let mobileScrollDate = null;

// Helper: date string 'YYYY-MM-DD' offset by N months from today
const monthOffset = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return d;
};

const CalendarFC = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const calendarRef = useRef(null);
    const isMobile = useMediaQuery('(max-width:899px)');
    const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

    // ── Desktop persisted state ──────────────────────────────────────────────
    const savedViewType = useCalendarViewStore(s => s.viewType);
    const savedDate = useCalendarViewStore(s => s.currentDate);
    const savedMode = useCalendarViewStore(s => s.mode);
    const setCalendarView = useCalendarViewStore(s => s.setCalendarView);
    const setPersistedMode = useCalendarViewStore(s => s.setMode);

    const [calendarTitle, setCalendarTitle] = useState('');

    // ── Shared state ─────────────────────────────────────────────────────────
    const [mode, setMode] = useState(savedMode || 'tasks');
    const isTasksMode = mode === 'tasks';

    // ── Desktop date range (FullCalendar datesSet → query) ───────────────────
    const [dateRange, setDateRange] = useState({ start: null, end: null });
    const startStr = dateRange.start ? dateRange.start.toISOString().slice(0, 19) : null;
    const endStr   = dateRange.end   ? dateRange.end.toISOString().slice(0, 19)   : null;

    // ── Mobile fetch range (IntersectionObserver driven) ─────────────────────
    const [mobileFetchStart, setMobileFetchStart] = useState(() => monthOffset(-3));
    const [mobileFetchEnd,   setMobileFetchEnd]   = useState(() => monthOffset(2));
    const mobileStartStr = mobileFetchStart.toISOString().slice(0, 19);
    const mobileEndStr   = mobileFetchEnd.toISOString().slice(0, 19);

    // ── Queries: mobile uses its own range, desktop uses FC range ─────────────
    const { data: serverTasks }      = useTasksDone(profile?.userName,
        isMobile ? mobileStartStr : startStr,
        isMobile ? mobileEndStr   : endStr,
        { enabled: isTasksMode });
    const { data: serverPriorities } = usePrioritiesDone(profile?.userName,
        isMobile ? mobileStartStr : startStr,
        isMobile ? mobileEndStr   : endStr,
        { enabled: !isTasksMode });

    // ── Task local state (for edit dialog + drag-drop) ───────────────────────
    const [localTasksArray, setLocalTasksArray] = useState([]);
    React.useEffect(() => {
        if (serverTasks) setLocalTasksArray(serverTasks);
    }, [serverTasks]);

    // ── Dialog state ──────────────────────────────────────────────────────────
    const [taskEditDialogOpen, setTaskEditDialogOpen] = useState(false);
    const [taskEditInfo, setTaskEditInfo] = useState({});

    const taskDelete = useConfirmDialog({
        onConfirm: ({ taskId }) => {
            call_rest_api(`${darwinUri}/tasks`, 'DELETE', { id: taskId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        setLocalTasksArray(prev => prev.filter(t => t.id !== taskId));
                        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete task');
                    }
                }).catch(error => showError(error, 'Unable to delete task'));
        },
        additionalCleanup: () => { setTaskEditDialogOpen(false); setTaskEditInfo({}); }
    });

    // ── Events (shared FullCalendar format, reused for mobile grouping) ───────
    const taskEventColor     = 'WhiteSmoke';
    const priorityEventColor = '#E3F2FD';

    const events = useMemo(() => {
        if (isTasksMode) {
            return localTasksArray.map(task => ({
                id: String(task.id),
                title: task.description,
                start: task.done_ts ? toLocaleDateString(task.done_ts, profile?.timezone) : null,
                allDay: true,
                backgroundColor: taskEventColor,
                borderColor: taskEventColor,
                textColor: '#333',
            }));
        }
        return (serverPriorities || []).map(priority => ({
            id: String(priority.id),
            title: priority.title,
            start: priority.completed_at ? toLocaleDateString(priority.completed_at, profile?.timezone) : null,
            allDay: true,
            backgroundColor: priorityEventColor,
            borderColor: priorityEventColor,
            textColor: '#333',
            classNames: ['fc-priority-event'],
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTasksMode, localTasksArray, serverPriorities, profile?.timezone]);

    // ── Mobile: group events by date for custom list ──────────────────────────
    const mobileEventsByDate = useMemo(() => {
        if (!isMobile) return {};
        const map = {};
        for (const ev of events) {
            if (!ev.start) continue;
            if (!map[ev.start]) map[ev.start] = [];
            map[ev.start].push(ev);
        }
        return map;
    }, [isMobile, events]);

    const mobileSortedDates = useMemo(() =>
        Object.keys(mobileEventsByDate).sort(),
    [mobileEventsByDate]);

    // ── Mobile refs ───────────────────────────────────────────────────────────
    const mobileScrollContainerRef = useRef(null);
    const topSentinelRef      = useRef(null);
    const bottomSentinelRef   = useRef(null);
    const mobileScrolledRef   = useRef(false); // initial scroll done?
    const prevScrollHeightRef = useRef(0);     // saved before top-prepend to restore position

    // Reset initial-scroll flag when switching mobile↔desktop
    React.useEffect(() => { mobileScrolledRef.current = false; }, [isMobile]);

    // Scroll to a date in the mobile list (nearest with events if exact missing)
    const scrollToDate = useCallback((targetDate, behavior = 'instant') => {
        const container = mobileScrollContainerRef.current;
        if (!container) return;
        let el = container.querySelector(`[data-date="${targetDate}"]`);
        if (!el && mobileSortedDates.length > 0) {
            const target = new Date(targetDate).getTime();
            let closest = null, closestDiff = Infinity;
            for (const d of mobileSortedDates) {
                const diff = Math.abs(new Date(d).getTime() - target);
                if (diff < closestDiff) { closestDiff = diff; closest = d; }
            }
            if (closest) el = container.querySelector(`[data-date="${closest}"]`);
        }
        el?.scrollIntoView({ behavior, block: 'start' });
    }, [mobileSortedDates]);

    // After top-prepend: restore scroll position by adding the height of newly added content
    React.useEffect(() => {
        if (!isMobile || prevScrollHeightRef.current === 0) return;
        const container = mobileScrollContainerRef.current;
        if (!container) return;
        const diff = container.scrollHeight - prevScrollHeightRef.current;
        if (diff > 0) container.scrollTop += diff;
        prevScrollHeightRef.current = 0;
    }, [isMobile, mobileSortedDates]);

    // Initial scroll: runs once after first data arrives on mobile
    React.useEffect(() => {
        if (!isMobile || mobileScrolledRef.current || mobileSortedDates.length === 0) return;
        scrollToDate(mobileScrollDate || todayStr);
        mobileScrolledRef.current = true;
    }, [isMobile, mobileSortedDates, todayStr, scrollToDate]);

    // Scroll tracking: update module-level var as user scrolls
    React.useEffect(() => {
        if (!isMobile) return;
        const container = mobileScrollContainerRef.current;
        if (!container) return;
        const track = () => {
            const els = container.querySelectorAll('[data-date]');
            for (const el of els) {
                if (el.getBoundingClientRect().bottom > 0) {
                    mobileScrollDate = el.getAttribute('data-date');
                    break;
                }
            }
        };
        container.addEventListener('scroll', track, { passive: true });
        return () => container.removeEventListener('scroll', track);
    }, [isMobile]);

    // IntersectionObserver: expand fetch range when user scrolls near top/bottom
    React.useEffect(() => {
        if (!isMobile) return;
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                if (entry.target === topSentinelRef.current) {
                    // Save scrollHeight BEFORE state update so we can restore position after prepend
                    const container = mobileScrollContainerRef.current;
                    if (container) prevScrollHeightRef.current = container.scrollHeight;
                    setMobileFetchStart(prev => {
                        const d = new Date(prev);
                        d.setMonth(d.getMonth() - 3);
                        return d;
                    });
                } else if (entry.target === bottomSentinelRef.current) {
                    setMobileFetchEnd(prev => {
                        const d = new Date(prev);
                        d.setMonth(d.getMonth() + 3);
                        return d;
                    });
                }
            }
        }, { rootMargin: '100px' });

        if (topSentinelRef.current)    observer.observe(topSentinelRef.current);
        if (bottomSentinelRef.current) observer.observe(bottomSentinelRef.current);
        return () => observer.disconnect();
    }, [isMobile]);

    // ── Desktop FullCalendar handlers ─────────────────────────────────────────
    const titleSuffix = isTasksMode ? 'Completed Tasks' : 'Completed Priorities';
    const buildTitle = useCallback((d, suffix) => {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(-2)} ${suffix}`;
    }, []);

    const handleDatesSet = useCallback((dateInfo) => {
        setDateRange({ start: dateInfo.start, end: dateInfo.end });
        setCalendarTitle(buildTitle(dateInfo.view.currentStart, titleSuffix));
        setCalendarView({
            viewType: dateInfo.view.type,
            currentDate: dateInfo.view.currentStart.toISOString().slice(0, 10),
        });
    }, [buildTitle, titleSuffix, setCalendarView]);

    React.useEffect(() => {
        const api = calendarRef.current?.getApi();
        if (api) setCalendarTitle(buildTitle(api.view.currentStart, titleSuffix));
    }, [titleSuffix, buildTitle]);

    const handleEventDrop = useCallback((info) => {
        const taskId = info.event.id;
        const newDate = info.event.start;
        newDate.setHours(12, 0, 0, 0);
        const newDoneTs = newDate.toISOString().slice(0, 19);
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, done_ts: newDoneTs }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setLocalTasksArray(prev => prev.map(t =>
                        String(t.id) === taskId ? { ...t, done_ts: newDoneTs } : t
                    ));
                } else { info.revert(); showError(result, 'Unable to move task'); }
            }).catch(error => { info.revert(); showError(error, 'Unable to move task'); });
    }, [darwinUri, idToken, showError]);

    const handleEventClick = useCallback((info) => {
        const taskId = info.event.id;
        const taskIndex = localTasksArray.findIndex(t => String(t.id) === taskId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: localTasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [localTasksArray]);

    const handlePriorityClick = useCallback((info) => {
        navigate(`/swarm/priority/${info.event.id}`);
    }, [navigate]);

    // Mobile-specific click handlers (no FC info wrapper)
    const handleMobileTaskClick = useCallback((eventId) => {
        const taskIndex = localTasksArray.findIndex(t => String(t.id) === eventId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: localTasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [localTasksArray]);

    const handleMobilePriorityClick = useCallback((eventId) => {
        navigate(`/swarm/priority/${eventId}`);
    }, [navigate]);

    // ── TaskActionsContext callbacks ───────────────────────────────────────────
    const priorityClick = (taskIndex, taskId) => {
        const updated = [...localTasksArray];
        updated[taskIndex].priority = updated[taskIndex].priority ? 0 : 1;
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, priority: updated[taskIndex].priority }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) setLocalTasksArray(updated);
                else if (result.httpStatus.httpStatus > 204) showError(result, "Unable to change task's priority");
            }).catch(error => showError(error, "Unable to change task's priority"));
    };

    const doneClick = (taskIndex, taskId) => {
        const updated = [...localTasksArray];
        updated[taskIndex].done = updated[taskIndex].done ? 0 : 1;
        setLocalTasksArray(updated);
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{
            id: taskId, done: updated[taskIndex].done,
            ...(updated[taskIndex].done === 1 ? { done_ts: new Date().toISOString() } : { done_ts: 'NULL' })
        }], idToken)
            .then(result => { if (result.httpStatus.httpStatus !== 200) showError(result, 'Unable to mark task completed'); })
            .catch(error => showError(error, 'Unable to mark task completed'));
    };

    const updateTask = (event, taskIndex, taskId) => {
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, description: localTasksArray[taskIndex].description }], idToken)
            .then(result => { if (result.httpStatus.httpStatus > 204) showError(result, 'Task description not updated'); })
            .catch(error => showError(error, 'Task description not updated'));
    };

    const { fieldChange: descriptionChange, fieldKeyDown: descriptionKeyDown, fieldOnBlur: descriptionOnBlur } = useCrudCallbacks({
        items: localTasksArray, setItems: setLocalTasksArray, fieldName: 'description', saveFn: updateTask
    });

    const deleteClick = (event, taskId) => taskDelete.openDialog({ taskId });

    const handleDialogClose = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
    }, [queryClient, profile]);

    const handleModeChange = (event, newMode) => {
        if (newMode !== null) { setMode(newMode); setPersistedMode(newMode); }
    };

    // Desktop FullCalendar event renderer
    const renderEventContent = (eventInfo) => (
        <div style={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', lineHeight: 1.3,
            fontSize: 'clamp(0.7rem, 2.5vw, 0.85rem)',
            fontFamily: '"Roboto","Helvetica","Arial",sans-serif',
        }}>
            {eventInfo.event.title}
        </div>
    );

    const desktopView = savedViewType && !savedViewType.startsWith('list') ? savedViewType : 'dayGridMonth';

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
            {isMobile ? (
                /* ── Mobile: custom scrollable day list ── */
                <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
                    {/* Controls: Today + mode toggle */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                               px: 2, py: 1, borderBottom: '1px solid #e0e0e0', flexShrink: 0 }}>
                        <Button onClick={() => scrollToDate(todayStr, 'smooth')} size="small" variant="outlined"
                                sx={{ textTransform: 'none', fontFamily: 'Roboto,sans-serif', minWidth: 60 }}>
                            Today
                        </Button>
                        <ToggleButtonGroup value={mode} exclusive onChange={handleModeChange}
                                           size="small" data-testid="calendar-mode-toggle">
                            <ToggleButton value="tasks" className="cal-toggle-btn">Tasks</ToggleButton>
                            <ToggleButton value="priorities" className="cal-toggle-btn">Priorities</ToggleButton>
                        </ToggleButtonGroup>
                    </Box>
                    {/* Scrollable list */}
                    <Box ref={mobileScrollContainerRef} sx={{ flex: 1, overflowY: 'auto' }}>
                        <div ref={topSentinelRef} style={{ height: 1 }} />
                        {mobileSortedDates.length === 0 ? (
                            <Typography sx={{ p: 3, color: 'text.secondary', textAlign: 'center' }}>
                                No completed {isTasksMode ? 'tasks' : 'priorities'}
                            </Typography>
                        ) : mobileSortedDates.map(date => (
                            <Box key={date} data-date={date}>
                                {/* Day header */}
                                <Box sx={{
                                    bgcolor: date === todayStr ? '#e8f5e9' : '#f5f5f5',
                                    px: 2, py: 0.75,
                                    borderBottom: '1px solid #ddd',
                                    position: 'sticky', top: 0, zIndex: 1,
                                }}>
                                    <Typography variant="body2" fontWeight={600}>
                                        {new Date(date + 'T12:00:00').toLocaleDateString('en-US',
                                            { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                        {date === todayStr ? ' — Today' : ''}
                                    </Typography>
                                </Box>
                                {/* Events for the day */}
                                {mobileEventsByDate[date].map(ev => (
                                    <Box key={ev.id}
                                         onClick={() => isTasksMode
                                             ? handleMobileTaskClick(ev.id)
                                             : handleMobilePriorityClick(ev.id)}
                                         sx={{ px: 2, py: 1, borderBottom: '1px solid #f0f0f0',
                                               cursor: 'pointer', '&:active': { bgcolor: '#f5f5f5' } }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.9rem', color: '#333' }}>
                                            {ev.title}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        ))}
                        <div ref={bottomSentinelRef} style={{ height: 1 }} />
                    </Box>
                </Box>
            ) : (
                /* ── Desktop: FullCalendar (unchanged from original) ── */
                <Box sx={{ px: 2, pb: 2, pt: '18pt', position: 'relative' }}>
                    <Typography sx={{
                        position: 'absolute', left: 0, right: 0, top: '18pt',
                        textAlign: 'center', lineHeight: '28px',
                        fontFamily: "'Roboto',sans-serif", fontSize: '1.3em', fontWeight: 500,
                        pointerEvents: 'none',
                    }}>
                        {calendarTitle}
                    </Typography>
                    <ToggleButtonGroup value={mode} exclusive onChange={handleModeChange}
                                       size="small" data-testid="calendar-mode-toggle"
                                       sx={{ position: 'absolute', right: 16, top: '18pt', zIndex: 1 }}>
                        <ToggleButton value="tasks" className="cal-toggle-btn">Tasks</ToggleButton>
                        <ToggleButton value="priorities" className="cal-toggle-btn">Priorities</ToggleButton>
                    </ToggleButtonGroup>
                    <FullCalendar
                        ref={calendarRef}
                        plugins={[dayGridPlugin, interactionPlugin]}
                        initialView={desktopView}
                        initialDate={savedDate || undefined}
                        headerToolbar={{ left: 'prev,next today dayGridMonth,dayGridWeek,dayGridDay', center: '', right: '' }}
                        buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
                        events={events}
                        editable={isTasksMode}
                        datesSet={handleDatesSet}
                        eventDrop={isTasksMode ? handleEventDrop : undefined}
                        eventClick={isTasksMode ? handleEventClick : handlePriorityClick}
                        eventContent={renderEventContent}
                        height="auto"
                    />
                </Box>
            )}

            {isTasksMode && (
                <TaskActionsContext.Provider value={{
                    priorityClick, doneClick, descriptionChange,
                    descriptionKeyDown, descriptionOnBlur, deleteClick,
                    tasksArray: localTasksArray, setTasksArray: setLocalTasksArray,
                    deleteDialogOpen: taskDelete.dialogOpen,
                    setDeleteDialogOpen: taskDelete.setDialogOpen,
                    setDeleteId: taskDelete.setInfoObject,
                    setDeleteConfirmed: taskDelete.setConfirmed,
                    disableStrikethrough: true,
                }}>
                    <TaskEditDialog {...{
                        taskEditDialogOpen, setTaskEditDialogOpen,
                        taskEditInfo, setTaskEditInfo,
                        onClose: handleDialogClose,
                    }} />
                </TaskActionsContext.Provider>
            )}
        </>
    );
};

export default CalendarFC;
