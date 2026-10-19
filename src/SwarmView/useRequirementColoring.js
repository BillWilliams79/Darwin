import { useMemo } from 'react';

import { useRequirementColorKeyStore } from '../stores/useRequirementColorKeyStore';
import { requirementColorViews } from './requirementCardTheme';

/**
 * req #3644 — the active colour key and every scale's view over one card's
 * rows (State, Session, Autonomy, Model, Effort — `REQUIREMENT_COLOR_SCALES`).
 *
 * @param {Object[]} rows                  the card's requirement rows
 * @param {Object} sessionStatusMap        requirement id -> latest swarm_status
 * @returns {{colorKey: string, colorViews: Object}}
 */
export function useRequirementColoring(rows, sessionStatusMap) {
    const colorKey = useRequirementColorKeyStore((s) => s.colorKey);
    const colorViews = useMemo(
        () => requirementColorViews({ requirements: rows, sessionStatusMap }),
        [rows, sessionStatusMap]);
    return { colorKey, colorViews };
}
