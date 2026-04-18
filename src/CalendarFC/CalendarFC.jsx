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
import { useTasksDone, useRequirementsDone, useCategoryColors, useAllCategories, useMapRunsDone, useMapRoutes } from '../hooks/useDataQueries';
import { taskKeys, requirementKeys } from '../hooks/useQueryKeys';
import TaskEditDialog from '../Components/TaskEditDialog/TaskEditDialog';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import DayView from './DayView';
import PeriodSummaryView from './PeriodSummaryView';
import { periodDateRange, shiftPeriod, currentPeriodStart, formatPeriodLabel } from '../utils/dateFormat';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import useMediaQuery from '@mui/material/useMediaQuery';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

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
    const savedMode = useCalendarViewStore(s => s.mode);
    const setCalendarView = useCalendarViewStore(s => s.setCalendarView);
    const setPersistedMode = useCalendarViewStore(s => s.setMode);
    const summaryMode = useCalendarViewStore(s => s.summaryMode);
    const summaryDate = useCalendarViewStore(s => s.summaryDate);
    const setSummaryMode = useCalendarViewStore(s => s.setSummaryMode);
    const setSummaryDate = useCalendarViewStore(s => s.setSummaryDate);

    const [calendarTitle, setCalendarTitle] = useState('');

    // ── Shared state ─────────────────────────────────────────────────────────
    const [mode, setMode] = useState(savedMode || ['tasks', 'activities', 'requirements']);
    const isTasksMode = mode.includes('tasks');
    const isRequirementsMode = mode.includes('requirements');
    const isActivitiesMode = mode.includes('activities');
    const hasDraggable = isTasksMode || isRequirementsMode;

    // ── Desktop date range (FullCalendar datesSet → query) ───────────────────
    const [dateRange, setDateRange] = useState({ start: null, end: null });
    const startStr = dateRange.start ? dateRange.start.toISOString().slice(0, 19) : null;
    const endStr   = dateRange.end   ? dateRange.end.toISOString().slice(0, 19)   : null;

    // ── Mobile fetch range (IntersectionObserver driven) ─────────────────────
    const [mobileFetchStart, setMobileFetchStart] = useState(() => monthOffset(-3));
    const [mobileFetchEnd,   setMobileFetchEnd]   = useState(() => monthOffset(2));
    const mobileStartStr = mobileFetchStart.toISOString().slice(0, 19);
    const mobileEndStr   = mobileFetchEnd.toISOString().slice(0, 19);

    // ── Effective query range: summary mode overrides FC/mobile range ──────────
    const summaryRange = useMemo(
        () => summaryMode && summaryDate ? periodDateRange(summaryDate, summaryMode) : null,
        [summaryMode, summaryDate]
    );
    const effectiveStart = summaryRange ? summaryRange.start + 'T00:00:00' : (isMobile ? mobileStartStr : startStr);
    const effectiveEnd   = summaryRange ? summaryRange.end   + 'T23:59:59' : (isMobile ? mobileEndStr   : endStr);

    // ── Queries: summary mode / mobile / desktop FC range ────────────────────
    const { data: serverTasks }      = useTasksDone(profile?.userName,
        effectiveStart,
        effectiveEnd,
        { enabled: isTasksMode, fields: 'id,priority,done,description,done_ts,area_fk' });
    const { data: serverRequirements } = useRequirementsDone(profile?.userName,
        effectiveStart,
        effectiveEnd,
        { enabled: isRequirementsMode, fields: 'id,title,completed_at,category_fk' });
    const { data: categoryList } = useCategoryColors(profile?.userName, { enabled: isRequirementsMode });
    const { data: allCategoryList } = useAllCategories(profile?.userName, { fields: 'id,category_name,color,sort_order', enabled: isRequirementsMode });
    const { data: serverActivities } = useMapRunsDone(profile?.userName,
        effectiveStart,
        effectiveEnd,
        { enabled: isActivitiesMode });
    const { data: routeList } = useMapRoutes(profile?.userName, { enabled: isActivitiesMode });

    // ── Restore scroll position when returning from requirement detail ────────
    React.useEffect(() => {
        const savedY = sessionStorage.getItem('calview_scrollY');
        if (savedY !== null) {
            const y = parseInt(savedY, 10);
            sessionStorage.removeItem('calview_scrollY');
            requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Task local state (for edit dialog + drag-drop) ───────────────────────
    const [localTasksArray, setLocalTasksArray] = useState([]);
    React.useEffect(() => {
        if (serverTasks) setLocalTasksArray(serverTasks);
    }, [serverTasks]);

    // ── Requirement local state (for drag-drop) ───────────────────────────────
    const [localRequirementsArray, setLocalRequirementsArray] = useState([]);
    React.useEffect(() => {
        if (serverRequirements) setLocalRequirementsArray(serverRequirements);
    }, [serverRequirements]);

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
    const requirementEventColor = isDark ? '#2a3545' : '#E3F2FD';
    const activityEventColor = isDark ? '#352d4a' : '#D1C4E9';

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
        if (isRequirementsMode) {
            for (const requirement of localRequirementsArray) {
                result.push({
                    id: `p-${requirement.id}`,
                    title: requirement.title,
                    start: requirement.completed_at ? toLocaleDateString(requirement.completed_at, profile?.timezone) : null,
                    allDay: true,
                    editable: true,
                    backgroundColor: requirementEventColor,
                    borderColor: requirementEventColor,
                    textColor: isDark ? '#d9d0c4' : '#333',
                    classNames: ['fc-requirement-event'],
                    extendedProps: { sourceType: 'requirements', catColor: requirement.category_fk ? categoryColorMap[requirement.category_fk] : null, rawId: String(requirement.id) },
                });
            }
        }
        return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTasksMode, isActivitiesMode, isRequirementsMode, localTasksArray, localRequirementsArray, localActivitiesArray, profile?.timezone, isDark, categoryColorMap, routeNameMap]);

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
        ? (mode[0] === 'tasks' ? 'Completed Tasks' : mode[0] === 'requirements' ? 'Completed Requirements' : 'Activities')
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

    const handleRequirementDrop = useCallback((info) => {
        const rawId = info.event.extendedProps.rawId;
        const newDate = info.event.start;
        newDate.setHours(12, 0, 0, 0);
        const newCompletedAt = newDate.toISOString().slice(0, 19);
        call_rest_api(`${darwinUri}/requirements`, 'PUT', [{ id: rawId, completed_at: newCompletedAt }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setLocalRequirementsArray(prev => prev.map(p =>
                        String(p.id) === rawId ? { ...p, completed_at: newCompletedAt } : p
                    ));
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                } else { info.revert(); showError(result, 'Unable to move requirement'); }
            }).catch(error => { info.revert(); showError(error, 'Unable to move requirement'); });
    }, [darwinUri, idToken, showError, queryClient, profile]);

    const handleUnifiedDrop = useCallback((info) => {
        const sourceType = info.event.extendedProps.sourceType;
        if (sourceType === 'tasks') handleEventDrop(info);
        else if (sourceType === 'requirements') handleRequirementDrop(info);
    }, [handleEventDrop, handleRequirementDrop]);

    const handleEventClick = useCallback((info) => {
        const rawId = info.event.extendedProps.rawId;
        const taskIndex = localTasksArray.findIndex(t => String(t.id) === rawId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: localTasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [localTasksArray]);

    const handleRequirementClick = useCallback((info) => {
        sessionStorage.setItem('calview_scrollY', String(window.scrollY));
        navigate(`/swarm/requirement/${info.event.extendedProps.rawId}`, { state: { from: 'calendar' } });
    }, [navigate]);

    const handleActivityClick = useCallback((info) => {
        navigate(`/maps/${info.event.extendedProps.rawId}`, { state: { from: 'calendar' } });
    }, [navigate]);

    const handleUnifiedClick = useCallback((info) => {
        const sourceType = info.event.extendedProps.sourceType;
        if (sourceType === 'tasks') handleEventClick(info);
        else if (sourceType === 'activities') handleActivityClick(info);
        else handleRequirementClick(info);
    }, [handleEventClick, handleActivityClick, handleRequirementClick]);

    // Mobile-specific click handlers (no FC info wrapper) — receive rawId
    const handleMobileTaskClick = useCallback((rawId) => {
        const taskIndex = localTasksArray.findIndex(t => String(t.id) === rawId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: localTasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [localTasksArray]);

    const handleMobileRequirementClick = useCallback((rawId) => {
        sessionStorage.setItem('calview_scrollY', String(window.scrollY));
        navigate(`/swarm/requirement/${rawId}`, { state: { from: 'calendar' } });
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
            setLocalRequirementsArray(prev => prev.map(p =>
                String(p.id) === rawId ? { ...p, completed_at: newTs } : p
            ));
            call_rest_api(`${darwinUri}/requirements`, 'PUT', [{ id: rawId, completed_at: newTs }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, 'Unable to move requirement');
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    }
                }).catch(error => {
                    showError(error, 'Unable to move requirement');
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
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

    // ── Unified navigation (works for both calendar and summary mode) ────────
    const isDayView = savedViewType === 'dayGridDay';

    const handlePrev = useCallback(() => {
        if (summaryMode) {
            setSummaryDate(shiftPeriod(summaryDate, summaryMode, -1));
        } else {
            calendarRef.current?.getApi().prev();
        }
    }, [summaryMode, summaryDate, setSummaryDate]);

    const handleNext = useCallback(() => {
        if (summaryMode) {
            setSummaryDate(shiftPeriod(summaryDate, summaryMode, 1));
        } else {
            calendarRef.current?.getApi().next();
        }
    }, [summaryMode, summaryDate, setSummaryDate]);

    const handleTodayClick = useCallback(() => {
        if (summaryMode) setSummaryDate(currentPeriodStart(summaryMode));
        calendarRef.current?.getApi().today();
    }, [summaryMode, setSummaryDate]);

    const handleCustomViewChange = useCallback((event, newView) => {
        if (!newView) return;
        calendarRef.current?.getApi().changeView(newView);
        if (summaryMode) {
            if (newView === 'dayGridDay') {
                setSummaryMode(null); // day view uses DayView, not PeriodSummaryView
            } else {
                setSummaryMode(newView === 'dayGridMonth' ? 'month' : 'week');
            }
        }
    }, [summaryMode, setSummaryMode]);

    const handleSummaryToggle = useCallback(() => {
        if (isDayView) return; // day view always shows DayView
        if (summaryMode) {
            setSummaryMode(null);
        } else {
            const mode = savedViewType === 'dayGridMonth' ? 'month' : 'week';
            setSummaryMode(mode);
        }
    }, [isDayView, summaryMode, savedViewType, setSummaryMode]);

    const displayTitle = summaryMode
        ? formatPeriodLabel(summaryDate, summaryMode)
        : calendarTitle;

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

    // Source-type ordering: activities=0, tasks=1, requirements=2
    const SOURCE_ORDER = { activities: 0, tasks: 1, requirements: 2 };
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
                            <ToggleButton value="requirements" className="cal-toggle-btn">Requirements</ToggleButton>
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
                            const requirementEvents = dayEvents.filter(ev => ev.extendedProps?.sourceType === 'requirements');
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
                                {/* Events for the day — grouped: tasks, activities, requirements */}
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
                                                               cursor: 'pointer', bgcolor: activityEventColor,
                                                               '&:active': { opacity: 0.85 } }}>
                                                        <Typography variant="body2" sx={{ fontSize: '0.9rem', fontWeight: 700, color: 'text.primary' }}>
                                                            {ev.title}
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
                                                            {ev.extendedProps?.statsLine}
                                                        </Typography>
                                                    </Box>
                                                ))}
                                                {/* Requirements (draggable) */}
                                                {requirementEvents.map((ev, i) => (
                                                    <Draggable key={ev.id} draggableId={ev.id} index={taskEvents.length + i}>
                                                        {(provided, snapshot) => (
                                                            <Box ref={provided.innerRef}
                                                                 {...provided.draggableProps}
                                                                 {...provided.dragHandleProps}
                                                                 onClick={() => handleMobileRequirementClick(ev.extendedProps?.rawId)}
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
                    {/* FullCalendar wrapper — original single-box layout for CSS Grid compat */}
                    <Box sx={{
                        px: 2,
                        pb: (summaryMode || savedViewType === 'dayGridDay') ? 0 : 2,
                        pt: '18pt',
                        position: 'relative',
                        '& .fc-view-harness': { display: (savedViewType === 'dayGridDay' || summaryMode) ? 'none' : 'block' },
                        '& .fc-header-toolbar': { display: 'none' },
                    }}>
                        {/* ── Unified toolbar ── */}
                        <Box sx={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            mb: 1.5, flexWrap: 'wrap', gap: 1,
                        }}>
                            {/* Left: view buttons + Today + Summary */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <ToggleButtonGroup value={savedViewType} exclusive onChange={handleCustomViewChange}
                                                   size="small">
                                    <ToggleButton value="dayGridMonth" className="cal-toggle-btn">Month</ToggleButton>
                                    <ToggleButton value="dayGridWeek" className="cal-toggle-btn">Week</ToggleButton>
                                    <ToggleButton value="dayGridDay" className="cal-toggle-btn">Day</ToggleButton>
                                </ToggleButtonGroup>
                                <Button onClick={handleTodayClick} size="small" className="cal-toggle-btn"
                                        variant="outlined" sx={{ textTransform: 'none', ml: 0.5 }}>
                                    Today
                                </Button>
                                <ToggleButton value="summary" size="small" className="cal-toggle-btn"
                                              selected={!!summaryMode || isDayView}
                                              disabled={isDayView}
                                              onChange={handleSummaryToggle}
                                              data-testid="summary-toggle"
                                              sx={{ ml: 0.5 }}>
                                    Summary
                                </ToggleButton>
                            </Box>
                            {/* Center: ← Title → */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <IconButton onClick={handlePrev} size="small" data-testid="cal-prev">
                                    <ChevronLeftIcon />
                                </IconButton>
                                <Typography sx={{
                                    fontFamily: "'Roboto',sans-serif", fontSize: '1.3em', fontWeight: 500,
                                    textAlign: 'center', minWidth: 180,
                                }}>
                                    {displayTitle}
                                </Typography>
                                <IconButton onClick={handleNext} size="small" data-testid="cal-next">
                                    <ChevronRightIcon />
                                </IconButton>
                            </Box>
                            {/* Right: mode toggle */}
                            <ToggleButtonGroup value={mode} onChange={handleModeChange}
                                               size="small" data-testid="calendar-mode-toggle">
                                <ToggleButton value="tasks" className="cal-toggle-btn">Tasks</ToggleButton>
                                <ToggleButton value="activities" className="cal-toggle-btn">Activities</ToggleButton>
                                <ToggleButton value="requirements" className="cal-toggle-btn">Requirements</ToggleButton>
                            </ToggleButtonGroup>
                        </Box>
                        <FullCalendar
                            ref={calendarRef}
                            plugins={[dayGridPlugin, interactionPlugin]}
                            initialView={desktopView}
                            initialDate={todayStr}
                            headerToolbar={false}
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
                    {/* DayView — below FC box, same as production layout */}
                    {!summaryMode && savedViewType === 'dayGridDay' && mode.length > 0 && (
                        <DayView
                            mode={mode}
                            localTasksArray={localTasksArray}
                            localActivitiesArray={localActivitiesArray}
                            localRequirementsArray={localRequirementsArray}
                            timezone={profile?.timezone}
                            categoryList={allCategoryList}
                            categoryColorMap={categoryColorMap}
                            routeNameMap={routeNameMap}
                            navigate={navigate}
                            activityEventColor={activityEventColor}
                            requirementEventColor={requirementEventColor}
                        />
                    )}
                    {/* Summary mode — single wrapper div for CSS Grid (max 2 items in right column) */}
                    {summaryMode && mode.length > 0 && (
                        <div>
                            <PeriodSummaryView
                                summaryMode={summaryMode}
                                summaryDate={summaryDate}
                                mode={mode}
                                localTasksArray={localTasksArray}
                                localActivitiesArray={localActivitiesArray}
                                localRequirementsArray={localRequirementsArray}
                                timezone={profile?.timezone}
                                categoryList={allCategoryList}
                                categoryColorMap={categoryColorMap}
                                routeNameMap={routeNameMap}
                                navigate={navigate}
                                activityEventColor={activityEventColor}
                                requirementEventColor={requirementEventColor}
                            />
                        </div>
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
