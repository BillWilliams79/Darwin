import { createContext, useContext } from 'react';

export const PriorityActionsContext = createContext(null);
export const usePriorityActions = () => useContext(PriorityActionsContext);
