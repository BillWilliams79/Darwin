import { createContext, useContext } from 'react';

export const RequirementActionsContext = createContext(null);
export const useRequirementActions = () => useContext(RequirementActionsContext);
