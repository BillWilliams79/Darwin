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
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

const CalendarFC = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const calendarRef = useRef(null);

    // Persisted calendar view state
    const savedViewType = useCalendarViewStore(s => s.viewType);
    const savedDate = useCalendarViewStore(s => s.currentDate);
    const savedMode = useCalendarViewStore(s => s.mode);
    const setCalendarView = useCalendarViewStore(s => s.setCalendarView);
    const setPersistedMode = useCalendarViewStore(s => s.setMode);

    const [calendarTitle, setCalendarTitle] = useState('');

    // Toggle mode: 'tasks' or 'priorities'
    const [mode, setMode] = useState(savedMode || 'tasks');
    const isTasksMode = mode === 'tasks';

    // Date range state — drives the query key
    const [dateRange, setDateRange] = useState({ start: null, end: null });
    const startStr = dateRange.start ? dateRange.start.toISOString().slice(0, 19) : null;
    const endStr = dateRange.end ? dateRange.end.toISOString().slice(0, 19) : null;

    // TanStack Query — fetch done tasks or completed priorities based on mode
    const { data: serverTasks } = useTasksDone(profile?.userName, startStr, endStr, { enabled: isTasksMode });
    const { data: serverPriorities } = usePrioritiesDone(profile?.userName, startStr, endStr, { enabled: !isTasksMode });

    // Task data — derived from query data
    const tasksArray = serverTasks || [];
    const [localTasksArray, setLocalTasksArray] = useState([]);

    // Keep local state in sync with server data for TaskActionsContext
    React.useEffect(() => {
        if (serverTasks) {
            setLocalTasksArray(serverTasks);
        }
    }, [serverTasks]);

    // Dialog state
    const [taskEditDialogOpen, setTaskEditDialogOpen] = useState(false);
    const [taskEditInfo, setTaskEditInfo] = useState({});

    // Delete confirmation dialog (same pattern as DayView)
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
        additionalCleanup: () => {
            setTaskEditDialogOpen(false);
            setTaskEditInfo({});
        }
    });

    const taskEventColor = 'WhiteSmoke';
    const priorityEventColor = '#E3F2FD';

    // Derive FullCalendar events from tasks or priorities based on mode
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

    // Build title from a date and the current mode
    const titleSuffix = isTasksMode ? 'Completed Tasks' : 'Completed Priorities';
    const buildTitle = useCallback((d, suffix) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(-2)} ${suffix}`;
    }, []);

    // When FullCalendar changes the visible date range
    const handleDatesSet = useCallback((dateInfo) => {
        setDateRange({ start: dateInfo.start, end: dateInfo.end });
        setCalendarTitle(buildTitle(dateInfo.view.currentStart, titleSuffix));
        setCalendarView({
            viewType: dateInfo.view.type,
            currentDate: dateInfo.view.currentStart.toISOString().slice(0, 10),
        });
    }, [buildTitle, titleSuffix, setCalendarView]);

    // Update title when mode changes (FullCalendar doesn't re-fire datesSet)
    React.useEffect(() => {
        const api = calendarRef.current?.getApi();
        if (api) {
            setCalendarTitle(buildTitle(api.view.currentStart, titleSuffix));
        }
    }, [titleSuffix, buildTitle]);

    // Drag and drop — update done_ts when event is dropped on a different day
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
                } else {
                    info.revert();
                    showError(result, 'Unable to move task');
                }
            })
            .catch(error => {
                info.revert();
                showError(error, 'Unable to move task');
            });
    }, [darwinUri, idToken, showError]);

    // Click to edit — find task in tasksArray by id and open the existing dialog
    const handleEventClick = useCallback((info) => {
        const taskId = info.event.id;
        const taskIndex = localTasksArray.findIndex(t => String(t.id) === taskId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: localTasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [localTasksArray]);

    // Click priority event — navigate to single priority view
    const handlePriorityClick = useCallback((info) => {
        navigate(`/swarm/priority/${info.event.id}`);
    }, [navigate]);

    // TaskActionsContext callbacks (same as DayView)
    const priorityClick = (taskIndex, taskId) => {
        let newTasksArray = [...localTasksArray];
        newTasksArray[taskIndex].priority = newTasksArray[taskIndex].priority ? 0 : 1;

        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, priority: newTasksArray[taskIndex].priority }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setLocalTasksArray(newTasksArray);
                } else if (result.httpStatus.httpStatus > 204) {
                    showError(result, "Unable to change task's priority");
                }
            }).catch(error => showError(error, "Unable to change task's priority"));
    };

    const doneClick = (taskIndex, taskId) => {
        let newTasksArray = [...localTasksArray];
        newTasksArray[taskIndex].done = newTasksArray[taskIndex].done ? 0 : 1;
        setLocalTasksArray(newTasksArray);

        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, done: newTasksArray[taskIndex].done,
            ...(newTasksArray[taskIndex].done === 1
                ? { done_ts: new Date().toISOString() }
                : { done_ts: 'NULL' }) }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200) {
                    showError(result, 'Unable to mark task completed');
                }
            }).catch(error => showError(error, 'Unable to mark task completed'));
    };

    const updateTask = (event, taskIndex, taskId) => {
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, description: localTasksArray[taskIndex].description }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 204) {
                    showError(result, 'Task description not updated, HTTP error');
                }
            }).catch(error => showError(error, 'Task description not updated, HTTP error'));
    };

    const { fieldChange: descriptionChange, fieldKeyDown: descriptionKeyDown, fieldOnBlur: descriptionOnBlur } = useCrudCallbacks({
        items: localTasksArray, setItems: setLocalTasksArray, fieldName: 'description', saveFn: updateTask
    });

    const deleteClick = (event, taskId) => {
        taskDelete.openDialog({ taskId });
    };

    // Dialog close callback — invalidate queries to refetch
    const handleDialogClose = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
    }, [queryClient, profile]);

    const handleModeChange = (event, newMode) => {
        if (newMode !== null) {
            setMode(newMode);
            setPersistedMode(newMode);
        }
    };

    const renderEventContent = (eventInfo) => (
        <div style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.3,
            fontSize: 'clamp(0.65rem, 0.8vw, 0.85rem)',
            fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
        }}>
            {eventInfo.event.title}
        </div>
    );

    return (
        <>
            <Box sx={{ px: 2, pb: 2, pt: '18pt', position: 'relative' }}>
                <Typography sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: '18pt',
                    textAlign: 'center',
                    lineHeight: '28px',
                    fontFamily: "'Roboto', sans-serif",
                    fontSize: '1.3em',
                    fontWeight: 500,
                    pointerEvents: 'none',
                }}>
                    {calendarTitle}
                </Typography>
                <ToggleButtonGroup
                    value={mode}
                    exclusive
                    onChange={handleModeChange}
                    size="small"
                    data-testid="calendar-mode-toggle"
                    sx={{
                        position: 'absolute',
                        right: 16,
                        top: '18pt',
                        zIndex: 1,
                    }}
                >
                    <ToggleButton value="tasks" className="cal-toggle-btn">Tasks</ToggleButton>
                    <ToggleButton value="priorities" className="cal-toggle-btn">Priorities</ToggleButton>
                </ToggleButtonGroup>
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView={savedViewType || 'dayGridMonth'}
                    initialDate={savedDate || undefined}
                    headerToolbar={{
                        left: 'prev,next today dayGridMonth,dayGridWeek,dayGridDay',
                        center: '',
                        right: '',
                    }}
                    buttonText={{
                        today: 'Today',
                        month: 'Month',
                        week: 'Week',
                        day: 'Day',
                    }}
                    events={events}
                    editable={isTasksMode}
                    datesSet={handleDatesSet}
                    eventDrop={isTasksMode ? handleEventDrop : undefined}
                    eventClick={isTasksMode ? handleEventClick : handlePriorityClick}
                    eventContent={renderEventContent}
                    height="auto"
                />
            </Box>

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
