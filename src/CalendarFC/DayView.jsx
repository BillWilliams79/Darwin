import React, { useContext, useMemo, useState } from 'react';
import AuthContext from '../Context/AuthContext';
import { useCalendarViewStore } from '../stores/useCalendarViewStore';
import { useAllAreas, useDomains } from '../hooks/useDataQueries';
import { toLocaleDateString } from '../utils/dateFormat';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReportIcon from '@mui/icons-material/Report';

// Format seconds as compact hours+minutes
const formatHM = (s) => {
    if (s == null) return '';
    const totalMin = Math.round(s / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
};

// Lightweight accordion chevron
const Chevron = ({ expanded, onClick }) => (
    <IconButton size="small" onClick={onClick} sx={{ ml: 0.25, p: 0.25 }}>
        <ExpandMoreIcon fontSize="small" sx={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
        }} />
    </IconButton>
);

const DayView = ({
    mode, localTasksArray, localActivitiesArray, localRequirementsArray,
    timezone, categoryList, categoryColorMap, routeNameMap,
    navigate, activityEventColor, requirementEventColor,
}) => {
    const { profile } = useContext(AuthContext);
    const userName = profile?.userName;
    const savedDate = useCalendarViewStore(s => s.currentDate);

    const isTasksMode = mode.includes('tasks');
    const isActivitiesMode = mode.includes('activities');
    const isRequirementsMode = mode.includes('requirements');

    // Accordion states — all open by default for day view (less detail)
    const [tasksExpanded, setTasksExpanded] = useState(true);
    const [activitiesExpanded, setActivitiesExpanded] = useState(true);
    const [requirementsExpanded, setRequirementsExpanded] = useState(true);
    const [collapsedDomains, setCollapsedDomains] = useState({});
    const [collapsedCategories, setCollapsedCategories] = useState({});
    const toggleDomain = (id) => setCollapsedDomains(prev => ({ ...prev, [id]: !prev[id] }));
    const toggleCategory = (id) => setCollapsedCategories(prev => ({ ...prev, [id]: !prev[id] }));

    // Fetch all areas/domains for task grouping (only when tasks mode active)
    const { data: allAreas = [], isLoading: areasLoading } = useAllAreas(userName, { fields: 'id,area_name,domain_fk', enabled: isTasksMode });
    const { data: allDomains = [], isLoading: domainsLoading } = useDomains(userName, { fields: 'id,domain_name', enabled: isTasksMode });

    const areasById = useMemo(() =>
        Object.fromEntries(allAreas.map(a => [a.id, a])),
    [allAreas]);

    const domainsById = useMemo(() =>
        Object.fromEntries(allDomains.map(d => [d.id, d])),
    [allDomains]);

    // Category name map for priority grouping
    const categoryNameMap = useMemo(() => {
        if (!categoryList) return {};
        const map = {};
        for (const cat of categoryList) map[cat.id] = cat.category_name;
        return map;
    }, [categoryList]);

    // Filter data for the selected date
    const dayTasks = useMemo(() => {
        if (!savedDate || !isTasksMode) return [];
        return localTasksArray.filter(t =>
            toLocaleDateString(t.done_ts, timezone) === savedDate
        );
    }, [localTasksArray, savedDate, timezone, isTasksMode]);

    const dayActivities = useMemo(() => {
        if (!savedDate || !isActivitiesMode) return [];
        return localActivitiesArray.filter(a =>
            toLocaleDateString(a.start_time, timezone) === savedDate
        );
    }, [localActivitiesArray, savedDate, timezone, isActivitiesMode]);

    const dayRequirements = useMemo(() => {
        if (!savedDate || !isRequirementsMode) return [];
        return localRequirementsArray.filter(p =>
            toLocaleDateString(p.completed_at, timezone) === savedDate
        );
    }, [localRequirementsArray, savedDate, timezone, isRequirementsMode]);

    // Group tasks: domainId → { domain_name, areas: { areaId → { area_name, tasks[] } } }
    const groupedTasks = useMemo(() => {
        const result = {};
        for (const task of dayTasks) {
            const area = areasById[task.area_fk];
            if (!area) continue;
            const domain = domainsById[area.domain_fk];
            if (!domain) continue;
            const domId = area.domain_fk;
            if (!result[domId]) result[domId] = { domain_name: domain.domain_name, areas: {} };
            if (!result[domId].areas[task.area_fk])
                result[domId].areas[task.area_fk] = { area_name: area.area_name, tasks: [] };
            result[domId].areas[task.area_fk].tasks.push(task);
        }
        return result;
    }, [dayTasks, areasById, domainsById]);

    const taskDomainEntries = useMemo(() =>
        Object.entries(groupedTasks).sort(([, a], [, b]) => a.domain_name.localeCompare(b.domain_name)),
    [groupedTasks]);

    // Group requirements: categoryId → { category_name, color, requirements[] }
    const groupedRequirements = useMemo(() => {
        const result = {};
        for (const requirement of dayRequirements) {
            const catId = requirement.category_fk || 'uncategorized';
            if (!result[catId]) {
                result[catId] = {
                    category_name: catId === 'uncategorized' ? 'Uncategorized' : (categoryNameMap[catId] || 'Unknown'),
                    color: catId === 'uncategorized' ? null : (categoryColorMap?.[catId] || null),
                    requirements: [],
                };
            }
            result[catId].requirements.push(requirement);
        }
        return result;
    }, [dayRequirements, categoryNameMap, categoryColorMap]);

    const requirementCategoryEntries = useMemo(() =>
        Object.entries(groupedRequirements).sort(([, a], [, b]) => a.category_name.localeCompare(b.category_name)),
    [groupedRequirements]);

    const formattedDate = savedDate
        ? new Date(savedDate + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          })
        : '';

    const hasAnyData = dayTasks.length > 0 || dayActivities.length > 0 || dayRequirements.length > 0;
    const isLoading = isTasksMode && (areasLoading || domainsLoading);

    // Aggregate stats for section headers
    const totalDistance = dayActivities.reduce((sum, a) => sum + Number(a.distance_mi || 0), 0);
    const totalDuration = dayActivities.reduce((sum, a) => sum + Number(a.run_time_sec || 0), 0);

    return (
        <Box data-testid="day-view" sx={{ px: 2, pb: 2, pt: 1 }}>
            {/* Header: date */}
            <Typography data-testid="day-view-date" sx={{ fontWeight: 500, fontSize: '1.1rem', mb: 2 }}>
                {formattedDate}
            </Typography>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                    <CircularProgress size={24} />
                </Box>
            ) : !hasAnyData ? (
                <Typography color="text.secondary" textAlign="center" sx={{ mt: 2 }}>
                    No events on {formattedDate}
                </Typography>
            ) : (
                <>
                    {/* ── Activities section ── */}
                    {isActivitiesMode && dayActivities.length > 0 && (
                        <Box data-testid="activity-day-view" sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="h6" fontWeight={700}>
                                    Activities
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                    {dayActivities.length} {dayActivities.length === 1 ? 'activity' : 'activities'}
                                    {' · '}{totalDistance.toFixed(1)} mi
                                    {' · '}{formatHM(totalDuration)}
                                </Typography>
                                <Chevron expanded={activitiesExpanded} onClick={() => setActivitiesExpanded(prev => !prev)} />
                            </Box>
                            <Collapse in={activitiesExpanded}>
                                {dayActivities.map(activity => (
                                    <Box key={activity.id}
                                         onClick={() => navigate(`/maps/${activity.id}`, { state: { from: 'calendar' } })}
                                         sx={{ p: 1.5, mb: 1, borderRadius: 1, cursor: 'pointer',
                                               bgcolor: activityEventColor, '&:hover': { opacity: 0.85 } }}>
                                        <Typography variant="body2" fontWeight={700}>
                                            {routeNameMap[activity.map_route_fk] || activity.activity_name || 'Activity'}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {Number(activity.distance_mi).toFixed(1)}mi @ {Number(activity.avg_speed_mph).toFixed(1)}mph for {formatHM(activity.run_time_sec)}
                                        </Typography>
                                    </Box>
                                ))}
                            </Collapse>
                        </Box>
                    )}

                    {/* ── Tasks section ── */}
                    {isTasksMode && dayTasks.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="h6" fontWeight={700}>
                                    Tasks
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                    {dayTasks.length} {dayTasks.length === 1 ? 'task' : 'tasks'}
                                </Typography>
                                <Chevron expanded={tasksExpanded} onClick={() => setTasksExpanded(prev => !prev)} />
                            </Box>
                            <Collapse in={tasksExpanded}>
                                <Card variant="outlined">
                                    <CardContent sx={{ pt: 1 }}>
                                        {taskDomainEntries.map(([domId, dom], di) => {
                                            const domTaskCount = Object.values(dom.areas).reduce((sum, a) => sum + a.tasks.length, 0);
                                            const domExpanded = !collapsedDomains[domId]; // open by default
                                            return (
                                            <Box key={domId} sx={{ mb: di < taskDomainEntries.length - 1 ? 2 : 0 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                                    <Typography variant="subtitle1" fontWeight={600}>
                                                        {dom.domain_name} ({domTaskCount})
                                                    </Typography>
                                                    <Chevron expanded={domExpanded} onClick={() => toggleDomain(domId)} />
                                                </Box>
                                                <Collapse in={domExpanded}>
                                                {Object.entries(dom.areas).map(([areaId, area]) => (
                                                    <Box key={areaId} sx={{ mb: 1.5, pl: 1 }}>
                                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                                                            {area.area_name}
                                                        </Typography>
                                                        {area.tasks.map(task => (
                                                            <Box key={task.id} sx={{ display: 'flex', alignItems: 'center', pl: 1 }}>
                                                                {task.priority === 1 && (
                                                                    <ReportIcon sx={{ fontSize: 18, mr: 0.5, color: 'primary.main' }} />
                                                                )}
                                                                <Typography variant="body2">
                                                                    {task.description}
                                                                </Typography>
                                                            </Box>
                                                        ))}
                                                    </Box>
                                                ))}
                                                </Collapse>
                                                {di < taskDomainEntries.length - 1 && <Divider sx={{ mt: 1 }} />}
                                            </Box>
                                            );
                                        })}
                                    </CardContent>
                                </Card>
                            </Collapse>
                        </Box>
                    )}

                    {/* ── Requirements section ── */}
                    {isRequirementsMode && dayRequirements.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="h6" fontWeight={700}>
                                    Requirements
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                    {dayRequirements.length} {dayRequirements.length === 1 ? 'requirement' : 'requirements'}
                                </Typography>
                                <Chevron expanded={requirementsExpanded} onClick={() => setRequirementsExpanded(prev => !prev)} />
                            </Box>
                            <Collapse in={requirementsExpanded}>
                                <Card variant="outlined">
                                    <CardContent sx={{ pt: 1 }}>
                                        {requirementCategoryEntries.map(([catId, cat], ci) => {
                                            const catExpanded = !collapsedCategories[catId]; // open by default
                                            return (
                                            <Box key={catId} sx={{ mb: ci < requirementCategoryEntries.length - 1 ? 2 : 0 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                                    <Typography variant="subtitle1" fontWeight={600} sx={{
                                                        ...(cat.color && { borderLeft: `3px solid ${cat.color}`, pl: 1 }),
                                                    }}>
                                                        {cat.category_name} ({cat.requirements.length})
                                                    </Typography>
                                                    <Chevron expanded={catExpanded} onClick={() => toggleCategory(catId)} />
                                                </Box>
                                                <Collapse in={catExpanded}>
                                                    {cat.requirements.map(requirement => (
                                                        <Typography key={requirement.id} variant="body2" sx={{
                                                            pl: 2, cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                                                        }}
                                                            onClick={() => navigate(`/swarm/requirement/${requirement.id}`)}>
                                                            {requirement.title}
                                                        </Typography>
                                                    ))}
                                                </Collapse>
                                                {ci < requirementCategoryEntries.length - 1 && <Divider sx={{ mt: 1 }} />}
                                            </Box>
                                            );
                                        })}
                                    </CardContent>
                                </Card>
                            </Collapse>
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
};

export default DayView;
