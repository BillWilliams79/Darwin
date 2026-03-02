import React, { useState, useCallback, useContext, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import './CalendarFC.css';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { TaskActionsContext } from '../hooks/useTaskActions';
import { useTasksDone } from '../hooks/useDataQueries';
import { taskKeys } from '../hooks/useQueryKeys';
import TaskEditDialog from '../Components/TaskEditDialog/TaskEditDialog';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const CalendarFC = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);
    const queryClient = useQueryClient();
    const calendarRef = useRef(null);

    const [calendarTitle, setCalendarTitle] = useState('');

    // Date range state — drives the query key
    const [dateRange, setDateRange] = useState({ start: null, end: null });
    const startStr = dateRange.start ? dateRange.start.toISOString().slice(0, 19) : null;
    const endStr = dateRange.end ? dateRange.end.toISOString().slice(0, 19) : null;

    // TanStack Query — fetch done tasks for the visible date range
    const { data: serverTasks } = useTasksDone(profile?.userName, startStr, endStr);

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

    const eventColor = 'WhiteSmoke';

    // Derive FullCalendar events from tasksArray
    const events = useMemo(() =>
        localTasksArray.map(task => {
            const start = task.done_ts
                ? (() => {
                    const d = new Date(task.done_ts.replace(' ', 'T') + 'Z');
                    return d.getFullYear() + '-' +
                        String(d.getMonth() + 1).padStart(2, '0') + '-' +
                        String(d.getDate()).padStart(2, '0');
                })()
                : null;
            return {
                id: String(task.id),
                title: task.description,
                start,
                allDay: true,
                backgroundColor: eventColor,
                borderColor: eventColor,
                textColor: '#333',
            };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localTasksArray]);

    // When FullCalendar changes the visible date range
    const handleDatesSet = useCallback((dateInfo) => {
        setDateRange({ start: dateInfo.start, end: dateInfo.end });
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const d = dateInfo.view.currentStart;
        setCalendarTitle(`${months[d.getMonth()]} '${String(d.getFullYear()).slice(-2)} Completed Tasks`);
    }, []);

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
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView="dayGridMonth"
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
                    editable={true}
                    datesSet={handleDatesSet}
                    eventDrop={handleEventDrop}
                    eventClick={handleEventClick}
                    eventContent={renderEventContent}
                    height="auto"
                />
            </Box>

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
        </>
    );
};

export default CalendarFC;
