// Shared styling + labeling for machine chips (req #2992).
// Mirrors swarmStatusChipProps.js / modelChipStyles.js / effortChipStyles.js.
//
// Unlike those, the machine vocabulary is DATA — ids come from the machines
// table and grow over time — so colors come from the standard ChipFilter
// palette keyed by machine id rather than a hand-written switch.

import { filterChipProps } from '../Components/ChipFilter/filterPalette';
import { getFilterOverrides } from '../stores/useFilterColorStore';

// Dimension key for the color-override store.
export const MACHINE_DIMENSION = 'machine';

// Sentinel for sessions with no machine_fk. Pre-#2943 rows all look like this,
// so the option must exist and default to selected or most of the history
// disappears from the grid.
export const UNASSIGNED_MACHINE = 'unassigned';

export const machineChipProps = (machineId) => {
    if (machineId === UNASSIGNED_MACHINE || machineId == null) {
        return filterChipProps(null);
    }
    return filterChipProps(machineId, getFilterOverrides(MACHINE_DIMENSION));
};

export const machineLabel = (machineId, machineNameById) => {
    if (machineId === UNASSIGNED_MACHINE || machineId == null) return 'Unassigned';
    return machineNameById?.[machineId] || `Machine ${machineId}`;
};
