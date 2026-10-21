import React, { useEffect, useContext, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useDomains, useAllAreas, useRecurringTasks } from '../hooks/useDataQueries';
import { recurringTaskKeys } from '../hooks/useQueryKeys';
import { useDragTabStore } from '../stores/useDragTabStore';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    DarwinDndContext, DarwinSortableList, RemeasureOnChange, useDarwinDropZone, DarwinListRegistry,
} from '../dnd';
import { RECURRING_TABS, recurringIds } from './recurringDnd';
import { useRecurringDnd } from './useRecurringDnd';

import '../index.css';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import RecurringAreaCard from './RecurringAreaCard';
import RecurringDroppableTab from './RecurringDroppableTab';

const bySortOrder = (a, b) => {
    if (a.sort_order === null && b.sort_order === null) return 0;
    if (a.sort_order === null) return 1;
    if (b.sort_order === null) return -1;
    return a.sort_order - b.sort_order;
};

// The domain tab strip as a drop zone (req #3663): it tells the collision rule
// where the tabs are SHOWN, so a tab scrolled out of the strip never switches
// the page from under whatever sits beside it.
const DomainStripZone = ({ children }) => {
    const { setNodeRef } = useDarwinDropZone({ id: recurringIds.domains, policy: RECURRING_TABS });
    return <Box ref={setNodeRef}>{children}</Box>;
};

const liftScale = () => 1.02;

const RecurringPlanView = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const activeTab = useDragTabStore(s => s.activeTab);
    const setActiveTab = useDragTabStore(s => s.setActiveTab);

    // `?domain=<id>` opens that domain (req #3663: the dev server lands on the
    // change); otherwise the first tab. The store may hold the Plan view's tab.
    const [searchParams] = useSearchParams();
    const linkedDomainId = searchParams.get('domain');
    const linkAppliedRef = useRef(false);

    const { data: domains } = useDomains(profile?.userName, { closed: 0 });
    const { data: allAreas } = useAllAreas(profile?.userName, {
        fields: 'id,area_name,domain_fk,sort_order',
        closed: 0,
    });
    const { data: allDefs, isLoading } = useRecurringTasks(profile?.userName);

    const sortedDomains = useMemo(() => (domains ? [...domains].sort(bySortOrder) : []), [domains]);
    const sortedAreas = useMemo(() => (allAreas ? [...allAreas].sort(bySortOrder) : []), [allAreas]);

    // One array per area, stable until the definitions change — a card re-seeds
    // its local rows whenever its `definitions` prop changes identity.
    const defsByArea = useMemo(() => {
        const map = new Map();
        (allDefs || []).forEach(d => {
            const key = String(d.area_fk);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(d);
        });
        return map;
    }, [allDefs]);
    const NO_DEFS = useMemo(() => [], []);

    // Reset when this view mounts (the store may hold the Plan view's tab)...
    useEffect(() => {
        setActiveTab(0);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // ...then, once the domains are known, honour a linked one.
    useEffect(() => {
        if (!domains) return;
        if (linkAppliedRef.current) return;
        linkAppliedRef.current = true;
        const linked = linkedDomainId ? sortedDomains.findIndex(d => String(d.id) === linkedDomainId) : -1;
        setActiveTab(linked >= 0 ? linked : 0);
    }, [domains]); // eslint-disable-line react-hooks/exhaustive-deps

    // req #3663 — every area card registers its local rows here; the page's
    // one onDragEnd resolves a drop against them.
    const registry = useRef(new Map()).current;
    const dragHandlers = useRecurringDnd({
        registry,
        writeCtx: { darwinUri, idToken, showError },
        invalidateRecurring: () => queryClient.invalidateQueries({ queryKey: recurringTaskKeys.all(profile.userName) }),
    });

    const areasForDomain = (domainId) =>
        sortedAreas.filter(a => String(a.domain_fk) === String(domainId));

    if (!domains || isLoading) return <CircularProgress sx={{ m: 4 }} />;

    return (
        <DarwinListRegistry.Provider value={registry}>
        <DarwinDndContext {...dragHandlers} liftScale={liftScale}>
        <RemeasureOnChange value={activeTab} />
        <Box className="app-content-planpage">
            {/* Domain tabs — a dragged recurring task hovering one switches to it */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }} className="app-content-tabs">
                <DomainStripZone>
                <DarwinSortableList id={recurringIds.domains}
                                    items={sortedDomains.map(d => recurringIds.domain(d.id))}
                                    policy={RECURRING_TABS}>
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
                            domain={domain}
                            domainIndex={idx}
                            isActiveTab={activeTab === idx}
                        />
                    ))}
                </Tabs>
                </DarwinSortableList>
                </DomainStripZone>
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
                                    definitions={defsByArea.get(String(area.id)) ?? NO_DEFS}
                                    panelActive={activeTab === idx}
                                />
                            ))}
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
        </DarwinDndContext>
        </DarwinListRegistry.Provider>
    );
};

export default RecurringPlanView;
