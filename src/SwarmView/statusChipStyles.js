// Shared styling + labeling for requirement-status chips.
// Used by:
//   • SwarmView header — multi-select requirement-status filter
//   • SwarmStartCard header — single-select cross-category status selector
//   • RequirementsTableView — the status column

import { DEFAULT_PLAN_PALETTE, planPalette } from './pipelines/pipelinePlanLayout';

// req #3644 — THE PLAN'S STATUS COLOURS. The Requirements page colours every
// row by the plan's colour key, whose State scale paints the aurora palette
// (`DEFAULT_PLAN_PALETTE`, the one the plan canvas draws). A status chip in a
// different palette beside it — a yellow Authoring chip over a pink authoring
// outline — would contradict the key on the same screen, so the chips read the
// same registry. Every aurora status hue is light, so the label is dark on all.
const STATUS_CHIP_PALETTE = planPalette(DEFAULT_PLAN_PALETTE).status;
const STATUS_CHIP_TEXT = '#0d1420';

/** The status's colour (aurora), or null for a status this build does not know. */
export const requirementStatusColor = (status) => (Object.hasOwn(STATUS_CHIP_PALETTE, status)
    ? STATUS_CHIP_PALETTE[status] : null);

export const requirementStatusChipProps = (status) => (Object.hasOwn(STATUS_CHIP_PALETTE, status)
    ? { sx: { bgcolor: STATUS_CHIP_PALETTE[status], color: STATUS_CHIP_TEXT } }
    : { color: 'default' });

export const requirementStatusLabel = (status) => {
    switch (status) {
        case 'swarm_ready':  return 'Swarm-Start';
        case 'development':  return 'Dev';
        case 'wontfix':      return "Won't Fix";
        default:             return status;
    }
};
