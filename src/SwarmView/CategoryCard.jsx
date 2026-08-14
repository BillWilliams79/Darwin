import React, { useState, useEffect, useContext, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { STATUS_SORT_PROCESS, requirementActiveSort, requirementHandSort, coerceSortMode } from './processSort';
import RequirementRow from './RequirementRow';
import RequirementDeleteDialog from './RequirementDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useRequirements, useSessions } from '../hooks/useDataQueries';
import { useRequirementVisibility } from '../hooks/useRequirementVisibility';
import { requirementKeys, categoryKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import { useCategoryCountDisplayStore } from '../stores/useCategoryCountDisplayStore';
import { RequirementActionsContext } from '../hooks/useRequirementActions';
import { requirementStatusTimestampFields, requirementStatusTimestampState } from '../utils/requirementStatusTimestamps';
import { filterToEpic } from '../utils/epicMembership';
// req #3503 — the STEP filter's row predicate. Its own module because step
// association is `pipelineMembership.js`' stated domain, not the epic module's.
import { filterToStepReqIds } from '../utils/pipelineMembership';

import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import { useDrop, useDrag } from "react-dnd";

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Check from '@mui/icons-material/Check';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import CloseIcon from '@mui/icons-material/Close';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { CircularProgress } from '@mui/material';

const CategoryCard = ({category, categoryIndex, projectId, categoryChange, categoryKeyDown, categoryOnBlur, clickCardClosed, clickCardDelete, moveCard, persistCategoryOrder, removeCategory, isTemplate, showClosed, epicReqIds = null, stepReqIds = null }) => {

    const revertDragTabSwitch = useSwarmTabStore(s => s.revertDragTabSwitch);

    const navigate = useNavigate();
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [requirementsArray, setRequirementsArray] = useState()
    const [sessionStatusMap, setSessionStatusMap] = useState({});

    const savingRef = useRef(false);
    const pendingMutationsRef = useRef({});
    const sortModePendingRef = useRef(false);
    const sortModeMutationRef = useRef(0);

    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);
    // req #3505 — per-category-card requirement count preference, e.g. "Swarm (17)".
    const showCategoryCount = useCategoryCountDisplayStore(s => s.showCount);
    // req #3428 — is the epic filter on? Used for the drag guard and the
    // suppressed add-row below, and handed to `useRequirementVisibility` so the
    // filter can force the orchestrated toggle off.
    //
    // req #3419 MERGE NOTE: this card no longer reads
    // `hidePipelinedRequirements` or calls `effectiveHidePipelined` itself. Both
    // moved INTO the hook, which is the one place that answers "is this row on
    // screen" for every surface — keeping the override here would have restored
    // exactly the per-surface copy req #3419 removed, one requirement later.
    const epicFilterActive = epicReqIds != null;
    // req #3503 — the same three questions for the step filter. `membershipFilterActive`
    // is what every SCOPE-SHAPED behaviour below reads (the forced toggle, the
    // suppressed add-row, the drag guard, the hide-when-empty rule): each of those
    // is true of "a membership scope is narrowing this card", not of the epic
    // filter specifically. Epic behaviour is bit-identical — `x` becomes
    // `x || false` whenever no step filter is active.
    const stepFilterActive = stepReqIds != null;
    const membershipFilterActive = epicFilterActive || stepFilterActive;

    const showError = useSnackBarStore(s => s.showError);

    const requirementDelete = useConfirmDialog({
        onConfirm: ({ requirementId }) => {
            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'DELETE', {'id': requirementId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newRequirementsArray = [...requirementsArray]
                        newRequirementsArray = newRequirementsArray.filter(p => p.id !== requirementId );
                        setRequirementsArray(newRequirementsArray);
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete requirement')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete requirement')
                });
        }
    });

    // Three live values: 'hand' | 'process' | 'reverse'. `coerceSortMode` is the
    // ONE reading of the column (req #3302) — see its docstring for the two
    // copies that disagreed.
    const [sortMode, setSortMode] = useState(coerceSortMode(category.sort_mode));

    // Status Sort menu item toggles direction when already active: process ↔ reverse.
    // Hand Sort menu item always sets 'hand' directly.
    const changeSortMode = (event, requestedMode) => {
        if (requestedMode === null) return;
        // Block while a previous sort-mode PUT is still in flight — cancelQueries only cancels
        // background refetches, not the mutation itself. Without this guard, two concurrent PUTs
        // race and the server may commit the older value.
        if (sortModePendingRef.current) return;

        // When caller requests 'process' but Status Sort is already in 'process',
        // flip to 'reverse'. When already in 'reverse', flip back to 'process'.
        // 'hand' is always a direct set.
        let newMode = requestedMode;
        if (requestedMode === 'process') {
            if (sortMode === 'process') newMode = 'reverse';
            else if (sortMode === 'reverse') newMode = 'process';
            // else sortMode is 'hand' → newMode stays 'process'
        }
        if (newMode === sortMode) return;  // no-op (shouldn't happen but safe)

        setSortMode(newMode);

        if (requirementsArray) {
            // req #3302 — the SAME comparator every other path uses. This used to
            // call `requirementHandSort` bare for hand mode, skipping the status
            // band that `activeSort` applies, so the order the user saw the
            // instant they picked Hand Sort was not the order the next refetch,
            // status-chip toggle or cross-card drop produced. `newMode`, not
            // `sortMode` — this runs before the state update lands.
            const sorted = [...requirementsArray];
            sorted.sort((a, b) => requirementActiveSort(newMode, a, b));
            setRequirementsArray(sorted);
        }

        if (category.id !== '') {
            // Optimistically update both possible categories cache entries so the new sort_mode
            // survives unmount/remount (e.g. navigating into RequirementDetail and back).
            //
            // Maintenance note: `useQueryKeys.js` also defines `categoryKeys.byProject` (no `closed`
            // filter — effectively `closed=1` only). That key has zero live subscribers today;
            // no caller of `useCategories` passes `closed=1`. If a future "closed categories" view
            // is added, update BOTH (a) the `cancelQueries` calls below and (b) the `setQueryData`
            // optimistic writes below to include `categoryKeys.byProject(...)` alongside
            // `byProjectOpen` / `byProjectWithClosed`.
            const openKey = categoryKeys.byProjectOpen(profile.userName, projectId);
            const allKey  = categoryKeys.byProjectWithClosed(profile.userName, projectId);
            queryClient.cancelQueries({ queryKey: openKey });
            queryClient.cancelQueries({ queryKey: allKey });
            const previousOpen = queryClient.getQueryData(openKey);
            const previousAll  = queryClient.getQueryData(allKey);
            const updateCache = (old) => {
                if (!Array.isArray(old)) return old;
                return old.map(c => c.id === category.id ? { ...c, sort_mode: newMode } : c);
            };
            queryClient.setQueryData(openKey, updateCache);
            queryClient.setQueryData(allKey, updateCache);

            // Defense-in-depth rollback guard: even with sortModePendingRef blocking
            // concurrent entry, a monotonic mutation id on rollback protects the cache
            // if the pending guard is ever bypassed or removed. Skip rollback + toast
            // when a newer invocation has superseded this one (req #2202).
            const mutationId = ++sortModeMutationRef.current;
            const rollback = (errorArg, message) => {
                if (sortModeMutationRef.current !== mutationId) return;
                queryClient.setQueryData(openKey, previousOpen);
                queryClient.setQueryData(allKey, previousAll);
                setSortMode(coerceSortMode(category.sort_mode));
                showError(errorArg, message);
            };

            sortModePendingRef.current = true;
            call_rest_api(`${darwinUri}/categories`, 'PUT', [{ id: category.id, sort_mode: newMode }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        rollback(result, 'Unable to save sort preference');
                    }
                    sortModePendingRef.current = false;
                })
                .catch(error => {
                    rollback(error, 'Unable to save sort preference');
                    sortModePendingRef.current = false;
                });
        }
    };

    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);
    const handleMenuOpen = (event) => setMenuAnchorEl(event.currentTarget);
    const handleMenuClose = () => setMenuAnchorEl(null);

    // Hand-sort drop coordination (req #2417). RequirementRow's hover handler
    // writes the splice target (above-this-row, below-this-row) into this ref;
    // the card-level useDrop reads it on drop and recomputes sort_order.
    const crossCardInsertIndexRef = useRef(null);
    const setCrossCardInsertIndex = useCallback((index) => {
        crossCardInsertIndexRef.current = index;
    }, []);

    // TanStack Query — fetch all requirements for this category (client-side filtering via chips)
    const { data: serverRequirements } = useRequirements(profile?.userName, category.id, {
        enabled: category.id !== '',
    });

    // TanStack Query — fetch sessions for status badges
    const { data: serverSessions } = useSessions(profile?.userName, {
        enabled: category.id !== '',
    });

    // req #3419 — THE visibility answer, identical on every browse surface
    // (Table view, the aggregator card, the detail page's up/down elevator).
    // This card derives nothing of its own: `filterVisible` IS the rule, and it
    // covers step-carried AND epic-filed work (req #3258 covered only the first,
    // which is the defect req #3419 fixes).
    // `orchestratedIds` is the SAME set `filterVisible` hides by — it is handed
    // to the rows so an orchestrated requirement can be MARKED (gold title box,
    // req #3419) when the toggle is showing them. Marking and hiding must never
    // become two answers to one question.
    const { filterVisible, orchestratedIds } = useRequirementVisibility(
        profile?.userName, { epicFilterActive, stepFilterActive });

    // Seed local state from query data (hybrid pattern — local state owns template row).
    //
    // The template row (id === '') is a local-only construct, never sourced from
    // the server. A background refetch (refetchOnWindowFocus / cache invalidation)
    // changes `serverRequirements` by reference and re-runs this effect at
    // user-uncontrolled times. Building a *fresh* empty template each time would
    // discard whatever the user has typed/toggled into the template but not yet
    // saved. Carry the existing template forward instead so in-progress add-row
    // edits survive a re-seed (req #2747).
    useEffect(() => {
        const buildTemplate = (prev) => {
            const prevTemplate = prev && prev.find(r => r.id === '');
            return prevTemplate
                ? { ...prevTemplate, category_fk: parseInt(category.id) }
                : { id: '', title: '', requirement_status: 'authoring', category_fk: parseInt(category.id) };
        };
        if (serverRequirements && serverRequirements.length > 0) {
            let sortedRequirementsArray = [...serverRequirements];

            // Client-side filtering based on requirement status chips (direct match)
            sortedRequirementsArray = sortedRequirementsArray.filter(p =>
                requirementStatusFilter.includes(p.requirement_status)
            );

            // req #3419 — THE shared predicate, not a local copy. Returns the
            // same array when nothing is dropped (toggle off, or reads still in
            // flight), so this costs nothing on the off path.
            // `sortedRequirementsArray` is already this effect's private copy,
            // and `filterVisible` returns either it or a fresh `.filter` result —
            // both private, so the in-place sort below is safe.
            sortedRequirementsArray = filterVisible(sortedRequirementsArray);

            // req #3428 — the epic filter, applied exactly where the status chips
            // and the pipeline toggle are. A no-op (same array reference) when
            // `epicReqIds` is null, same as the two above when they are off.
            sortedRequirementsArray = filterToEpic(sortedRequirementsArray, epicReqIds);

            // req #3503 — the STEP filter, applied in series after the epic's. A
            // no-op (same array reference) when `stepReqIds` is null, so an
            // epic-filtered or unfiltered card pays nothing; when both are on,
            // the survivors are the intersection, which is what two independent
            // filters on one page must mean.
            sortedRequirementsArray = filterToStepReqIds(sortedRequirementsArray, stepReqIds);

            sortedRequirementsArray.sort((a, b) => activeSort(a, b));
            // THE ADD-A-REQUIREMENT ROW IS SUPPRESSED WHILE FILTERED. A row saved
            // there starts seated on no step, so it belongs to no epic and would
            // vanish from this card the instant it saved — a control whose result
            // the reader cannot see. It comes back with the filter's dismissal.
            setRequirementsArray(prev => membershipFilterActive
                ? sortedRequirementsArray
                : [...sortedRequirementsArray, buildTemplate(prev)]);
        } else if (serverRequirements && serverRequirements.length === 0) {
            setRequirementsArray(prev => membershipFilterActive ? [] : [buildTemplate(prev)]);
        }
    }, [serverRequirements, requirementStatusFilter, filterVisible, epicReqIds, stepReqIds, membershipFilterActive]);

    // Build session status map from query data
    useEffect(() => {
        if (serverSessions && serverSessions.length > 0) {
            const map = {};
            serverSessions.forEach(s => {
                const m = s.source_ref && s.source_ref.match(/^(priority|requirement):(\d+)$/);
                if (m) {
                    const pid = parseInt(m[2]);
                    if (!map[pid] || s.id > map[pid].id) {
                        map[pid] = { id: s.id, swarm_status: s.swarm_status };
                    }
                }
            });
            // Flatten to string values for consumers (RequirementRow)
            const flatMap = {};
            for (const [k, v] of Object.entries(map)) {
                flatMap[k] = v.swarm_status;
            }
            setSessionStatusMap(flatMap);
        }
    }, [serverSessions]);

    // For template cards (category.id === ''), keep requirementsArray undefined
    useEffect(() => {
        if (category.id === '' && !requirementsArray) {
            setRequirementsArray(undefined);
        }
    }, [category.id]);

    // Drop handler for `requirementRow` items landing on THIS category card
    // (req #2417). Two branches:
    //
    //   Same-card  — dragItem.id is already in this card's requirementsArray.
    //                Splices to the hovered insert position and bulk-PUTs new
    //                sort_order values. Gated on sortMode === 'hand' (process /
    //                reverse never reorders within a card).
    //
    //   Cross-card — dragItem.id is NOT in this card's requirementsArray. The
    //                requirement is moved here (PUT category_fk). If THIS card
    //                is in hand mode AND the user hovered a target row (giving
    //                us an insertIndex), the target sort_order map is rebuilt
    //                so the moved row lands at that position; otherwise the
    //                row is appended (no sort_order shuffle).
    //
    // On any PUT failure we restore both local state AND the TanStack cache
    // snapshots (mirrors statusClick / coordinationClick).
    const addRequirementToCategory = (dragItem) => {
        const insertIndex = crossCardInsertIndexRef.current;
        crossCardInsertIndexRef.current = null;

        const draggedIdx = requirementsArray.findIndex(t => t.id === dragItem.id);
        const isSameCard = draggedIdx !== -1;

        const prefix = requirementKeys.all(profile.userName);
        queryClient.cancelQueries({ queryKey: prefix });
        const snapshots = queryClient.getQueriesData({ queryKey: prefix });
        const revertCaches = () => {
            for (const [key, data] of snapshots) {
                queryClient.setQueryData(key, data);
            }
        };
        const previousArray = requirementsArray;
        const failPut = (errOrResult, message) => {
            revertCaches();
            setRequirementsArray(previousArray);
            showError(errOrResult, message);
        };

        // ---------- Same-card branch ----------
        if (isSameCard) {
            if (sortMode !== 'hand') return { requirement: null, crossCard: false };
            if (insertIndex === null) return { requirement: null, crossCard: false };

            const adjustedIndex = insertIndex > draggedIdx ? insertIndex - 1 : insertIndex;
            if (adjustedIndex === draggedIdx) return { requirement: null, crossCard: false };

            const updated = [...requirementsArray];
            const [moved] = updated.splice(draggedIdx, 1);
            updated.splice(adjustedIndex, 0, moved);

            const bulkUpdate = [];
            const reordered = updated.map((t, idx) => {
                if (t.id === '') return t;
                bulkUpdate.push({ id: t.id, sort_order: idx });
                return { ...t, sort_order: idx };
            });

            const updatesById = {};
            bulkUpdate.forEach(u => { updatesById[u.id] = u.sort_order; });
            queryClient.setQueriesData({ queryKey: prefix }, (old) => {
                if (!Array.isArray(old)) return old;
                if (!old.some(r => r.id in updatesById)) return old;
                return old.map(r => r.id in updatesById ? { ...r, sort_order: updatesById[r.id] } : r);
            });

            setRequirementsArray(reordered);

            if (bulkUpdate.length > 0) {
                call_rest_api(`${darwinUri}/requirements`, 'PUT', bulkUpdate, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            failPut(result, 'Unable to save requirement sort order');
                        }
                    }).catch(error => failPut(error, 'Unable to save requirement sort order'));
            }
            return { requirement: dragItem.id, crossCard: false };
        }

        // ---------- Cross-card branch ----------
        const targetCategoryId = parseInt(category.id);
        // Strip drag-transport-only fields so the cache slice stays
        // shape-identical to server-sourced rows.
        const { requirementIndex: _ridx, sourceWidth: _sw, sourceHeight: _sh,
                ...requirementFields } = dragItem;
        const movedRow = {
            ...requirementFields,
            category_fk: targetCategoryId,
        };

        let bulkUpdate;
        let updatedTargetArray;

        if (sortMode === 'hand') {
            // Insert at the hovered position, or append when no row hover.
            const realRows = requirementsArray.filter(t => t.id !== '');
            const template = requirementsArray.find(t => t.id === '');
            const clampedIndex = insertIndex === null
                ? realRows.length
                : Math.min(Math.max(insertIndex, 0), realRows.length);
            const inserted = [...realRows];
            inserted.splice(clampedIndex, 0, movedRow);

            bulkUpdate = inserted.map((t, idx) => {
                const update = { id: t.id, sort_order: idx };
                if (t.id === movedRow.id) update.category_fk = targetCategoryId;
                return update;
            });
            const reorderedReal = inserted.map((t, idx) => ({ ...t, sort_order: idx }));
            updatedTargetArray = template ? [...reorderedReal, template] : reorderedReal;
        } else {
            // Process / reverse: append, do not touch sort_order.
            bulkUpdate = [{ id: movedRow.id, category_fk: targetCategoryId }];
            const realRows = requirementsArray.filter(t => t.id !== '');
            const template = requirementsArray.find(t => t.id === '');
            const appended = [...realRows, movedRow];
            updatedTargetArray = template ? [...appended, template] : appended;
        }

        // Cache write-through: route each slice deliberately based on its key.
        //
        //   byCategory(source)          → filter out (row moved away)
        //   byCategory(target)          → add (with new category_fk)
        //   byStatus / useAllRequirements / done → if the slice already had the
        //                                  row, REPLACE it in place so the row's
        //                                  category_fk updates without changing
        //                                  the caller's local sort. (This is
        //                                  what the aggregator's swarm_ready
        //                                  cache needs — the row should stay
        //                                  visible after a cross-category move.)
        //   any other category slice    → leave alone (row was never there).
        //
        // TanStack Query v5's setQueriesData updater receives only `oldData`
        // (no query / queryKey arg), so we iterate the cache manually to keep
        // per-slice key inspection.
        const sourceCategoryId = parseInt(dragItem.category_fk);
        const queries = queryClient.getQueryCache().findAll({ queryKey: prefix });
        for (const q of queries) {
            const old = q.state.data;
            if (!Array.isArray(old)) continue;
            const filterObj = q.queryKey.find(k => typeof k === 'object' && k !== null);
            const sliceCategoryId = filterObj && 'categoryId' in filterObj
                ? parseInt(filterObj.categoryId)
                : undefined;
            const hadRow = old.some(r => r.id === movedRow.id);

            let next = old;
            if (sliceCategoryId !== undefined) {
                if (sliceCategoryId === sourceCategoryId) {
                    next = hadRow ? old.filter(r => r.id !== movedRow.id) : old;
                } else if (sliceCategoryId === targetCategoryId) {
                    next = [...old.filter(r => r.id !== movedRow.id), movedRow];
                }
                // else: leave alone (row was never in this category's slice)
            } else if (hadRow) {
                next = old.map(r => r.id === movedRow.id ? movedRow : r);
            }
            if (next !== old) queryClient.setQueryData(q.queryKey, next);
        }

        setRequirementsArray(updatedTargetArray);

        call_rest_api(`${darwinUri}/requirements`, 'PUT', bulkUpdate, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    failPut(result, 'Unable to move requirement to category');
                }
            }).catch(error => failPut(error, 'Unable to move requirement to category'));

        return { requirement: dragItem.id, crossCard: true };
    };

    const [{ isOver }, drop] = useDrop(() => ({

        accept: ["requirementRow", "categoryCard"],

        drop: (item, monitor) => {
            if (monitor.getItemType() === "requirementRow") {
                return addRequirementToCategory(item);
            }
            if (item.sourceDomainId && item.sourceDomainId !== projectId) {
                return { crossDomain: true };
            }
        },

        hover: (item, monitor) => {
            if (monitor.getItemType() !== "categoryCard") return;
            if (item.domainId !== projectId) return;
            if (isTemplate) return;
            const dragIndex = item.areaIndex;
            const hoverIndex = categoryIndex;
            if (dragIndex === hoverIndex) {
                item.settled = true;
                return;
            }

            if (item.movePending) return;
            if (item.settled === false) return;

            moveCard(dragIndex, hoverIndex);
            item.areaIndex = hoverIndex;
            item.settled = false;

            item.movePending = true;
            setTimeout(() => {
                item.movePending = false;
            }, 150);
        },

        collect: (monitor) => ({
            isOver: monitor.isOver() && monitor.getItemType() === "categoryCard",
        }),

    }), [requirementsArray, sortMode, category.id, categoryIndex, projectId, isTemplate, moveCard, darwinUri, idToken]);

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "categoryCard",
        item: () => ({ areaId: category.id, areaIndex: categoryIndex, domainId: projectId, areaData: { ...category } }),
        // req #3428 — NO REORDERING UNDER A FILTER. `moveCard` and
        // `persistCategoryOrder` index into the FULL `categoriesArray` and write
        // `sort_order` from those indices, while the reader is looking at a
        // subset of the cards — so a drag here writes positions computed against
        // neighbours they cannot see. Same reasoning req #3258 gave for hiding
        // orchestrated rows: the ordering is not this view's to set right now.
        canDrag: () => !isTemplate && !membershipFilterActive,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
        end: (item, monitor) => {
            const dropResult = monitor.getDropResult();
            if (dropResult && dropResult.crossDomain) {
                if (item.persistInTarget) item.persistInTarget();
                removeCategory(item.areaId);
            } else {
                if (item.removeFromTarget) item.removeFromTarget();
                persistCategoryOrder(monitor.didDrop());
                revertDragTabSwitch();
            }
        },
    }), [category, categoryIndex, projectId, isTemplate, persistCategoryOrder, removeCategory, revertDragTabSwitch, membershipFilterActive]);

    const cardRef = useRef(null);
    const mergedRef = useCallback((node) => {
        cardRef.current = node;
        drag(drop(node));
    }, [drag, drop]);

    // Optimistically apply `updates` to every requirement cache for this creator
    // (byCategory, byStatus, done, etc.) so downstream views — including the
    // Visualizer's `useRequirementsDone` cache (req #2381) — reflect the mutation
    // without waiting for a refetch. Returns a revert fn that restores every
    // snapshot captured before the write.
    //
    // The updater returns the same `old` reference when no row matches `requirementId`,
    // so unrelated caches (e.g. counts aggregates) don't trigger spurious re-renders.
    const writeThroughRequirementCaches = (requirementId, updates) => {
        const prefix = requirementKeys.all(profile.userName);
        queryClient.cancelQueries({ queryKey: prefix });
        const snapshots = queryClient.getQueriesData({ queryKey: prefix });
        queryClient.setQueriesData({ queryKey: prefix }, (old) => {
            if (!Array.isArray(old)) return old;
            if (!old.some(r => r.id === requirementId)) return old;
            return old.map(r => r.id === requirementId ? { ...r, ...updates } : r);
        });
        return () => {
            for (const [key, data] of snapshots) {
                queryClient.setQueryData(key, data);
            }
        };
    };

    const STATUS_CYCLE = ['authoring', 'approved', 'swarm_ready'];
    const statusClick = (requirementIndex, requirementId) => {
        const currentRow = requirementsArray[requirementIndex];
        const current = currentRow.requirement_status;
        const idx = STATUS_CYCLE.indexOf(current);
        if (idx === -1) return; // not a cycleable status (development/met/deferred)
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
        // req #3244 — every requirement_status write re-derives all three status
        // timestamps, matching darwin-mcp's update_requirement, so this UI path
        // never leaves a stale started_at/completed_at/deferred_at behind. One `now`
        // shared between the PUT body and the local-state form so they can't drift.
        const now = new Date().toISOString();
        const timestampState = requirementStatusTimestampState(next, now);
        const timestampFields = requirementStatusTimestampFields(next, now);
        const previousTimestamps = {
            started_at: currentRow.started_at,
            completed_at: currentRow.completed_at,
            deferred_at: currentRow.deferred_at,
        };

        if (requirementId !== '') {
            // Optimistic write-through across every requirement cache (req #2381).
            // Snapshot BEFORE any local-state mutation: requirementsArray and the cache
            // share object references (useEffect seeds from serverRequirements via shallow
            // copy), so in-place mutation would poison the snapshot.
            const revert = writeThroughRequirementCaches(requirementId, { requirement_status: next, ...timestampState });

            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'PUT', [{'id': requirementId, 'requirement_status': next, ...timestampFields}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        revert();
                        setRequirementsArray(prev => prev.map(r =>
                            r.id === requirementId ? { ...r, requirement_status: current, ...previousTimestamps } : r));
                        showError(result, "Unable to change requirement status");
                    }
                }).catch(error => {
                    revert();
                    setRequirementsArray(prev => prev.map(r =>
                        r.id === requirementId ? { ...r, requirement_status: current, ...previousTimestamps } : r));
                    showError(error, "Unable to change requirement status");
                });
        } else if (savingRef.current) {
            // pendingMutationsRef feeds a raw PUT body (see saveRequirement below), so it
            // needs the 'NULL' sentinel form, not the null-bearing local-state form.
            pendingMutationsRef.current.requirement_status = next;
            Object.assign(pendingMutationsRef.current, timestampFields);
        }
        // Immutable update — new object at the target index rather than in-place mutation
        // on a cache-shared object reference (see snapshot comment above).
        setRequirementsArray(prev => prev.map((r, i) =>
            i === requirementIndex ? { ...r, requirement_status: next, ...timestampState } : r));
    }

    // Autonomy is mandatory (req #2745) — no null/empty state. Cycling a legacy
    // unset requirement (indexOf === -1) advances to the first value, 'discuss'.
    const COORD_CYCLE = ['discuss', 'planned', 'implemented', 'deployed'];
    const coordinationClick = (requirementIndex, requirementId) => {
        const current = requirementsArray[requirementIndex].coordination_type || null;
        const idx = COORD_CYCLE.indexOf(current);
        const next = COORD_CYCLE[(idx + 1) % COORD_CYCLE.length];

        if (requirementId !== '') {
            // Write-through to every requirement cache (req #2381) — see statusClick
            // for snapshot-ordering rationale.
            const revert = writeThroughRequirementCaches(requirementId, { coordination_type: next });

            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'PUT', [{'id': requirementId, 'coordination_type': next}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        revert();
                        setRequirementsArray(prev => prev.map(r =>
                            r.id === requirementId ? { ...r, coordination_type: current } : r));
                        showError(result, "Unable to change autonomy");
                    }
                }).catch(error => {
                    revert();
                    setRequirementsArray(prev => prev.map(r =>
                        r.id === requirementId ? { ...r, coordination_type: current } : r));
                    showError(error, "Unable to change autonomy");
                });
        } else if (savingRef.current) {
            pendingMutationsRef.current.coordination_type = next;
        }
        setRequirementsArray(prev => prev.map((r, i) =>
            i === requirementIndex ? { ...r, coordination_type: next } : r));
    }

    const updateRequirement = (event, requirementIndex, requirementId) => {

        const noop = ()=>{};

        if ((requirementId === '') &&
            (requirementsArray[requirementIndex].title === '')) {
            noop();
        } else {
            if (requirementId === '') {
                saveRequirement(event, requirementIndex)
            } else {
                let uri = `${darwinUri}/requirements`;
                call_rest_api(uri, 'PUT', [{'id': requirementId, 'title': requirementsArray[requirementIndex].title}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            showError(result, 'Requirement title not updated, HTTP error')
                        }
                    }).catch(error => {
                        showError(error, 'Requirement title not updated, HTTP error')
                    });
            }
        }
    }

    const { fieldChange: titleChange, fieldKeyDown: titleKeyDown, fieldOnBlur: titleOnBlur } = useCrudCallbacks({
        items: requirementsArray, setItems: setRequirementsArray, fieldName: 'title', saveFn: updateRequirement
    });

    const saveRequirement = (event, requirementIndex) => {
        if (savingRef.current) return;
        savingRef.current = true;

        const requirementToSave = { ...requirementsArray[requirementIndex], project_fk: null };

        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'POST', requirementToSave, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    let newRequirementsArray = [...requirementsArray];
                    newRequirementsArray[requirementIndex] = {...result.data[0]};

                    const pending = pendingMutationsRef.current;
                    if (Object.keys(pending).length > 0) {
                        // pending is a raw PUT body — its 'NULL' sentinels must not leak into
                        // displayed local state, where a cleared column is a real `null`.
                        const displayPending = Object.fromEntries(
                            Object.entries(pending).map(([k, v]) => [k, v === 'NULL' ? null : v]));
                        Object.assign(newRequirementsArray[requirementIndex], displayPending);
                        call_rest_api(uri, 'PUT', [{'id': result.data[0].id, ...pending}], idToken)
                            .then(putResult => {
                                if (putResult.httpStatus.httpStatus !== 200 && putResult.httpStatus.httpStatus !== 204) {
                                    showError(putResult, 'Unable to update requirement after save');
                                }
                            }).catch(putError => {
                                showError(putError, 'Unable to update requirement after save');
                            });
                    }

                    newRequirementsArray.sort((a, b) => activeSort(a, b));
                    newRequirementsArray.push({'id':'', 'title':'', 'requirement_status': 'authoring', 'category_fk': category.id });
                    setRequirementsArray(newRequirementsArray);
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    navigate(`/swarm/requirement/${result.data[0].id}`);
                } else if (result.httpStatus.httpStatus === 201) {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                } else {
                    showError(result, 'Requirement not saved, HTTP error')
                }
            }).catch(error => {
                showError(error, 'Requirement not saved, HTTP error')
            }).finally(() => {
                savingRef.current = false;
                pendingMutationsRef.current = {};
            });
    }

    const deleteClick = (event, requirementId) => {
        const requirement = requirementsArray?.find(p => p.id === requirementId);
        requirementDelete.openDialog({
            requirementId,
            title: requirement?.title || '',
            coordination_type: requirement?.coordination_type || null,
            requirement_status: requirement?.requirement_status || 'authoring',
        });
    }

    // req #3302 — THE sort lives in ./processSort as `requirementActiveSort`.
    // This was a local copy, and `changeSortMode` used a THIRD ordering that
    // skipped the status band, so picking Hand Sort ordered the rows one way and
    // the next refetch / chip toggle / cross-card drop re-ordered them another.
    // One implementation now, called by every path that orders this card.
    const activeSort = (a, b) => requirementActiveSort(sortMode, a, b);

    // req #3505 — real requirement count, excluding the local-only template
    // add-row (`id === ''`). Shared by the optional " (N)" title suffix below
    // and the delete-category confirmation, which used to compute this itself.
    const requirementCount = requirementsArray ? requirementsArray.filter(t => t.id !== '').length : 0;

    // req #3428 — "only the categories that have requirements from the epic".
    // The card that has none renders NOTHING, decided here because this component
    // already owns that category's requirement list; asking the panel above would
    // mean a per-category fan-out or a new aggregate read to learn something one
    // card already knows.
    //
    // `undefined` (the read has not landed) counts as empty ON PURPOSE: showing
    // the loading spinner would flash a full grid of cards that then collapses to
    // two. The card appears when it has something to show.
    //
    // The "add new category" template card needs no rule of its own — it holds no
    // requirements at all, so this removes it, which is the tell that the rule is
    // the right one.
    if (membershipFilterActive && (!requirementsArray || requirementsArray.length === 0)) return null;

    return (
        <Card key={categoryIndex} raised={true} ref={mergedRef}
              data-testid={category.id === '' ? 'category-card-template' : `category-card-${category.id}`}
              sx={{
                  opacity: isDragging ? 0.3 : category._isAdopted ? 0.5 : 1,
                  cursor: isTemplate ? 'default' : 'grab',
                  border: isOver && !isDragging ? '2px solid' : '2px solid transparent',
                  borderColor: isOver && !isDragging ? 'primary.main' : 'transparent',
              }}>
            {/* req #3064 — CardContent defaults to 16px left/right padding; trimming
                it (-15% left, -33% right) widens the requirement display area. The
                Title column is the row's only `1fr` grid track, so the reclaimed
                space flows straight into it with no other layout change. */}
            <CardContent sx={{ pl: '13.6px', pr: '10.7px' }}>
                <Box className="card-header" sx={{marginBottom: 2, minHeight: '44px'}}>
                    <TextField
                                variant="standard"
                                value={category.category_name || ''}
                                name='category-name'
                                placeholder={category.id === '' ? 'Add new category' : undefined}
                                onChange= { (event) => categoryChange(event, categoryIndex) }
                                onKeyDown = {(event) => categoryKeyDown(event, categoryIndex, category.id)}
                                onBlur = {(event) => categoryOnBlur(event, categoryIndex, category.id)}
                                multiline
                                autoComplete='off'
                                size = 'small'
                                sx={{
                                    ...(category.color && { borderLeft: `4px solid ${category.color}`, pl: 1 }),
                                }}
                                slotProps={{
                                    input: {...((category.id !== '') ? {disableUnderline: true} : (category.category_name !== '') && {disableUnderline: true} ), style: {fontSize: 24}},
                                    htmlInput: { maxLength: 128 }
                                }}
                                key={`category-${category.id}`}
                     />
                    {/* req #3505 — optional requirement count suffix, e.g. "(17)". A
                        sibling of the TextField, never inside its `value`, so it can
                        never be typed into or saved as part of the category name.
                        Suppressed on the template "Add new category" card, which
                        holds no requirements. The aggregator (Swarm-Start) card is a
                        different component and is never touched here. Gated on
                        `requirementsArray` (not just `category.id !== ''`) so the
                        count never flashes "(0)" while the requirements query is
                        still in flight — that would be indistinguishable from a
                        genuinely empty category, which is a real, distinct value. */}
                    {category.id !== '' && showCategoryCount && requirementsArray && (
                        <Typography
                            data-testid={`category-count-${category.id}`}
                            sx={{ fontSize: 24, color: 'text.secondary', whiteSpace: 'nowrap' }}
                        >
                            ({requirementCount})
                        </Typography>
                    )}
                    {category.id !== '' && (
                        <>
                            <IconButton
                                onClick={handleMenuOpen}
                                aria-label="Category card menu"
                                data-testid={`card-menu-${category.id}`}
                                size="small"
                                sx={{ maxWidth: "25px", maxHeight: "25px" }}
                            >
                                <MoreVertIcon />
                            </IconButton>
                            <Menu
                                anchorEl={menuAnchorEl}
                                open={menuOpen}
                                onClose={handleMenuClose}
                                data-testid={`card-menu-popup-${category.id}`}
                                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            >
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'process'); }}
                                    data-testid={`sort-process-${category.id}`}
                                >
                                    <ListItemIcon><AccountTreeIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Status Sort</ListItemText>
                                    {sortMode === 'process' && (
                                        <ArrowUpwardIcon
                                            fontSize="small"
                                            sx={{ ml: 1 }}
                                            data-testid={`sort-direction-asc-${category.id}`}
                                        />
                                    )}
                                    {sortMode === 'reverse' && (
                                        <ArrowDownwardIcon
                                            fontSize="small"
                                            sx={{ ml: 1 }}
                                            data-testid={`sort-direction-desc-${category.id}`}
                                        />
                                    )}
                                </MenuItem>
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'hand'); }}
                                    data-testid={`sort-hand-${category.id}`}
                                >
                                    <ListItemIcon><SwapVertIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Hand Sort</ListItemText>
                                    {sortMode === 'hand' && <Check fontSize="small" sx={{ ml: 1 }} />}
                                </MenuItem>
                                <Divider />
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); clickCardClosed(event, category.category_name, category.id); }}
                                    data-testid={`menu-close-category-${category.id}`}
                                >
                                    <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Close Category</ListItemText>
                                </MenuItem>
                                <Divider />
                                <MenuItem
                                    onClick={(event) => {
                                        handleMenuClose();
                                        clickCardDelete(event, category.category_name, category.id, requirementCount);
                                    }}
                                    data-testid={`menu-delete-category-${category.id}`}
                                    sx={{ color: 'error.main' }}
                                >
                                    <ListItemIcon><DeleteForeverIcon fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
                                    <ListItemText>Delete Category</ListItemText>
                                </MenuItem>
                            </Menu>
                        </>
                    )}
                </Box>
                { (requirementsArray) ?
                    <RequirementActionsContext.Provider value={{ statusClick, coordinationClick,
                        titleChange, titleKeyDown, titleOnBlur, deleteClick, requirementsArray, setRequirementsArray,
                        sessionStatusMap, sortMode, setCrossCardInsertIndex, orchestratedIds,
                        dragDisabled: membershipFilterActive }}>
                        {requirementsArray.map((requirement, requirementIndex) => (
                            <RequirementRow {...{key: requirement.id, requirement, requirementIndex,
                                categoryId: category.id, categoryName: category.category_name }}
                            />
                        ))}
                    </RequirementActionsContext.Provider>
                  :
                    category.id  === '' ? '' : <CircularProgress/>
                }
            </CardContent>
            <RequirementDeleteDialog deleteDialogOpen = {requirementDelete.dialogOpen}
                              setDeleteDialogOpen = {requirementDelete.setDialogOpen}
                              setDeleteId = {requirementDelete.setInfoObject}
                              setDeleteConfirmed = {requirementDelete.setConfirmed}
                              requirement = {requirementDelete.infoObject} />
        </Card>
    )
}

export default CategoryCard
