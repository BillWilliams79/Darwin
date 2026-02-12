import { createContext, useContext } from 'react';

export const TaskActionsContext = createContext(null);
export const useTaskActions = () => useContext(TaskActionsContext);
