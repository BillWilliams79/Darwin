// Centralised chip style props for the req #2380 status / type / result enums.
// Mirrors the exemplar `SwarmView/statusChipStyles.js` pattern so the four new
// pages render enums consistently (color + capitalized label) and a future
// theme change lives in one place.

// feature_status: draft | active | deprecated
export function featureStatusChipProps(status) {
    switch (status) {
        case 'active':
            return { sx: { bgcolor: 'success.light', color: 'success.contrastText' } };
        case 'deprecated':
            return { sx: { bgcolor: 'grey.400', color: 'grey.900' } };
        case 'draft':
        default:
            return { sx: { bgcolor: 'warning.light', color: 'warning.contrastText' } };
    }
}

// test_type: manual | automated | hybrid
export function testTypeChipProps(type) {
    switch (type) {
        case 'automated':
            return { sx: { bgcolor: 'info.light', color: 'info.contrastText' } };
        case 'hybrid':
            return { sx: { bgcolor: 'secondary.light', color: 'secondary.contrastText' } };
        case 'manual':
        default:
            return { sx: {} };
    }
}

// run_status: in_progress | completed | aborted
export function runStatusChipProps(status) {
    switch (status) {
        case 'completed':
            return { color: 'success', sx: {} };
        case 'aborted':
            return { color: 'error', sx: {} };
        case 'in_progress':
        default:
            return { color: 'primary', sx: {} };
    }
}

// result_status: passed | failed | blocked | skipped | not_run
export function resultStatusChipProps(status) {
    switch (status) {
        case 'passed':
            return { color: 'success', sx: {} };
        case 'failed':
            return { color: 'error', sx: {} };
        case 'blocked':
            return { color: 'warning', sx: {} };
        case 'skipped':
            return { color: 'default', sx: {} };
        case 'not_run':
        default:
            return { color: 'default', variant: 'outlined', sx: {} };
    }
}

// Used to keep DataGrid status sorts in a meaningful order (not alphabetical).
export const FEATURE_STATUS_ORDER = { draft: 0, active: 1, deprecated: 2 };
export const TEST_TYPE_ORDER     = { manual: 0, hybrid: 1, automated: 2 };
export const RUN_STATUS_ORDER    = { in_progress: 0, completed: 1, aborted: 2 };
export const RESULT_STATUS_ORDER = { not_run: 0, skipped: 1, blocked: 2, failed: 3, passed: 4 };

export const makeStatusComparator = (orderMap) =>
    (v1, v2) => (orderMap[v1] ?? 99) - (orderMap[v2] ?? 99);
