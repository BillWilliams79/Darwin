import React, { useContext, useMemo, useState } from 'react';
import AuthContext from '../Context/AuthContext';
import { useAllAreas, useDomains } from '../hooks/useDataQueries';
import { formatPeriodLabel } from '../utils/dateFormat';

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

// Sort helper: sort_order ascending, nulls last
const bySortOrder = (a, b) => {
    const aOrd = a.sort_order ?? Infinity;
    const bOrd = b.sort_order ?? Infinity;
    return aOrd - bOrd;
};

// Lightweight accordion chevron next to title
const Chevron = ({ expanded, onClick }) => (
    <IconButton size="small" onClick={onClick} sx={{ ml: 0.25, p: 0.25 }}>
        <ExpandMoreIcon fontSize="small" sx={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
        }} />
    </IconButton>
);

const PeriodSummaryView = ({
    summaryMode, summaryDate, mode,
    localTasksArray, localActivitiesArray, localRequirementsArray,
    timezone, categoryList, categoryColorMap, routeNameMap,
    navigate, activityEventColor, requirementEventColor,
}) => {
    const { profile } = useContext(AuthContext);
    const userName = profile?.userName;

    const isTasksMode = mode.includes('tasks');
    const isActivitiesMode = mode.includes('activities');
    const isRequirementsMode = mode.includes('requirements');

    // Top-level accordion states (Activities closed, Tasks/Requirements open by default)
    const [tasksExpanded, setTasksExpanded] = useState(true);
    const [activitiesExpanded, setActivitiesExpanded] = useState(false);
    const [requirementsExpanded, setRequirementsExpanded] = useState(true);
    // Domain/category sub-accordions (collapsed by default — store expanded ones)
    const [expandedDomains, setExpandedDomains] = useState({});
    const [expandedCategories, setExpandedCategories] = useState({});
    const toggleDomain = (id) => setExpandedDomains(prev => ({ ...prev, [id]: !prev[id] }));
    const toggleCategory = (id) => setExpandedCategories(prev => ({ ...prev, [id]: !prev[id] }));

    // Fetch areas/domains for task grouping (include sort_order for correct ordering)
    const { data: allAreas = [], isLoading: areasLoading } = useAllAreas(userName, { fields: 'id,area_name,domain_fk,sort_order', enabled: isTasksMode });
    const { data: allDomains = [], isLoading: domainsLoading } = useDomains(userName, { fields: 'id,domain_name,sort_order', enabled: isTasksMode });

    const areasById = useMemo(() =>
        Object.fromEntries(allAreas.map(a => [a.id, a])),
    [allAreas]);

    const domainsById = useMemo(() =>
        Object.fromEntries(allDomains.map(d => [d.id, d])),
    [allDomains]);

    // Category name map
    const categoryNameMap = useMemo(() => {
        if (!categoryList) return {};
        const map = {};
        for (const cat of categoryList) map[cat.id] = cat.category_name;
        return map;
    }, [categoryList]);

    // Category sort_order map
    const categorySortMap = useMemo(() => {
        if (!categoryList) return {};
        const map = {};
        for (const cat of categoryList) map[cat.id] = cat.sort_order ?? Infinity;
        return map;
    }, [categoryList]);

    // Data arrays are already fetched for the summary date range — use directly
    const periodTasks = isTasksMode ? localTasksArray : [];
    const periodActivities = isActivitiesMode ? localActivitiesArray : [];
    const periodRequirements = isRequirementsMode ? localRequirementsArray : [];

    // Aggregate stats
    const stats = useMemo(() => {
        const taskCount = periodTasks.length;
        const activityCount = periodActivities.length;
        const totalDistance = periodActivities.reduce((sum, a) => sum + Number(a.distance_mi || 0), 0);
        const totalDuration = periodActivities.reduce((sum, a) => sum + Number(a.run_time_sec || 0), 0);
        const requirementCount = periodRequirements.length;
        return { taskCount, activityCount, totalDistance, totalDuration, requirementCount };
    }, [periodTasks, periodActivities, periodRequirements]);

    // Group tasks: domainId → { domain_name, sort_order, areas: { areaId → { area_name, sort_order, tasks[] } } }
    const groupedTasks = useMemo(() => {
        const result = {};
        for (const task of periodTasks) {
            const area = areasById[task.area_fk];
            if (!area) continue;
            const domain = domainsById[area.domain_fk];
            if (!domain) continue;
            const domId = area.domain_fk;
            if (!result[domId]) result[domId] = { domain_name: domain.domain_name, sort_order: domain.sort_order, areas: {} };
            if (!result[domId].areas[task.area_fk])
                result[domId].areas[task.area_fk] = { area_name: area.area_name, sort_order: area.sort_order, tasks: [] };
            result[domId].areas[task.area_fk].tasks.push(task);
        }
        // Sort tasks within each area: high priority first, then by id
        for (const dom of Object.values(result)) {
            for (const area of Object.values(dom.areas)) {
                area.tasks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id - b.id);
            }
        }
        return result;
    }, [periodTasks, areasById, domainsById]);

    // Sort domains by sort_order, areas within each domain by sort_order
    const taskDomainEntries = useMemo(() =>
        Object.entries(groupedTasks)
            .sort(([, a], [, b]) => bySortOrder(a, b))
            .map(([domId, dom]) => [domId, {
                ...dom,
                sortedAreas: Object.entries(dom.areas).sort(([, a], [, b]) => bySortOrder(a, b)),
            }]),
    [groupedTasks]);

    // Group requirements: categoryId → { category_name, color, sort_order, requirements[] }
    const groupedRequirements = useMemo(() => {
        const result = {};
        for (const requirement of periodRequirements) {
            const catId = requirement.category_fk || 'uncategorized';
            if (!result[catId]) {
                result[catId] = {
                    category_name: catId === 'uncategorized' ? 'Uncategorized' : (categoryNameMap[catId] || 'Unknown'),
                    color: catId === 'uncategorized' ? null : (categoryColorMap?.[catId] || null),
                    sort_order: catId === 'uncategorized' ? Infinity : (categorySortMap[catId] ?? Infinity),
                    requirements: [],
                };
            }
            result[catId].requirements.push(requirement);
        }
        // Sort requirements within each category by id (creation order)
        for (const cat of Object.values(result)) {
            cat.requirements.sort((a, b) => a.id - b.id);
        }
        return result;
    }, [periodRequirements, categoryNameMap, categoryColorMap, categorySortMap]);

    // Sort categories by sort_order
    const requirementCategoryEntries = useMemo(() =>
        Object.entries(groupedRequirements).sort(([, a], [, b]) => bySortOrder(a, b)),
    [groupedRequirements]);

    const periodLabel = formatPeriodLabel(summaryDate, summaryMode);
    const hasAnyData = periodTasks.length > 0 || periodActivities.length > 0 || periodRequirements.length > 0;
    const isLoading = isTasksMode && (areasLoading || domainsLoading);

    return (
        <Box data-testid="period-summary" sx={{ px: 2, pb: 2, pt: 1 }}>
            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                    <CircularProgress size={24} />
                </Box>
            ) : !hasAnyData ? (
                <Typography color="text.secondary" textAlign="center" sx={{ mt: 2 }}>
                    No events for {periodLabel}
                </Typography>
            ) : (
                <>
                    {/* ── Activities section ── */}
                    {isActivitiesMode && periodActivities.length > 0 && (
                        <Box data-testid="activity-period-summary" sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="h6" fontWeight={700}>
                                    Activities
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                    {stats.activityCount} {stats.activityCount === 1 ? 'activity' : 'activities'}
                                    {' · '}{stats.totalDistance.toFixed(1)} mi
                                    {' · '}{formatHM(stats.totalDuration)}
                                </Typography>
                                <Chevron expanded={activitiesExpanded} onClick={() => setActivitiesExpanded(prev => !prev)} />
                            </Box>
                            <Collapse in={activitiesExpanded}>
                                {periodActivities.map(activity => (
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
                    {isTasksMode && periodTasks.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="h6" fontWeight={700}>
                                    Tasks
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                    {stats.taskCount} {stats.taskCount === 1 ? 'task' : 'tasks'}
                                </Typography>
                                <Chevron expanded={tasksExpanded} onClick={() => setTasksExpanded(prev => !prev)} />
                            </Box>
                            <Collapse in={tasksExpanded}>
                                <Card variant="outlined">
                                    <CardContent sx={{ pt: 1 }}>
                                        {taskDomainEntries.map(([domId, dom], di) => {
                                            const domTaskCount = dom.sortedAreas.reduce((sum, [, a]) => sum + a.tasks.length, 0);
                                            const domExpanded = !!expandedDomains[domId];
                                            return (
                                            <Box key={domId} sx={{ mb: di < taskDomainEntries.length - 1 ? 2 : 0 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                                    <Typography variant="subtitle1" fontWeight={600}>
                                                        {dom.domain_name} ({domTaskCount})
                                                    </Typography>
                                                    <Chevron expanded={domExpanded} onClick={() => toggleDomain(domId)} />
                                                </Box>
                                                <Collapse in={domExpanded}>
                                                {dom.sortedAreas.map(([areaId, area]) => (
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
                    {isRequirementsMode && periodRequirements.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="h6" fontWeight={700}>
                                    Requirements
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                    {stats.requirementCount} {stats.requirementCount === 1 ? 'requirement' : 'requirements'}
                                </Typography>
                                <Chevron expanded={requirementsExpanded} onClick={() => setRequirementsExpanded(prev => !prev)} />
                            </Box>
                            <Collapse in={requirementsExpanded}>
                                <Card variant="outlined">
                                    <CardContent sx={{ pt: 1 }}>
                                        {requirementCategoryEntries.map(([catId, cat], ci) => {
                                            const catExpanded = !!expandedCategories[catId];
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
                                                            onClick={() => {
                                                                sessionStorage.setItem('calview_scrollY', String(window.scrollY));
                                                                navigate(`/swarm/requirement/${requirement.id}`, { state: { from: 'calendar' } });
                                                            }}>
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

export default PeriodSummaryView;
