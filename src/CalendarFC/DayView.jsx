import React, { useContext, useMemo } from 'react';
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

const DayView = ({ localTasksArray, timezone }) => {
    const { profile } = useContext(AuthContext);
    const userName = profile?.userName;

    const savedDate = useCalendarViewStore(s => s.currentDate);

    // Fetch all areas (including closed) so completed tasks from closed areas still resolve
    const { data: allAreas = [], isLoading: areasLoading } = useAllAreas(userName, { fields: 'id,area_name,domain_fk' });
    const { data: allDomains = [], isLoading: domainsLoading } = useDomains(userName, { fields: 'id,domain_name' });

    const areasById = useMemo(() =>
        Object.fromEntries(allAreas.map(a => [a.id, a])),
    [allAreas]);

    const domainsById = useMemo(() =>
        Object.fromEntries(allDomains.map(d => [d.id, d])),
    [allDomains]);

    // Filter tasks for the selected date
    const dayTasks = useMemo(() => {
        if (!savedDate) return [];
        return localTasksArray.filter(t =>
            toLocaleDateString(t.done_ts, timezone) === savedDate
        );
    }, [localTasksArray, savedDate, timezone]);

    // Group: domainId → { domain_name, areas: { areaId → { area_name, tasks[] } } }
    const grouped = useMemo(() => {
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

    const domainEntries = useMemo(() =>
        Object.entries(grouped).sort(([, a], [, b]) => a.domain_name.localeCompare(b.domain_name)),
    [grouped]);

    const formattedDate = savedDate
        ? new Date(savedDate + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          })
        : '';

    return (
        <Box data-testid="day-view" sx={{ px: 2, pb: 2, pt: 1 }}>
            {/* Header: date only */}
            <Typography data-testid="day-view-date" sx={{ fontWeight: 500, fontSize: '1.1rem', mb: 2 }}>
                {formattedDate}
            </Typography>

            {/* Content */}
            {(areasLoading || domainsLoading) ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                    <CircularProgress size={24} />
                </Box>
            ) : dayTasks.length === 0 ? (
                <Typography color="text.secondary" textAlign="center" sx={{ mt: 2 }}>
                    No completed tasks on {formattedDate}
                </Typography>
            ) : (
                <Card variant="outlined">
                    <CardContent sx={{ pt: 1 }}>
                        {domainEntries.map(([domId, dom], di) => (
                            <Box key={domId} sx={{ mb: di < domainEntries.length - 1 ? 2 : 0 }}>
                                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
                                    {dom.domain_name}
                                </Typography>
                                {Object.entries(dom.areas).map(([areaId, area]) => (
                                    <Box key={areaId} sx={{ mb: 1.5, pl: 1 }}>
                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                                            {area.area_name}
                                        </Typography>
                                        {area.tasks.map(task => (
                                            <Typography key={task.id} variant="body2" sx={{ pl: 1 }}>
                                                {task.description}
                                            </Typography>
                                        ))}
                                    </Box>
                                ))}
                                {di < domainEntries.length - 1 && <Divider sx={{ mt: 1 }} />}
                            </Box>
                        ))}
                    </CardContent>
                </Card>
            )}
        </Box>
    );
};

export default DayView;
