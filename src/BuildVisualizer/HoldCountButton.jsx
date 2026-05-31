// Hold-to-count button (req #2737).
//
// A quick CLICK → onExecute(1). Press and HOLD → the count starts at 2 and
// steps up by one every `dwellMs` (discrete dwell), capped at `maxQty`. The
// fill sweeps left→right and release runs onExecute(count).
//
// Every value gets an EQUAL dwell window, so 2 and 3 are just as easy to land
// on as any larger number. Two timing knobs, both set by the caller (req #2741
// — builds and branches now pass the SAME values; only `maxQty` differs):
//   • `startDelayMs` — hold this long before the count leaves 1 (also the
//     click-vs-hold threshold: a shorter press is a plain click → count 1).
//   • `dwellMs` — the dwell window per subsequent count (2→3→4…).

import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { holdCount } from './holdCountFormula';

export default function HoldCountButton({
    label,
    onExecute,
    maxQty = 14,
    dwellMs = 562.5,
    startDelayMs = 400,
    'data-testid': testId,
}) {
    const [fill, setFill] = useState(0);
    const [qty, setQty] = useState(1);
    const holdingRef = useRef(false);
    const startRef = useRef(0);
    const rafRef = useRef(0);
    const qtyRef = useRef(1);
    // Read onExecute from a ref so onUp's identity is stable — otherwise a prop
    // change mid-hold would orphan the window mouseup listener and drop the
    // release (the listener added on mousedown wouldn't match cleanup).
    const onExecuteRef = useRef(onExecute);
    useEffect(() => { onExecuteRef.current = onExecute; }, [onExecute]);

    // Time from count 2 (at startDelayMs) to maxQty — used to drive the fill.
    const rampMs = Math.max(1, maxQty - 2) * dwellMs;

    const stop = useCallback(() => {
        holdingRef.current = false;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
    }, []);

    const onUp = useCallback(() => {
        if (!holdingRef.current) return;
        stop();
        const q = qtyRef.current;
        setFill(0);
        setQty(1);
        qtyRef.current = 1;
        window.removeEventListener('mouseup', onUp);
        onExecuteRef.current?.(q);
    }, [stop]);

    const tick = useCallback((now) => {
        if (!holdingRef.current) return;
        const elapsed = now - startRef.current;
        const q = holdCount(elapsed, startDelayMs, dwellMs, maxQty);
        let f = 0;
        if (elapsed >= startDelayMs) {
            f = Math.min(1, (elapsed - startDelayMs) / rampMs);
        }
        setQty(q);
        qtyRef.current = q;
        setFill(f);
        rafRef.current = requestAnimationFrame(tick);
    }, [maxQty, dwellMs, startDelayMs, rampMs]);

    const onDown = useCallback((e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        holdingRef.current = true;
        startRef.current = performance.now();
        qtyRef.current = 1;
        setQty(1);
        setFill(0);
        window.addEventListener('mouseup', onUp);
        rafRef.current = requestAnimationFrame(tick);
    }, [onUp, tick]);

    useEffect(() => () => {
        stop();
        window.removeEventListener('mouseup', onUp);
    }, [stop, onUp]);

    return (
        <Box
            role="button"
            aria-label={`${label} (hold to repeat, up to ${maxQty})`}
            onMouseDown={onDown}
            data-testid={testId}
            sx={{
                position: 'relative',
                overflow: 'hidden',
                cursor: 'pointer',
                userSelect: 'none',
                px: 2,
                py: 0.75,
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                '&:hover': { bgcolor: 'action.hover' },
            }}
        >
            <Box
                aria-hidden
                sx={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: `${fill * 100}%`,
                    bgcolor: 'primary.main',
                    opacity: 0.18,
                    pointerEvents: 'none',
                }}
            />
            <Box component="span" sx={{ position: 'relative' }}>{label}</Box>
            <Box
                component="span"
                data-testid="bv-hold-qty"
                sx={{ position: 'relative', fontWeight: 700, minWidth: 28, textAlign: 'right' }}
            >
                {qty > 1 ? `×${qty}` : ''}
            </Box>
        </Box>
    );
}
