import { useState } from 'react';

export function useApiTrigger() {
    const [apiTrigger, setApiTrigger] = useState(false);
    const triggerRefresh = () => setApiTrigger(prev => !prev);
    return [apiTrigger, triggerRefresh];
}
