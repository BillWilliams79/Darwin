import React, {useState, useContext, useEffect, useRef, useCallback} from 'react';
import call_rest_api from '../RestApi/RestApi';
import CategoryCard from './CategoryCard';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useApiTrigger } from '../hooks/useApiTrigger';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';

import CategoryCloseDialog from './CategoryCloseDialog';
import CategoryDeleteDialog from './CategoryDeleteDialog';

import { useDrop } from 'react-dnd';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';

const CategoryTabPanel = ( { project, projectIndex, activeTab } ) => {

    const clearDragTabSwitch = useSwarmTabStore(s => s.clearDragTabSwitch);

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [categoriesArray, setCategoriesArray] = useState()
    const [categoryApiTrigger, triggerCategoryRefresh] = useApiTrigger();

    const showError = useSnackBarStore(s => s.showError);

    const categoryClose = useConfirmDialog({
        onConfirm: ({ categoryName, categoryId }) => {
            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'PUT', [{'id': categoryId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newCategoriesArray = [...categoriesArray];
                        newCategoriesArray = newCategoriesArray.filter(cat => cat.id !== categoryId );
                        setCategoriesArray(newCategoriesArray);
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
                    } else {
                        showError(result, `Unable to delete ${categoryName}`);
                    }
                }).catch(error => {
                    showError(error, `Unable to delete ${categoryName}`);
                });
        }
    });

    // READ categories for this project
    useEffect( () => {

        let categoryUri = `${darwinUri}/categories?creator_fk=${profile.userName}&closed=0&project_fk=${project.id}&fields=id,category_name,project_fk,sort_order,sort_mode,creator_fk`;

        call_rest_api(categoryUri, 'GET', '', idToken)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    result.data.sort((a,b) => categorySortBySortOrder(a, b));
                    let maxSortOrder = result.data.at(-1).sort_order + 1
                    result.data.push({'id':'', 'category_name':'', 'project_fk': project.id, 'closed': 0, 'sort_order': maxSortOrder, 'sort_mode': 'priority', 'creator_fk': profile.userName, });
                    setCategoriesArray(result.data);

                } else {
                    showError(result, 'Unable to read Category data')
                }

            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {
                    setCategoriesArray([{'id':'', 'category_name':'', 'project_fk': project.id, 'sort_order': 1, 'sort_mode': 'priority', 'creator_fk': profile.userName, }]);
                } else {
                    showError(error, 'Unable to read Category data')
                }
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryApiTrigger]);

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
                    newCategoriesArray.push({'id':'', 'category_name':'', 'closed': 0, 'project_fk': project.id, 'creator_fk': profile.userName, 'sort_order': newSortOrder });
                    setCategoriesArray(newCategoriesArray);
                } else if (result.httpStatus.httpStatus === 201) {
                    triggerCategoryRefresh();
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

    const clickCardDelete = (event, categoryName, categoryId, priorityCount) => {
        if (categoryId !== '') {
            categoryDelete.openDialog({ categoryName, categoryId, priorityCount });
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
        accept: ['categoryCard', 'priorityRow'],
        canDrop: (item, monitor) => {
            if (monitor.getItemType() === 'priorityRow') return true;
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

            if (monitor.getItemType() === 'priorityRow') {
                return { priority: null };
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
                                           isTemplate: category.id === '',}}/>
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
