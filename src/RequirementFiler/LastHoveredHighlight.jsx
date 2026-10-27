// LastHoveredHighlight.jsx — the element a requirement was filed about, outlined
// while the editor shows it (req #3958, user 2026-10-27: "while your requirements
// editor is open the last hovered html element will now have a highlight. if you
// delete the location data the highlight also goes away and is deleted").
//
// The pinned filer's + recorded it as the draft's `Last hovered` capture
// category (filerHover.js, debugBundle.js) and its element as the store's
// `hoverTarget`. While the editor is shown on THAT draft and the category is
// still in what will be sent, its element is outlined — the drag's own
// highlight, drawn at 30% so the editor keeps the focus (`recorded`,
// RECORDED_OPACITY), re-measured as the page scrolls and reflows, and stepping
// aside while a pinned drag draws its own: one highlight at a time. Dropping the category
// (its checkbox, or the trash can) takes the outline with it; Create closes the
// editor, and the outline goes too. Renders nothing itself.

import { useEffect } from 'react';

import { useRequirementFilerStore } from '../stores/useRequirementFilerStore';
import { aimShown, clearAim, remeasure, showAim } from './filerHover';

/** How often the outline follows its element, ms (and on every scroll). */
const FOLLOW_MS = 120;

/** The target to outline now, or null. */
export function recordedHover(st) {
    const h = st.hoverTarget;
    if (!st.editorShow || !h || h.key !== st.draftKey) return null;
    if (!['capturing', 'ready'].includes(st.captureStage)) return null;
    const dropped = st.captureSentDropped ?? st.captureDropped ?? [];
    if (dropped.includes('lastHovered')) return null;
    if (st.captureStage === 'ready' && !st.capture?.categories?.some(c => c.key === 'lastHovered')) return null;
    return h.target;
}

export default function LastHoveredHighlight() {
    const target = useRequirementFilerStore(recordedHover);
    useEffect(() => {
        if (!target) { clearAim(document, 'recorded'); return undefined; }
        const follow = () => showAim(aimShown('drag') ? null : remeasure(target), 'last hovered', document, 'recorded');
        follow();
        const timer = setInterval(follow, FOLLOW_MS);
        window.addEventListener('scroll', follow, true);
        window.addEventListener('resize', follow);
        return () => {
            clearInterval(timer);
            window.removeEventListener('scroll', follow, true);
            window.removeEventListener('resize', follow);
            clearAim(document, 'recorded');
        };
    }, [target]);
    return null;
}
