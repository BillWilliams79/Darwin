import React, { useState, useCallback, useContext, useRef, useMemo } from 'react';
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
import TaskEditDialog from '../Components/TaskEditDialog/TaskEditDialog';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const CalendarFC = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);
    const calendarRef = useRef(null);
    const dateRangeRef = useRef(null);

    const [calendarTitle, setCalendarTitle] = useState('');

    // Task data — full objects, same shape as original calendar
    const [tasksArray, setTasksArray] = useState([]);
    const [taskApiToggle, setTaskApiToggle] = useState(false);

    // Dialog state
    const [taskEditDialogOpen, setTaskEditDialogOpen] = useState(false);
    const [taskEditInfo, setTaskEditInfo] = useState({});

    // Delete confirmation dialog (same pattern as DayView)
    const taskDelete = useConfirmDialog({
        onConfirm: ({ taskId }) => {
            call_rest_api(`${darwinUri}/tasks`, 'DELETE', { id: taskId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        setTasksArray(prev => prev.filter(t => t.id !== taskId));
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
        tasksArray.map(task => {
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
    [tasksArray]);

    // Fetch tasks when visible date range changes
    const fetchTasks = useCallback((start, end) => {
        const startStr = start.toISOString().slice(0, 19);
        const endStr = end.toISOString().slice(0, 19);

        const uri = `${darwinUri}/tasks?creator_fk=${profile.userName}&done=1&filter_ts=(done_ts,${startStr},${endStr})&fields=id,priority,done,description,done_ts`;

        call_rest_api(uri, 'GET', '', idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setTasksArray(result.data);
                }
            })
            .catch(error => {
                if (error.httpStatus?.httpStatus === 404) {
                    setTasksArray([]);
                } else {
                    console.log('CalendarFC fetch error:', error);
                }
            });
    }, [darwinUri, profile, idToken]);

    const handleDatesSet = useCallback((dateInfo) => {
        dateRangeRef.current = { start: dateInfo.start, end: dateInfo.end };
        fetchTasks(dateInfo.start, dateInfo.end);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const d = dateInfo.view.currentStart;
        setCalendarTitle(`${months[d.getMonth()]} '${String(d.getFullYear()).slice(-2)} Completed Tasks`);
    }, [fetchTasks]);

    // Refetch when dialog closes (taskApiToggle changes)
    React.useEffect(() => {
        if (dateRangeRef.current) {
            fetchTasks(dateRangeRef.current.start, dateRangeRef.current.end);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskApiToggle]);

    // Drag and drop — update done_ts when event is dropped on a different day
    const handleEventDrop = useCallback((info) => {
        const taskId = info.event.id;
        const newDate = info.event.start;
        newDate.setHours(12, 0, 0, 0);
        const newDoneTs = newDate.toISOString().slice(0, 19);

        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, done_ts: newDoneTs }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setTasksArray(prev => prev.map(t =>
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
        const taskIndex = tasksArray.findIndex(t => String(t.id) === taskId);
        if (taskIndex !== -1) {
            setTaskEditInfo({ task: tasksArray[taskIndex], taskIndex });
            setTaskEditDialogOpen(true);
        }
    }, [tasksArray]);

    // TaskActionsContext callbacks (same as DayView)
    const priorityClick = (taskIndex, taskId) => {
        let newTasksArray = [...tasksArray];
        newTasksArray[taskIndex].priority = newTasksArray[taskIndex].priority ? 0 : 1;

        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, priority: newTasksArray[taskIndex].priority }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setTasksArray(newTasksArray);
                } else if (result.httpStatus.httpStatus > 204) {
                    showError(result, "Unable to change task's priority");
                }
            }).catch(error => showError(error, "Unable to change task's priority"));
    };

    const doneClick = (taskIndex, taskId) => {
        let newTasksArray = [...tasksArray];
        newTasksArray[taskIndex].done = newTasksArray[taskIndex].done ? 0 : 1;
        setTasksArray(newTasksArray);

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
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, description: tasksArray[taskIndex].description }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 204) {
                    showError(result, 'Task description not updated, HTTP error');
                }
            }).catch(error => showError(error, 'Task description not updated, HTTP error'));
    };

    const { fieldChange: descriptionChange, fieldKeyDown: descriptionKeyDown, fieldOnBlur: descriptionOnBlur } = useCrudCallbacks({
        items: tasksArray, setItems: setTasksArray, fieldName: 'description', saveFn: updateTask
    });

    const deleteClick = (event, taskId) => {
        taskDelete.openDialog({ taskId });
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
                tasksArray, setTasksArray,
                deleteDialogOpen: taskDelete.dialogOpen,
                setDeleteDialogOpen: taskDelete.setDialogOpen,
                setDeleteId: taskDelete.setInfoObject,
                setDeleteConfirmed: taskDelete.setConfirmed,
                disableStrikethrough: true,
            }}>
                <TaskEditDialog {...{
                    taskEditDialogOpen, setTaskEditDialogOpen,
                    taskEditInfo, setTaskEditInfo,
                    taskApiToggle, setTaskApiToggle,
                }} />
            </TaskActionsContext.Provider>
        </>
    );
};

export default CalendarFC;
