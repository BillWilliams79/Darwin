import React, { useState, useCallback, useContext, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import './CalendarFC.css';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import ThemeContext from '../Theme/ThemeContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useCalendarViewStore } from '../stores/useCalendarViewStore';
import { toLocaleDateString } from '../utils/dateFormat';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { TaskActionsContext } from '../hooks/useTaskActions';
import { useTasksDone, usePrioritiesDone, useCategoryColors, useAllCategories, useMapRunsDone, useMapRoutes } from '../hooks/useDataQueries';
import { taskKeys, priorityKeys } from '../hooks/useQueryKeys';
import TaskEditDialog from '../Components/TaskEditDialog/TaskEditDialog';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import DayView from './DayView';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import useMediaQuery from '@mui/material/useMediaQuery';

// Module-level: session scroll memory for mobile (survives remount, cleared on page reload)
let mobileScrollDate = null;

// Priority task highlight — green bg, bold dark green text
const PRIORITY_STYLE_LIGHT = { bg: '#E8F5E9', border: '#66BB6A', textColor: '#2E7D32' };
const PRIORITY_STYLE_DARK  = { bg: '#2e3b2e', border: '#4a7a4a', textColor: '#81c784' };

// Format seconds as compact hours+minutes (no leading zeros, no seconds)
const formatHM = (s) => {
    if (s == null) return '';
    const totalMin = Math.round(s / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
};

// Helper: date string 'YYYY-MM-DD' offset by N months from today
const monthOffset = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return d;
};

const CalendarFC = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const { effectiveMode } = useContext(ThemeContext);
    const isDark = effectiveMode === 'dark';
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
    const [mode, setMode] = useState(savedMode || ['tasks']);
    const isTasksMode = mode.includes('tasks');
    const isPrioritiesMode = mode.includes('priorities');
    const isActivitiesMode = mode.includes('activities');
    const hasDraggable = isTasksMode || isPrioritiesMode;

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
        { enabled: isTasksMode, fields: 'id,priority,done,description,done_ts,area_fk' });
    const { data: serverPriorities } = usePrioritiesDone(profile?.userName,
        isMobile ? mobileStartStr : startStr,
        isMobile ? mobileEndStr   : endStr,
        { enabled: isPrioritiesMode, fields: 'id,title,completed_at,category_fk' });
    const { data: categoryList } = useCategoryColors(profile?.userName, { enabled: isPrioritiesMode });
    const { data: allCategoryList } = useAllCategories(profile?.userName, { fields: 'id,category_name,color', enabled: isPrioritiesMode });
    const { data: serverActivities } = useMapRunsDone(profile?.userName,
        isMobile ? mobileStartStr : startStr,
        isMobile ? mobileEndStr   : endStr,
        { enabled: isActivitiesMode });
    const { data: routeList } = useMapRoutes(profile?.userName, { enabled: isActivitiesMode });

    // ── Task local state (for edit dialog + drag-drop) ───────────────────────
    const [localTasksArray, setLocalTasksArray] = useState([]);
    React.useEffect(() => {
        if (serverTasks) setLocalTasksArray(serverTasks);
    }, [serverTasks]);

    // ── Priority local state (for drag-drop) ──────────────────────────────────
    const [localPrioritiesArray, setLocalPrioritiesArray] = useState([]);
    React.useEffect(() => {
        if (serverPriorities) setLocalPrioritiesArray(serverPriorities);
    }, [serverPriorities]);

    // ── Activities local state (read-only) ──────────────────────────────────
    const [localActivitiesArray, setLocalActivitiesArray] = useState([]);
    React.useEffect(() => {
        if (serverActivities) setLocalActivitiesArray(serverActivities);
    }, [serverActivities]);

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

    // ── Category color map (category_fk → color) ──────────────────────────────
    const categoryColorMap = useMemo(() => {
        if (!categoryList) return {};
        const map = {};
        for (const cat of categoryList) {
            if (cat.color) map[cat.id] = cat.color;
        }
        return map;
    }, [categoryList]);

    // ── Route name map (map_route_fk → name) ────────────────────────────────
    const routeNameMap = useMemo(() => {
        if (!routeList) return {};
        const map = {};
        for (const r of routeList) map[r.id] = r.name;
        return map;
    }, [routeList]);

    // ── Events (shared FullCalendar format, reused for mobile grouping) ───────
    const PRIORITY_STYLE = isDark ? PRIORITY_STYLE_DARK : PRIORITY_STYLE_LIGHT;
    const taskEventColor     = isDark ? '#3a3632' : 'WhiteSmoke';
    const priorityEventColor = isDark ? '#2a3545' : '#E3F2FD';
    const activityEventColor = isDark ? '#2a3535' : '#E0F2F1';

    const events = useMemo(() => {
        const result = [];
        if (isActivitiesMode) {
            for (const activity of localActivitiesArray) {
                const location = routeNameMap[activity.map_route_fk] || activity.activity_name || 'Activity';
                const statsLine = `${Number(activity.distance_mi).toFixed(1)}mi @ ${Number(activity.avg_speed_mph).toFixed(1)}mph for ${formatHM(activity.run_time_sec)}`;
                result.push({
                    id: `a-${activity.id}`,
                    title: location,
                    start: activity.start_time ? toLocaleDateString(activity.start_time, profile?.timezone) : null,
                    allDay: true,
                    editable: false,
                    backgroundColor: activityEventColor,
                    borderColor: activityEventColor,
                    textColor: isDark ? '#d9d0c4' : '#333',
                    classNames: ['fc-activity-event'],
                    extendedProps: { sourceType: 'activities', isActivity: true, statsLine, rawId: String(activity.id) },
                });
            }
        }
        if (isTasksMode) {
            for (const task of localTasksArray) {
                const isHigh = task.priority === 1;
                result.push({
                    id: `t-${task.id}`,
                    title: isHigh ? `! ${task.description}` : task.description,
                    start: task.done_ts ? toLocaleDateString(task.done_ts, profile?.timezone) : null,
                    allDay: true,
                    editable: true,
                    backgroundColor: PRIORITY_STYLE.bg,
                    borderColor:     PRIORITY_STYLE.border,
                    textColor:       PRIORITY_STYLE.textColor,
                    extendedProps: { sourceType: 'tasks', priority: task.priority, rawId: String(task.id) },
                });
            }
        }
        if (isPrioritiesMode) {
            for (const priority of localPrioritiesArray) {
                result.push({
                    id: `p-${priority.id}`,
                    title: priority.title,
                    start: priority.completed_at ? toLocaleDateString(priority.completed_at, profile?.timezone) : null,
                    allDay: true,
                    editable: true,
                    backgroundColor: priorityEventColor,
                    borderColor: priorityEventColor,
                    textColor: isDark ? '#d9d0c4' : '#333',
                    classNames: ['fc-priority-event'],
                    extendedProps: { sourceType: 'priorities', catColor: priority.category_fk ? categoryColorMap[priority.category_fk] : null, rawId: String(priority.id) },
                });
            }
        }
        return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTasksMode, isActivitiesMode, isPrioritiesMode, localTasksArray, localPrioritiesArray, localActivitiesArray, profile?.timezone, isDark, categoryColorMap, routeNameMap]);

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
    const titleSuffix = mode.length === 1
        ? (mode[0] === 'tasks' ? 'Completed Tasks' : mode[0] === 'priorities' ? 'Completed Priorities' : 'Activities')
        : 'Calendar';
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

    const handleDateClick = useCallback((info) => {
        calendarRef.current?.getApi().changeView('dayGridDay', info.dateStr);
    }, []);

    const handleEventDrop = useCallback((info) => {
        const rawId = info.event.extendedProps.rawId;
        const newDate = info.event.start;
        newDate.setHours(12, 0, 0, 0);
        const newDoneTs = newDate.toISOString().slice(0, 19);
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: rawId, done_ts: newDoneTs }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setLocalTasksArray(prev => prev.map(t =>
                        String(t.id) === rawId ? { ...t, done_ts: newDoneTs } : t
                    ));
                } else { info.revert(); showError(result, 'Unable to move task'); }
            }).catch(error => { info.revert(); showError(error, 'Unable to move task'); });
    }, [darwinUri, idToken, showError]);

    const handlePriorityDrop = useCallback((info) => {
        const rawId = info.event.extendedProps.rawId;
        const newDate = info.event.start;
        newDate.setHours(12, 0, 0, 0);
        const newCompletedAt = newDate.toISOString().slice(0, 19);
        call_rest_api(`${darwinUri}/priorities`, 'PUT', [{ id: rawId, completed_at: newCompletedAt }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setLocalPrioritiesArray(prev => prev.map(p =>
                        String(p.id) === rawId ? { ...p, completed_at: newCompletedAt } : p
                    ));
                    queryClient.invalidateQueries({ queryKey: priorityKeys.all(profile.userName) });
                } else { info.revert(); showError(result, 'Unable to move priority'); }
            }).catch(error => { info.revert(); showError(error, 'Unable to move priority'); });
    }, [darwinUri, idToken, showError, queryClient, profile]);

    const handleUnifiedDrop = useCallback((info) => {
        const sourceType = info.event.extendedProps.sourceType;
        if (sourceType === 'tasks') handleEventDrop(info);
        else if (sourceType === 'priorities') handlePriorityDrop(info);
    }, [handleEventDrop, handlePriorityDrop]);

    const handleEventClick = useCallback((info) => {
        const rawId = info.event.extendedProps.rawId;
        const taskIndex = localTasksArray.findIndex(t => String(t.id) === rawId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: localTasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [localTasksArray]);

    const handlePriorityClick = useCallback((info) => {
        navigate(`/swarm/priority/${info.event.extendedProps.rawId}`);
    }, [navigate]);

    const handleActivityClick = useCallback((info) => {
        navigate(`/maps/${info.event.extendedProps.rawId}`, { state: { from: 'calendar' } });
    }, [navigate]);

    const handleUnifiedClick = useCallback((info) => {
        const sourceType = info.event.extendedProps.sourceType;
        if (sourceType === 'tasks') handleEventClick(info);
        else if (sourceType === 'activities') handleActivityClick(info);
        else handlePriorityClick(info);
    }, [handleEventClick, handleActivityClick, handlePriorityClick]);

    // Mobile-specific click handlers (no FC info wrapper) — receive rawId
    const handleMobileTaskClick = useCallback((rawId) => {
        const taskIndex = localTasksArray.findIndex(t => String(t.id) === rawId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: localTasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [localTasksArray]);

    const handleMobilePriorityClick = useCallback((rawId) => {
        navigate(`/swarm/priority/${rawId}`);
    }, [navigate]);

    const handleMobileActivityClick = useCallback((rawId) => {
        navigate(`/maps/${rawId}`, { state: { from: 'calendar' } });
    }, [navigate]);

    // ── Mobile drag-and-drop handler ───────────────────────────────────────────
    const handleMobileDragEnd = useCallback((result) => {
        const { source, destination, draggableId } = result;
        if (!destination || source.droppableId === destination.droppableId) return;

        // draggableId is prefixed (t-123, p-456) — extract type and raw ID
        const isTask = draggableId.startsWith('t-');
        const rawId = draggableId.slice(2);
        const newDate = destination.droppableId;
        const newTs = newDate + 'T12:00:00';

        if (isTask) {
            setLocalTasksArray(prev => prev.map(t =>
                String(t.id) === rawId ? { ...t, done_ts: newTs } : t
            ));
            call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: rawId, done_ts: newTs }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, 'Unable to move task');
                        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                    }
                }).catch(error => {
                    showError(error, 'Unable to move task');
                    queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                });
        } else {
            setLocalPrioritiesArray(prev => prev.map(p =>
                String(p.id) === rawId ? { ...p, completed_at: newTs } : p
            ));
            call_rest_api(`${darwinUri}/priorities`, 'PUT', [{ id: rawId, completed_at: newTs }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, 'Unable to move priority');
                        queryClient.invalidateQueries({ queryKey: priorityKeys.all(profile.userName) });
                    }
                }).catch(error => {
                    showError(error, 'Unable to move priority');
                    queryClient.invalidateQueries({ queryKey: priorityKeys.all(profile.userName) });
                });
        }
    }, [darwinUri, idToken, showError, queryClient, profile]);

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

    const handleModeChange = (event, newModes) => {
        setMode(newModes);
        setPersistedMode(newModes);
    };

    // Desktop FullCalendar event renderer
    const renderEventContent = (eventInfo) => {
        const { sourceType, isActivity, statsLine, catColor, priority } = eventInfo.event.extendedProps;
        if (isActivity) {
            return (
                <div style={{
                    overflow: 'hidden', lineHeight: 1.3,
                    fontSize: 'clamp(0.7rem, 2.5vw, 0.85rem)',
                    fontFamily: '"Roboto","Helvetica","Arial",sans-serif',
                }}>
                    <div style={{ fontWeight: 700 }}>{eventInfo.event.title}</div>
                    <div>{statsLine}</div>
                </div>
            );
        }
        const isHigh = sourceType === 'tasks' && priority === 1;
        return (
            <div style={{
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', lineHeight: 1.3,
                fontSize: 'clamp(0.7rem, 2.5vw, 0.85rem)',
                fontFamily: '"Roboto","Helvetica","Arial",sans-serif',
                fontWeight: isHigh ? 700 : 'normal',
                ...(catColor && { borderLeft: `3px solid ${catColor}`, paddingLeft: 4 }),
            }}>
                {eventInfo.event.title}
            </div>
        );
    };

    // Source-type ordering: activities=0, tasks=1, priorities=2
    const SOURCE_ORDER = { activities: 0, tasks: 1, priorities: 2 };
    const eventOrderFn = useCallback((a, b) => {
        const aOrder = SOURCE_ORDER[a.extendedProps.sourceType] ?? 9;
        const bOrder = SOURCE_ORDER[b.extendedProps.sourceType] ?? 9;
        return aOrder - bOrder;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const desktopView = savedViewType && !savedViewType.startsWith('list') ? savedViewType : 'dayGridMonth';

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
            {isMobile ? (
                /* ── Mobile: custom scrollable day list ── */
                <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
                    {/* Controls: Today + mode toggle */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                               px: 2, pt: 2, pb: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
                        <Button onClick={() => scrollToDate(todayStr, 'smooth')} size="small" variant="outlined"
                                sx={{ textTransform: 'none', fontFamily: 'Roboto,sans-serif', minWidth: 60 }}>
                            Today
                        </Button>
                        <ToggleButtonGroup value={mode} onChange={handleModeChange}
                                           size="small" data-testid="calendar-mode-toggle">
                            <ToggleButton value="tasks" className="cal-toggle-btn">Tasks</ToggleButton>
                            <ToggleButton value="activities" className="cal-toggle-btn">Activities</ToggleButton>
                            <ToggleButton value="priorities" className="cal-toggle-btn">Priorities</ToggleButton>
                        </ToggleButtonGroup>
                    </Box>
                    {/* Scrollable list */}
                    <DragDropContext onDragEnd={handleMobileDragEnd}>
                    <Box ref={mobileScrollContainerRef} sx={{ flex: 1, overflowY: 'auto' }}>
                        <div ref={topSentinelRef} style={{ height: 1 }} />
                        {mode.length === 0 ? (
                            <Typography sx={{ p: 3, color: 'text.secondary', textAlign: 'center' }}>
                                No data source selected
                            </Typography>
                        ) : mobileSortedDates.length === 0 ? (
                            <Typography sx={{ p: 3, color: 'text.secondary', textAlign: 'center' }}>
                                No events
                            </Typography>
                        ) : mobileSortedDates.map(date => {
                            const dayEvents = mobileEventsByDate[date];
                            const taskEvents = dayEvents.filter(ev => ev.extendedProps?.sourceType === 'tasks');
                            const activityEvents = dayEvents.filter(ev => ev.extendedProps?.sourceType === 'activities');
                            const priorityEvents = dayEvents.filter(ev => ev.extendedProps?.sourceType === 'priorities');
                            return (
                            <Box key={date} data-date={date}>
                                {/* Day header */}
                                <Box sx={{
                                    bgcolor: date === todayStr ? 'success.light' : 'action.hover',
                                    px: 2, py: 0.75,
                                    borderBottom: '1px solid', borderColor: 'divider',
                                    position: 'sticky', top: 0, zIndex: 1,
                                }}>
                                    <Typography variant="body2" fontWeight={600}>
                                        {new Date(date + 'T12:00:00').toLocaleDateString('en-US',
                                            { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                        {date === todayStr ? ' — Today' : ''}
                                    </Typography>
                                </Box>
                                {/* Events for the day — grouped: tasks, activities, priorities */}
                                {hasDraggable ? (
                                    <Droppable droppableId={date}>
                                        {(provided) => (
                                            <div ref={provided.innerRef} {...provided.droppableProps}
                                                 style={{ minHeight: 4 }}>
                                                {/* Tasks (draggable) */}
                                                {taskEvents.map((ev, i) => (
                                                    <Draggable key={ev.id} draggableId={ev.id} index={i}>
                                                        {(provided, snapshot) => (
                                                            <Box ref={provided.innerRef}
                                                                 {...provided.draggableProps}
                                                                 {...provided.dragHandleProps}
                                                                 onClick={() => handleMobileTaskClick(ev.extendedProps?.rawId)}
                                                                 sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
                                                                       cursor: 'pointer',
                                                                       bgcolor: snapshot.isDragging ? 'action.selected'
                                                                           : (ev.extendedProps?.priority === 1 ? PRIORITY_STYLE.bg : 'inherit'),
                                                                       '&:active': { bgcolor: 'action.hover' } }}>
                                                                <Typography variant="body2" sx={{
                                                                    fontSize: '0.9rem',
                                                                    color: ev.extendedProps?.priority === 1 ? PRIORITY_STYLE.textColor : 'text.primary',
                                                                    fontWeight: ev.extendedProps?.priority === 1 ? 700 : 'normal',
                                                                }}>
                                                                    {ev.title}
                                                                </Typography>
                                                            </Box>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {/* Activities (non-draggable) */}
                                                {activityEvents.map((ev) => (
                                                    <Box key={ev.id}
                                                         onClick={() => handleMobileActivityClick(ev.extendedProps?.rawId)}
                                                         sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
                                                               cursor: 'pointer', '&:active': { bgcolor: 'action.hover' } }}>
                                                        <Typography variant="body2" sx={{ fontSize: '0.9rem', fontWeight: 700, color: 'text.primary' }}>
                                                            {ev.title}
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
                                                            {ev.extendedProps?.statsLine}
                                                        </Typography>
                                                    </Box>
                                                ))}
                                                {/* Priorities (draggable) */}
                                                {priorityEvents.map((ev, i) => (
                                                    <Draggable key={ev.id} draggableId={ev.id} index={taskEvents.length + i}>
                                                        {(provided, snapshot) => (
                                                            <Box ref={provided.innerRef}
                                                                 {...provided.draggableProps}
                                                                 {...provided.dragHandleProps}
                                                                 onClick={() => handleMobilePriorityClick(ev.extendedProps?.rawId)}
                                                                 sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
                                                                       cursor: 'pointer',
                                                                       bgcolor: snapshot.isDragging ? 'action.selected' : 'inherit',
                                                                       ...(ev.extendedProps?.catColor && {
                                                                           borderLeft: `3px solid ${ev.extendedProps.catColor}`,
                                                                       }),
                                                                       '&:active': { bgcolor: 'action.hover' } }}>
                                                                <Typography variant="body2" sx={{ fontSize: '0.9rem' }}>
                                                                    {ev.title}
                                                                </Typography>
                                                            </Box>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                ) : (
                                    <div style={{ minHeight: 4 }}>
                                        {activityEvents.map((ev) => (
                                            <Box key={ev.id}
                                                 onClick={() => handleMobileActivityClick(ev.extendedProps?.rawId)}
                                                 sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
                                                       cursor: 'pointer', '&:active': { bgcolor: 'action.hover' } }}>
                                                <Typography variant="body2" sx={{ fontSize: '0.9rem', fontWeight: 700, color: 'text.primary' }}>
                                                    {ev.title}
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
                                                    {ev.extendedProps?.statsLine}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </div>
                                )}
                            </Box>
                            );
                        })}
                        <div ref={bottomSentinelRef} style={{ height: 1 }} />
                    </Box>
                    </DragDropContext>
                </Box>
            ) : (
                /* ── Desktop ── */
                <>
                    {/* FullCalendar: always visible; only calendar grid is hidden in day view */}
                    <Box sx={{
                        px: 2,
                        pb: savedViewType === 'dayGridDay' ? 0 : 2,
                        pt: '18pt',
                        position: 'relative',
                        '& .fc-view-harness': { display: savedViewType === 'dayGridDay' ? 'none' : 'block' },
                    }}>
                        <Typography sx={{
                            position: 'absolute', left: 0, right: 0, top: '18pt',
                            textAlign: 'center', lineHeight: '28px',
                            fontFamily: "'Roboto',sans-serif", fontSize: '1.3em', fontWeight: 500,
                            pointerEvents: 'none',
                        }}>
                            {calendarTitle}
                        </Typography>
                        <ToggleButtonGroup value={mode} onChange={handleModeChange}
                                           size="small" data-testid="calendar-mode-toggle"
                                           sx={{ position: 'absolute', right: 16, top: '18pt', zIndex: 1 }}>
                            <ToggleButton value="tasks" className="cal-toggle-btn">Tasks</ToggleButton>
                            <ToggleButton value="activities" className="cal-toggle-btn">Activities</ToggleButton>
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
                            editable={hasDraggable}
                            datesSet={handleDatesSet}
                            dateClick={handleDateClick}
                            eventDrop={handleUnifiedDrop}
                            eventClick={handleUnifiedClick}
                            eventContent={renderEventContent}
                            eventOrder={eventOrderFn}
                            height="auto"
                            fixedWeekCount={false}
                        />
                    </Box>
                    {/* DayView content renders below the FullCalendar toolbar */}
                    {savedViewType === 'dayGridDay' && mode.length > 0 && (
                        <DayView
                            mode={mode}
                            localTasksArray={localTasksArray}
                            localActivitiesArray={localActivitiesArray}
                            localPrioritiesArray={localPrioritiesArray}
                            timezone={profile?.timezone}
                            categoryList={allCategoryList}
                            categoryColorMap={categoryColorMap}
                            routeNameMap={routeNameMap}
                            navigate={navigate}
                            activityEventColor={activityEventColor}
                            priorityEventColor={priorityEventColor}
                        />
                    )}
                </>
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
