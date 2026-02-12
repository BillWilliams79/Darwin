import { useState, useEffect, useRef } from 'react';

export function useConfirmDialog({ onConfirm, defaultInfo = {}, additionalCleanup }) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [infoObject, setInfoObject] = useState(defaultInfo);

    // Use refs to always call the latest callbacks without stale closures
    const onConfirmRef = useRef(onConfirm);
    onConfirmRef.current = onConfirm;
    const cleanupRef = useRef(additionalCleanup);
    cleanupRef.current = additionalCleanup;

    useEffect(() => {
        if (confirmed === true) {
            onConfirmRef.current(infoObject);
        }
        setConfirmed(false);
        setInfoObject(defaultInfo);
        if (cleanupRef.current) cleanupRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [confirmed]);

    const openDialog = (info) => {
        if (info !== undefined) setInfoObject(info);
        setDialogOpen(true);
    };

    return { dialogOpen, setDialogOpen, confirmed, setConfirmed, infoObject, setInfoObject, openDialog };
}
