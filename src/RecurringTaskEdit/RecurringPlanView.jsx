import React, { useEffect, useContext } from 'react';
import { useDomains, useAllAreas, useRecurringTasks } from '../hooks/useDataQueries';
import { useDragTabStore } from '../stores/useDragTabStore';
import AuthContext from '../Context/AuthContext';

import '../index.css';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import RecurringAreaCard from './RecurringAreaCard';
import RecurringDroppableTab from './RecurringDroppableTab';
import RecurringTaskDragLayer from './RecurringTaskDragLayer';

const RecurringPlanView = () => {
    const { profile } = useContext(AuthContext);
    const activeTab = useDragTabStore(s => s.activeTab);
    const setActiveTab = useDragTabStore(s => s.setActiveTab);

    // Reset tab to 0 when this view mounts (store may hold state from TaskPlanView)
    useEffect(() => {
        setActiveTab(0);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const { data: domains } = useDomains(profile?.userName, { closed: 0 });
    const { data: allAreas } = useAllAreas(profile?.userName, {
        fields: 'id,area_name,domain_fk,sort_order',
        closed: 0,
    });
    const { data: allDefs, isLoading } = useRecurringTasks(profile?.userName);

    const sortedDomains = domains
        ? [...domains].sort((a, b) => {
            if (a.sort_order === null && b.sort_order === null) return 0;
            if (a.sort_order === null) return 1;
            if (b.sort_order === null) return -1;
            return a.sort_order - b.sort_order;
        })
        : [];

    const sortedAreas = allAreas
        ? [...allAreas].sort((a, b) => {
            if (a.sort_order === null && b.sort_order === null) return 0;
            if (a.sort_order === null) return 1;
            if (b.sort_order === null) return -1;
            return a.sort_order - b.sort_order;
        })
        : [];

    const areasForDomain = (domainId) =>
        sortedAreas.filter(a => String(a.domain_fk) === String(domainId));

    const defsForArea = (areaId) =>
        (allDefs || []).filter(d => String(d.area_fk) === String(areaId));

    if (!domains || isLoading) return <CircularProgress sx={{ m: 4 }} />;

    return (
        <>
        <RecurringTaskDragLayer />
        <Box className="app-content-planpage">
            {/* Domain tabs — droppable for recurring task hover-to-switch */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }} className="app-content-tabs">
                <Tabs
                    value={activeTab}
                    onChange={(_, v) => setActiveTab(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                >
                    {sortedDomains.map((domain, idx) => (
                        <RecurringDroppableTab
                            key={domain.id}
                            label={domain.domain_name}
                            value={idx}
                            domainIndex={idx}
                        />
                    ))}
                </Tabs>
            </Box>

            {/* Area cards — one panel per domain, uses .card CSS for auto-fill grid */}
            {sortedDomains.map((domain, idx) => (
                <Box
                    key={domain.id}
                    role="tabpanel"
                    hidden={activeTab !== idx}
                    className="app-content-tabpanel"
                    sx={{ p: 3, display: activeTab === idx ? 'block' : 'none' }}
                >
                    {areasForDomain(domain.id).length === 0 ? (
                        <Typography color="text.secondary">No open areas in this domain.</Typography>
                    ) : (
                        <Box sx={{
                            display: 'grid',
                            gap: '12px',
                            gridTemplateColumns: {
                                xs: 'repeat(auto-fill, minmax(300px, 1fr))',
                                md: 'repeat(auto-fill, minmax(500px, 1fr))',
                            },
                        }}>
                            {areasForDomain(domain.id).map(area => (
                                <RecurringAreaCard
                                    key={area.id}
                                    area={area}
                                    definitions={defsForArea(area.id)}
                                />
                            ))}
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
        </>
    );
};

export default RecurringPlanView;
