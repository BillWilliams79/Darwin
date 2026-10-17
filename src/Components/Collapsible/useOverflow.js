// Does an element's content overflow its (clamped) box? (req #3572)
//
// CollapsibleText uses the answer to decide whether clicking the clamped text
// itself should expand it — short text has nothing to disclose. Line counts
// cannot answer that (wrapping depends on the card's width), so this measures
// the rendered box instead and re-measures whenever it resizes.
//
// `active` is false while the element is EXPANDED: an expanded box never
// overflows, so measuring it would always say no. The last clamped verdict is
// kept instead.

import { useLayoutEffect, useState } from 'react';

export const useOverflow = (ref, active, deps = []) => {
    const [overflowing, setOverflowing] = useState(false);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!active || !el) return undefined;
        // +1 absorbs sub-pixel rounding between scrollHeight (an integer) and the
        // fractional clamped height.
        const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, ...deps]);

    return overflowing;
};
