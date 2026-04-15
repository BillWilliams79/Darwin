import React, {useState, useContext, useEffect, useRef, useCallback} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import call_rest_api from '../RestApi/RestApi';
import CategoryCard from './CategoryCard';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useCategories } from '../hooks/useDataQueries';
import { categoryKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';

import CategoryCloseDialog from './CategoryCloseDialog';
import CategoryDeleteDialog from './CategoryDeleteDialog';

import { useDrop } from 'react-dnd';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';

const CategoryTabPanel = ( { project, projectIndex, activeTab, showClosed } ) => {

    const clearDragTabSwitch = useSwarmTabStore(s => s.clearDragTabSwitch);

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [categoriesArray, setCategoriesArray] = useState()

    const showError = useSnackBarStore(s => s.showError);

    // TanStack Query — fetch categories for this project
    const { data: serverCategories } = useCategories(profile?.userName, project.id, {
        closed: showClosed ? undefined : 0,
    });

    // Seed local state from query data
    useEffect(() => {
        if (serverCategories && serverCategories.length > 0) {
            const sorted = [...serverCategories];
            sorted.sort((a, b) => categorySortBySortOrder(a, b));
            let maxSortOrder = sorted.at(-1).sort_order + 1;
            sorted.push({'id':'', 'category_name':'', 'project_fk': project.id, 'closed': 0, 'sort_order': maxSortOrder, 'sort_mode': 'process', });
            setCategoriesArray(sorted);
        } else if (serverCategories && serverCategories.length === 0) {
            setCategoriesArray([{'id':'', 'category_name':'', 'project_fk': project.id, 'sort_order': 1, 'sort_mode': 'process', }]);
        }
    }, [serverCategories]);

    const categoryClose = useConfirmDialog({
        onConfirm: ({ categoryName, categoryId }) => {
            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'PUT', [{'id': categoryId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        if (showClosed) {
                            let newCategoriesArray = categoriesArray.map(cat =>
                                cat.id === categoryId ? { ...cat, closed: 1, sort_order: null } : cat
                            );
                            setCategoriesArray(newCategoriesArray);
                        } else {
                            let newCategoriesArray = [...categoriesArray];
                            newCategoriesArray = newCategoriesArray.filter(cat => cat.id !== categoryId );
                            setCategoriesArray(newCategoriesArray);
                        }
                        queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to close ${categoryName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to close ${categoryName}`)
                });
        }
    });

    const categoryDelete = useConfirmDialog({
        onConfirm: ({ categoryId, categoryName }) => {
            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'DELETE', { 'id': categoryId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newCategoriesArray = [...categoriesArray];
                        newCategoriesArray = newCategoriesArray.filter(cat => cat.id !== categoryId);
                        setCategoriesArray(newCategoriesArray);
                        queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to delete ${categoryName}`);
                    }
                }).catch(error => {
                    showError(error, `Unable to delete ${categoryName}`);
                });
        }
    });

    const updateCategory = (event, categoryIndex, categoryId) => {

        const noop = ()=>{};

        if ((categoryId === '') &&
            (categoriesArray[categoryIndex].category_name === '')) {
            noop();
        } else {
            if (categoryId === '') {
                saveCategory(event, categoryIndex)
            } else {
                let uri = `${darwinUri}/categories`;
                call_rest_api(uri, 'PUT', [{'id': categoryId, 'category_name': categoriesArray[categoryIndex].category_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            showError(result, `Unable to update category name`)
                        }
                    }).catch(error => {
                        showError(error, `Unable to update category name`)
                    });
            }
        }
    }

    const { fieldChange: categoryChange, fieldKeyDown: categoryKeyDown, fieldOnBlur: categoryOnBlur } = useCrudCallbacks({
        items: categoriesArray, setItems: setCategoriesArray, fieldName: 'category_name', saveFn: updateCategory
    });

    const saveCategory = (category, categoryIndex) => {

        let newCategoriesArray = [...categoriesArray];
        let uri = `${darwinUri}/categories`;
        call_rest_api(uri, 'POST', {...newCategoriesArray[categoryIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    newCategoriesArray[categoryIndex] = {...result.data[0]};
                    let newSortOrder = result.data[0].sort_order + 1;
                    newCategoriesArray.push({'id':'', 'category_name':'', 'closed': 0, 'project_fk': project.id, 'sort_order': newSortOrder, 'sort_mode': 'process' });
                    setCategoriesArray(newCategoriesArray);
                    queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                } else if (result.httpStatus.httpStatus === 201) {
                    queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                } else {
                    showError(result, `Unable to save new category`)
                }
            }).catch(error => {
                showError(error, `Unable to save new category`)
            });
    }

    const clickCardClosed = (event, categoryName, categoryId) => {
        if (categoryId !== '') {
            categoryClose.openDialog({ categoryName, categoryId });
        }
    }

    const clickCardDelete = (event, categoryName, categoryId, requirementCount) => {
        if (categoryId !== '') {
            categoryDelete.openDialog({ categoryName, categoryId, requirementCount });
        }
    }

    const categorySortBySortOrder = (a, b) => {
        if (a.sort_order === b.sort_order) return 0;
        if (a.sort_order < b.sort_order) return -1;
        return 1;
    }

    // --- Category card drag-and-drop reordering ---
    const categoriesBeforeDrag = useRef(null);

    const moveCard = useCallback((fromIndex, toIndex) => {
        setCategoriesArray(prev => {
            if (!prev) return prev;
            if (prev[toIndex]?.id === '') return prev;
            if (categoriesBeforeDrag.current === null) {
                categoriesBeforeDrag.current = prev;
            }
            const updated = [...prev];
            const [moved] = updated.splice(fromIndex, 1);
            updated.splice(toIndex, 0, moved);
            return updated;
        });
    }, []);

    const persistCategoryOrder = useCallback((didDrop) => {
        if (!didDrop) {
            if (categoriesBeforeDrag.current) {
                setCategoriesArray(categoriesBeforeDrag.current);
            }
            categoriesBeforeDrag.current = null;
            return;
        }

        categoriesBeforeDrag.current = null;

        setCategoriesArray(prev => {
            if (!prev) return prev;

            const restDataArray = prev
                .filter(cat => cat.id !== '')
                .map((cat, index) => ({ id: cat.id, sort_order: index }));

            const updated = prev.map((cat, index) => {
                if (cat.id !== '') {
                    return { ...cat, sort_order: index };
                }
                return cat;
            });

            // Ensure template is always last
            const templateIdx = updated.findIndex(a => a.id === '');
            if (templateIdx >= 0 && templateIdx !== updated.length - 1) {
                const [tmpl] = updated.splice(templateIdx, 1);
                updated.push(tmpl);
            }

            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'PUT', restDataArray, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        showError(result, 'Unable to save category sort order');
                    }
                }).catch(error => {
                    showError(error, 'Unable to save category sort order');
                });

            return updated;
        });
    }, [darwinUri, idToken]);

    const removeCategory = useCallback((categoryId) => {
        setCategoriesArray(prev => {
            if (!prev) return prev;
            const updated = prev.filter(cat => cat.id !== categoryId);
            const renumbered = updated.map((cat, index) => {
                if (cat.id !== '') {
                    return { ...cat, sort_order: index };
                }
                return cat;
            });

            const restDataArray = renumbered
                .filter(cat => cat.id !== '')
                .map(cat => ({ id: cat.id, sort_order: cat.sort_order }));

            if (restDataArray.length > 0) {
                let uri = `${darwinUri}/categories`;
                call_rest_api(uri, 'PUT', restDataArray, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            showError(result, 'Unable to save category sort order');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to save category sort order');
                    });
            }

            categoriesBeforeDrag.current = null;
            return renumbered;
        });
    }, [darwinUri, idToken]);

    const [, panelDrop] = useDrop(() => ({
        accept: ['categoryCard', 'requirementRow'],
        canDrop: (item, monitor) => {
            if (monitor.getItemType() === 'requirementRow') return true;
            if (item.sourceDomainId) return item.sourceDomainId !== project.id;
            return item.domainId !== project.id;
        },
        hover: (item, monitor) => {
            if (monitor.getItemType() !== 'categoryCard') return;
            if (item.domainId === project.id) return;

            const currentCategories = categoriesArray || [];

            if (currentCategories.find(a => a.id === item.areaId)) {
                if (item.removeFromTarget) item.removeFromTarget();
                item.areaIndex = currentCategories.findIndex(a => a.id === item.areaId);
                item.domainId = project.id;
                item.sourceDomainId = undefined;
                item.removeFromTarget = undefined;
                item.persistInTarget = undefined;
                return;
            }

            const insertIndex = currentCategories.filter(a => a.id !== '').length;

            setCategoriesArray(prev => {
                if (!prev) return prev;
                if (prev.find(a => a.id === item.areaId)) return prev;
                const newCategory = { ...item.areaData, project_fk: project.id, _isAdopted: true };
                const templateIdx = prev.findIndex(a => a.id === '');
                const updated = [...prev];
                if (templateIdx >= 0) {
                    updated.splice(templateIdx, 0, newCategory);
                } else {
                    updated.push(newCategory);
                }
                return updated;
            });

            item.sourceDomainId = item.domainId;
            item.domainId = project.id;
            item.areaIndex = insertIndex;

            item.movePending = true;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    item.movePending = false;
                });
            });

            item.removeFromTarget = () => {
                setCategoriesArray(prev => {
                    if (!prev) return prev;
                    return prev.filter(a => a.id !== item.areaId);
                });
                categoriesBeforeDrag.current = null;
            };

            item.persistInTarget = () => {
                categoriesBeforeDrag.current = null;
                setCategoriesArray(prev => {
                    if (!prev) return prev;
                    const updated = prev.map((a, idx) => {
                        if (a.id === '') return a;
                        const { _isAdopted, ...clean } = a;
                        return { ...clean, sort_order: idx };
                    });

                    const restDataArray = updated
                        .filter(a => a.id !== '')
                        .map(a => ({
                            id: a.id,
                            sort_order: a.sort_order,
                            ...(a.id === item.areaId ? { project_fk: project.id } : {}),
                        }));

                    let uri = `${darwinUri}/categories`;
                    call_rest_api(uri, 'PUT', restDataArray, idToken)
                        .then(result => {
                            if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                                showError(result, 'Unable to move category to project');
                            }
                        }).catch(error => {
                            showError(error, 'Unable to move category to project');
                        });

                    return updated;
                });
            };
        },
        drop: (item, monitor) => {
            if (monitor.didDrop()) return;

            if (monitor.getItemType() === 'requirementRow') {
                return { requirement: null };
            }

            if (!item.persistInTarget) {
                const areaData = item.areaData;
                const newSortOrder = categoriesArray
                    ? Math.max(0, ...categoriesArray.filter(a => a.id !== '').map(a => a.sort_order)) + 1
                    : 0;

                setCategoriesArray(prev => {
                    if (!prev) return prev;
                    const newCategory = { ...areaData, project_fk: project.id, sort_order: newSortOrder };
                    const templateIndex = prev.findIndex(a => a.id === '');
                    const updated = [...prev];
                    if (templateIndex >= 0) {
                        updated.splice(templateIndex, 0, newCategory);
                    } else {
                        updated.push(newCategory);
                    }
                    return updated;
                });

                let uri = `${darwinUri}/categories`;
                call_rest_api(uri, 'PUT', [{ id: areaData.id, project_fk: project.id, sort_order: newSortOrder }], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            showError(result, 'Unable to move category to project');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to move category to project');
                    });
            }

            clearDragTabSwitch();
            return { crossDomain: true };
        },
    }), [project.id, categoriesArray, darwinUri, idToken, clearDragTabSwitch]);

    return (
            <Box key={projectIndex} role="tabpanel" hidden={String(activeTab) !== String(projectIndex)}
                 className="app-content-tabpanel"
                 sx={{ p: 3 }}
            >
                { categoriesArray &&
                    <Box className="card swarm-card" ref={panelDrop}>
                        { categoriesArray.map((category, categoryIndex) => (
                            <CategoryCard {...{key: category.id,
                                           category,
                                           categoryIndex,
                                           projectId: project.id,
                                           categoryChange,
                                           categoryKeyDown,
                                           categoryOnBlur,
                                           clickCardClosed,
                                           clickCardDelete,
                                           moveCard,
                                           persistCategoryOrder: persistCategoryOrder,
                                           removeCategory,
                                           isTemplate: category.id === '',
                                           showClosed,}}/>
                        ))}
                    </Box>
                }
                <CategoryCloseDialog dialogOpen={categoryClose.dialogOpen}
                                 setDialogOpen={categoryClose.setDialogOpen}
                                 closeInfo={categoryClose.infoObject}
                                 setCloseInfo={categoryClose.setInfoObject}
                                 setCloseConfirmed={categoryClose.setConfirmed}
                />
                <CategoryDeleteDialog deleteDialogOpen={categoryDelete.dialogOpen}
                                  setDeleteDialogOpen={categoryDelete.setDialogOpen}
                                  categoryDeleteInfo={categoryDelete.infoObject}
                                  setCategoryDeleteInfo={categoryDelete.setInfoObject}
                                  setDeleteConfirmed={categoryDelete.setConfirmed}
                />
            </Box>
    )
}

export default CategoryTabPanel
