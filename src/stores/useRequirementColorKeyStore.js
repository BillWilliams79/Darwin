import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_REQUIREMENT_COLOR_KEY, normalizeRequirementColorKey } from '../SwarmView/requirementCardTheme';

// req #3644 — the Requirements page's colour key: which scale (State, Session,
// Autonomy, Model, Effort, or 'none' — `REQUIREMENT_COLOR_SCALES`) colours every requirement row's id
// and title text.
// A store rather than page state because the control sits in
// the SwarmView header and the rows it colours are three components down, in
// every CategoryCard and the Swarm-Start aggregator.
//
// Its OWN key, not the plan's colour-key setting (`colorKey` in
// pipelines/planViewSettings.js): the two pages
// answer different questions, and picking Machine on a plan should not recolour
// the requirements page behind the reader's back.
//
// Normalized on the way in AND on rehydration: the persisted value is ordinary
// localStorage input, and a stale or hostile string must land on the default
// rather than on a key no scale can paint.
export const useRequirementColorKeyStore = create(
    persist(
        (set) => ({
            colorKey: DEFAULT_REQUIREMENT_COLOR_KEY,
            setColorKey: (value) => set({ colorKey: normalizeRequirementColorKey(value) }),
        }),
        {
            name: 'darwin_requirement_color_key',
            merge: (persisted, current) => ({
                ...current,
                colorKey: normalizeRequirementColorKey(persisted?.colorKey),
            }),
        }
    )
);
