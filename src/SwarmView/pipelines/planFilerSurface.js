// planFilerSurface.js — what the plan visualizer reports to the Requirement
// Filer at the + press (req #4158): the page options its URL cannot say, and
// the deep link that reopens what was on screen.
//
// `/swarm/pipeline/12?mode=plan` named the plan and nothing else: the level
// drawn (Overview's bare beads or L3's titled cards), the colour key and the
// epic whose editor was open all lived in state or a stored preference, so the
// worker's dev server opened the same plan drawn differently. The link below
// carries the ones the page reads back from its URL — `?level=` and
// `?color=` (transient, never persisted: pipelineEpicLink.js) and `?epic=` /
// `?initiative=` for the selection — so `Surface:` reopens the view. The rest
// (camera, folds, filters) has no URL form and goes in the options.

import { isColorKey, PLAN_LEVEL_NUMBER } from './pipelinePlanLayout';

/** The parameters this page's link sets itself; every other one is kept as it was. */
const OWN_PARAMS = new Set(['mode', 'level', 'color', 'epic', 'initiative', 'filer']);

const paramName = (raw) => { const n = raw.split('=')[0]; try { return decodeURIComponent(n); } catch { return n; } };
const listOf = (v) => (v instanceof Set ? [...v] : Array.isArray(v) ? v : []);
const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

/**
 * `{ options, surface }` for registerPageOptions.
 *
 * @param {Object} v   the visualizer's view now (PipelinePlanVisualizer `filerViewRef`)
 * @param {Object} at
 * @param {string} at.pathname
 * @param {string} at.search
 * @param {?{kind: string, id: ?number}} at.editor  the Plan Element Editor's open element
 * @param {?number} [at.requirementEditor]  the requirement open in the Requirement Editor
 */
export function planFilerSurface(v, { pathname, search = '', editor = null, requirementEditor = null }) {
    const levelNumber = PLAN_LEVEL_NUMBER[v.level] ?? null;
    // The SELECTION: the element whose editor is open, else the link's focus.
    const selected = editor?.id != null && (editor.kind === 'epic' || editor.kind === 'initiative')
        ? { [editor.kind]: editor.id }
        : (v.focusEpicId != null ? { epic: v.focusEpicId }
            : (v.focusInitiativeId != null ? { initiative: v.focusInitiativeId } : null));
    const params = ['mode=plan'];
    if (levelNumber != null) params.push(`level=${levelNumber}`);
    if (isColorKey(v.colorKey)) params.push(`color=${encodeURIComponent(v.colorKey)}`);
    if (selected?.epic != null) params.push(`epic=${selected.epic}`);
    else if (selected?.initiative != null) params.push(`initiative=${selected.initiative}`);
    const kept = String(search || '').replace(/^\?/, '').split('&').filter(Boolean)
        .filter((raw) => !OWN_PARAMS.has(paramName(raw)));
    const t = v.t || {};
    // The open elements are SUBJECTS too, titled from what the canvas holds —
    // the address names the plan and, at most, the link's focus.
    const subject = [];
    if (editor?.id != null && editor.kind === 'epic') {
        subject.push({ kind: 'epic', id: editor.id, title: v.rowById?.get?.(editor.id)?.title ?? null });
    } else if (editor?.id != null && editor.kind === 'initiative') {
        subject.push({ kind: 'initiative', id: editor.id,
            title: (v.initiatives || []).find((i) => i.id === editor.id)?.title ?? null });
    }
    // The Requirement Editor's requirement is recorded in `selected` only, never as a
    // subject: the filer's editor reads PRODUCTION (req #3888) and may hold a row
    // reopened from its own list, so neither this page's database nor its titles
    // describe it.
    return {
        ...(subject.length ? { subject } : null),
        surface: `${pathname}?${[...params, ...kept].join('&')}`,
        options: {
            view: 'plan',
            pipelineId: v.pipeline?.id ?? null,
            level: v.level ?? null,
            levelNumber,
            levelPref: v.levelPref ?? null,
            colorKey: v.colorKey ?? null,
            palette: v.palette ?? null,
            epicLabel: v.epicLabel ?? null,
            reqLabel: v.reqLabel ?? null,
            selected: {
                editor: editor?.kind ? { kind: editor.kind, id: editor.id ?? null } : null,
                ...(v.reqEdit?.reqId != null ? { requirementTitleEdit: v.reqEdit.reqId } : null),
                ...(requirementEditor != null ? { requirementEditor } : null),
            },
            focus: { epicId: v.focusEpicId ?? null, initiativeId: v.focusInitiativeId ?? null },
            collapsed: {
                initiatives: listOf(v.collapsed?.initiativeIds).map((id) => id ?? 'none'),
                epics: listOf(v.collapsed?.epicIds),
            },
            camera: { x: round(t.x), y: round(t.y), k: round(t.k, 4) },
            maximized: !!v.maximized,
            hideClosed: !!v.hideClosed,
            hiddenMachines: listOf(v.hiddenMachines),
            epicWidthLevel: v.epicWidthLevel ?? null,
            epicTimeMode: v.epicTimeMode ?? null,
            showReqCounts: !!v.showReqCounts,
        },
    };
}
