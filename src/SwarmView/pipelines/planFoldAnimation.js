// planFoldAnimation.js — an initiative's fold, animated (req #3695).
//
// User direction: "when opened, it will animate the expansion of its box to the
// size it needs regally. it will collapse similarly (not slow just regal)."
//
// The fold itself is still the remembered setting `planCollapse.js` writes, and
// it flips the instant the chevron is clicked — the chevron, the name's click
// and every reader of the setting answer at once. What animates is only the
// DRAWING: for the length of the animation the canvas lays the band out
// part-way open (`computePlanLayout`'s `foldReveal`), so the box grows or
// shrinks, every band below it slides, and the band's cards fade with it.
//
// ONE MOVE, BOTH WAYS, REVERSIBLE: a click mid-flight turns the band round from
// wherever it is drawn, over the share of the duration that is left, so the
// reverse is as smooth as the forward and never jumps to an end first.
//
// `prefers-reduced-motion` folds instantly, and so does an environment that
// cannot answer the question at all (no `matchMedia`): an animation the reader
// asked not to see is not regal.

import { useCallback, useEffect, useRef, useState } from 'react';

// "Not slow just regal": a little longer than the camera's own 420ms
// focus move, so the fold reads as deliberate without making the reader wait.
export const FOLD_ANIM_MS = 460;

/** Ease-in-out cubic: a measured start, a confident middle, a soft landing. */
export const easeInOutCubic = (p) => {
    const x = Math.min(1, Math.max(0, p));
    return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
};

/**
 * A band's reveal at `now` for one running animation.
 *
 * @param {{from:number,to:number,start:number,dur:number}} anim
 * @param {number} now  same clock as `anim.start`
 * @returns {number} 0 (folded) .. 1 (open)
 */
export function foldRevealAt(anim, now) {
    if (!(anim.dur > 0)) return anim.to;
    const p = (now - anim.start) / anim.dur;
    if (p >= 1) return anim.to;
    return anim.from + (anim.to - anim.from) * easeInOutCubic(p);
}

/** Whether the animation has reached its end at `now`. */
export const foldAnimDone = (anim, now) => !(anim.dur > 0) || now - anim.start >= anim.dur;

/**
 * The animation that takes a band to `open`, starting from wherever it is
 * DRAWN now — `current` is its live reveal mid-flight, or its settled one.
 * The duration is the share of a full fold still to travel.
 */
export function startFoldAnim(current, open, now, dur = FOLD_ANIM_MS) {
    const to = open ? 1 : 0;
    const from = Math.min(1, Math.max(0, current));
    return { from, to, start: now, dur: dur * Math.abs(to - from) };
}

/**
 * How visible a card is at a band reveal. The box leads and the content
 * follows: mid-fold the cards sit compressed inside a box still too short for
 * them, so they stay invisible through the first 40% of the reveal and arrive
 * as the box reaches its size (and leave first on the way down).
 */
export const foldContentAlpha = (reveal) => {
    if (reveal == null || reveal >= 1) return 1;
    return Math.min(1, Math.max(0, (reveal - 0.4) / 0.6));
};

export const prefersReducedMotion = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    try {
        return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return true;
    }
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The live fold animations of one canvas.
 *
 * @returns {{foldReveal: ?Map, animateFold: function(?number, boolean): void}}
 *   `foldReveal` is initiative key -> reveal for every band animating THIS frame,
 *   or null when none is (the settled layout then draws as it is);
 *   `animateFold(key, open)` starts (or turns round) that band's fold.
 */
export function useFoldAnimation() {
    const animsRef = useRef(new Map());
    const rafRef = useRef(0);
    const [foldReveal, setFoldReveal] = useState(null);

    const tick = useCallback(() => {
        rafRef.current = 0;
        const t = now();
        const anims = animsRef.current;
        const live = new Map();
        for (const [key, a] of anims) {
            if (foldAnimDone(a, t)) anims.delete(key);
            else live.set(key, foldRevealAt(a, t));
        }
        setFoldReveal(live.size ? live : null);
        if (live.size) rafRef.current = requestAnimationFrame(tick);
    }, []);

    const animateFold = useCallback((key, open) => {
        if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return;
        const t = now();
        const running = animsRef.current.get(key);
        const current = running ? foldRevealAt(running, t) : (open ? 0 : 1);
        animsRef.current.set(key, startFoldAnim(current, open, t));
        // The first frame is drawn NOW, from the band's current reveal, so the
        // commit that flips the fold never paints the settled end state first.
        const live = new Map();
        for (const [k, a] of animsRef.current) live.set(k, foldRevealAt(a, t));
        setFoldReveal(live);
        if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    }, [tick]);

    useEffect(() => () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        animsRef.current.clear();
    }, []);

    return { foldReveal, animateFold };
}
