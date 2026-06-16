import { describe, it, expect } from 'vitest';
import {
    DAY_HOURS, hoursFromRowMidnight, xPct36, xPctWin, semanticLevel,
    shiftDayStr, dayDelta, dateRange, isWeekend,
    buildModelContext, buildDayModel, recenterDecision, startGlyphPlacement,
} from '../konvaSwarmModel';

const TZ = 'UTC';

describe('xPct36 / hoursFromRowMidnight (0..36h axis, req #2841)', () => {
    it('maps noon on the row date to 12h → 50%', () => {
        expect(hoursFromRowMidnight('2026-06-10 12:00:00', TZ, '2026-06-10')).toBeCloseTo(12, 5);
        expect(xPct36('2026-06-10 12:00:00', TZ, '2026-06-10')).toBeCloseTo((12 / 24) * 100, 4);
    });

    it('returns null for next-day spillover (belongs to the next row)', () => {
        // 02:00 the day after rowDate → 26h, past the 24h axis → next row owns it.
        expect(hoursFromRowMidnight('2026-06-11 02:00:00', TZ, '2026-06-10')).toBeCloseTo(26, 5);
        expect(xPct36('2026-06-11 02:00:00', TZ, '2026-06-10')).toBeNull();
    });

    it('returns null before the row midnight (belongs to the previous row)', () => {
        // 23:00 the day before rowDate → -1h.
        expect(xPct36('2026-06-09 23:00:00', TZ, '2026-06-10')).toBeNull();
    });

    it('returns null past the 24h cap', () => {
        expect(xPct36('2026-06-11 13:00:00', TZ, '2026-06-10')).toBeNull();
    });

    it('pins midnight start of the row to 0% and the next midnight to 100%', () => {
        expect(xPct36('2026-06-10 00:00:00', TZ, '2026-06-10')).toBeCloseTo(0, 4);
        expect(xPct36('2026-06-11 00:00:00', TZ, '2026-06-10')).toBeCloseTo(100, 4);
        expect(DAY_HOURS).toBe(24);
    });
});

describe('xPctWin — 36h noon-centered window trial', () => {
    const W = [-6, 30];  // prev 6pm → next 6am
    it('places noon at 50% in the centered window', () => {
        expect(xPctWin('2026-06-10 12:00:00', TZ, '2026-06-10', ...W)).toBeCloseTo(50, 4);
    });
    it('shows the prior evening on the left (20:00 prev day → ~5.6%)', () => {
        // 20:00 the day before rowDate → h = -4 → (-4+6)/36 = 5.56%.
        expect(xPctWin('2026-06-09 20:00:00', TZ, '2026-06-10', ...W)).toBeCloseTo((2 / 36) * 100, 3);
    });
    it('shows the next morning on the right (02:00 next day → ~88.9%)', () => {
        // 02:00 the day after rowDate → h = 26 → (26+6)/36 = 88.9%.
        expect(xPctWin('2026-06-11 02:00:00', TZ, '2026-06-10', ...W)).toBeCloseTo((32 / 36) * 100, 3);
    });
    it('returns null outside the window and defaults to the 24h axis', () => {
        expect(xPctWin('2026-06-09 10:00:00', TZ, '2026-06-10', ...W)).toBeNull(); // -14h
        expect(xPctWin('2026-06-10 12:00:00', TZ, '2026-06-10')).toBeCloseTo(50, 4); // default 0..24
    });
});

describe('buildDayModel — windowed bleed (36h trial)', () => {
    // A requirement completing at 02:00 on D+1 should appear on row D's next-morning
    // context band when the window is widened to [-6, 30].
    const requirements = [{
        id: 970, title: 'Early-morning close', completed_at: '2026-06-11 02:00:00',
        category_fk: 1, requirement_status: 'met', coordination_type: 'implemented',
    }];
    const categoryList = [{ id: 1, category_name: 'Swarm', color: '#1976d2' }];
    const dates = ['2026-06-10', '2026-06-11'];

    it('bleeds the early-morning bead onto the prior row but counts it only on its own day', () => {
        const ctx = buildModelContext({
            requirements, allRequirements: requirements, sessions: [], categoryList,
            timezone: TZ, dates, today: '2026-06-13', win: { start: -6, end: 30 },
        });
        const prior = buildDayModel('2026-06-10', ctx, {});
        const own = buildDayModel('2026-06-11', ctx, {});
        // Bead bleeds onto the prior row's right (context), but its "met" count is 0 there.
        expect(prior.placed.some(c => c.id === 970)).toBe(true);
        expect(prior.count).toBe(0);
        // On its own day it renders and counts.
        expect(own.placed.some(c => c.id === 970)).toBe(true);
        expect(own.count).toBe(1);
    });

    it('does NOT bleed under the default 24h window', () => {
        const ctx = buildModelContext({
            requirements, allRequirements: requirements, sessions: [], categoryList,
            timezone: TZ, dates, today: '2026-06-13',
        });
        const prior = buildDayModel('2026-06-10', ctx, {});
        expect(prior.placed.some(c => c.id === 970)).toBe(false);
    });
});

describe('semanticLevel thresholds', () => {
    it('selects out / mid / in by relative scale', () => {
        expect(semanticLevel(0.3)).toBe('out');
        expect(semanticLevel(0.49)).toBe('out');
        expect(semanticLevel(0.5)).toBe('mid');
        expect(semanticLevel(0.68)).toBe('mid');
        expect(semanticLevel(1)).toBe('mid');
        expect(semanticLevel(1.89)).toBe('mid');
        expect(semanticLevel(1.9)).toBe('in');
        expect(semanticLevel(4)).toBe('in');
    });
    it('defaults to out for non-finite input', () => {
        expect(semanticLevel(NaN)).toBe('out');
    });
});

describe('day-string helpers', () => {
    it('shiftDayStr crosses month boundaries', () => {
        expect(shiftDayStr('2026-06-30', 1)).toBe('2026-07-01');
        expect(shiftDayStr('2026-06-01', -1)).toBe('2026-05-31');
    });
    it('dayDelta is signed whole days', () => {
        expect(dayDelta('2026-06-10', '2026-06-13')).toBe(3);
        expect(dayDelta('2026-06-13', '2026-06-10')).toBe(-3);
    });
    it('dateRange is inclusive and ordered', () => {
        expect(dateRange('2026-06-10', '2026-06-12'))
            .toEqual(['2026-06-10', '2026-06-11', '2026-06-12']);
        expect(dateRange('2026-06-12', '2026-06-10')).toEqual([]);
    });
    it('isWeekend flags Sat/Sun', () => {
        expect(isWeekend('2026-06-13')).toBe(true);  // Saturday
        expect(isWeekend('2026-06-14')).toBe(true);  // Sunday
        expect(isWeekend('2026-06-12')).toBe(false); // Friday
    });
});

describe('recenterDecision — stale-transform / mid-May affinity (req #2860)', () => {
    const NAV = 'today|s|e|800x600|0';

    it('recenters on the first run (no prior nav key)', () => {
        // Mount: lastNavKey null → navChanged → recenter, and clearPan latches.
        expect(recenterDecision({
            navKey: NAV, lastNavKey: null,
            centerY: 100, lastCenterY: null, userPanned: false,
        })).toEqual({ recenter: true, clearPan: true });
    });

    it('recenters when an async data-load relayout shifts the selected day', () => {
        // SAME navigation (cold-cache first center already happened at cy=100),
        // data arrives → dense rows grow → today's row moves to cy=4000. The user
        // has not panned → follow today instead of staying pinned to the stale Y.
        // This is the exact bug: without this branch the view kept the cy=100
        // transform, which post-relayout fell over the mid-May cluster.
        expect(recenterDecision({
            navKey: NAV, lastNavKey: NAV,
            centerY: 4000, lastCenterY: 100, userPanned: false,
        })).toEqual({ recenter: true, clearPan: false });
    });

    it('does NOT recenter on a geometry shift after the user has manually panned', () => {
        // refetchOnWindowFocus brings new data (cy moves) but the user dragged the
        // canvas — respect their position, do not yank back to today.
        expect(recenterDecision({
            navKey: NAV, lastNavKey: NAV,
            centerY: 4000, lastCenterY: 100, userPanned: true,
        })).toEqual({ recenter: false, clearPan: false });
    });

    it('does NOT recenter when neither navigation nor geometry changed', () => {
        expect(recenterDecision({
            navKey: NAV, lastNavKey: NAV,
            centerY: 4000, lastCenterY: 4000, userPanned: false,
        })).toEqual({ recenter: false, clearPan: false });
    });

    it('an explicit navigation always recenters and clears the pan lock', () => {
        // User presses Today/Prev/Next (or resizes) after panning → navChanged
        // wins regardless of userPanned, and clearPan releases the lock.
        expect(recenterDecision({
            navKey: 'today|s|e|800x600|1', lastNavKey: NAV,
            centerY: 4000, lastCenterY: 4000, userPanned: true,
        })).toEqual({ recenter: true, clearPan: true });
    });
});

describe('buildDayModel — completed chip placement', () => {
    const date = '2026-06-10';
    const requirements = [{
        id: 901, title: 'Test req', completed_at: '2026-06-10 18:00:00',
        category_fk: 1, requirement_status: 'met', coordination_type: 'implemented',
    }];
    const sessions = [{
        id: 5001, source_ref: 'requirement:901', swarm_status: 'completed',
        started_at: '2026-06-10 09:00:00',
    }];
    const categoryList = [{ id: 1, category_name: 'Swarm', color: '#1976d2' }];

    const ctx = buildModelContext({
        requirements, allRequirements: requirements, sessions, categoryList,
        timezone: TZ, dates: [date], today: '2026-06-13',
    });

    it('places one bead at the completion x with a started-at start bar', () => {
        const { placed, count } = buildDayModel(date, ctx, { dataKey: 'category' });
        expect(count).toBe(1);
        expect(placed).toHaveLength(1);
        const chip = placed[0];
        // 18:00 → 18/24 = 75%.
        expect(chip.leftPct).toBeCloseTo(75, 3);
        // 09:00 → 9/24 = 37.5%.
        expect(chip.startPct).toBeCloseTo(37.5, 3);
        expect(chip.markerMode).toBe('normal');
        expect(chip.color).toBe('#1976d2');
        expect(chip.row).toBe(0);
    });

    it('adds a coordination ring only under the coordination dataKey', () => {
        const cat = buildDayModel(date, ctx, { dataKey: 'category' });
        expect(cat.placed[0].ringColor).toBeNull();
        const coord = buildDayModel(date, ctx, { dataKey: 'coordination' });
        expect(coord.placed[0].ringColor).toBeTruthy();
    });

    it('returns an empty model for a date with no activity', () => {
        const empty = buildDayModel('2026-06-11', ctx, {});
        expect(empty.placed).toHaveLength(0);
        expect(empty.count).toBe(0);
    });
});

describe('buildDayModel — 0..36h overlap dedup (code-review Critical)', () => {
    // A requirement completing at 09:00 on D maps to 9h on row D AND to 33h on
    // row D-1's spillover zone. The bead must render only on its own day (D).
    const requirements = [{
        id: 950, title: 'Morning close', completed_at: '2026-06-11 09:00:00',
        category_fk: 1, requirement_status: 'met', coordination_type: 'implemented',
    }];
    const categoryList = [{ id: 1, category_name: 'Swarm', color: '#1976d2' }];
    const dates = ['2026-06-10', '2026-06-11'];
    const ctx = buildModelContext({
        requirements, allRequirements: requirements, sessions: [], categoryList,
        timezone: TZ, dates, today: '2026-06-13',
    });

    it('places the bead on its own day only, not the prior row spillover', () => {
        const ownDay = buildDayModel('2026-06-11', ctx, {});
        const priorDay = buildDayModel('2026-06-10', ctx, {});
        expect(ownDay.placed.filter(c => !c.isCrossDayGhost)).toHaveLength(1);
        expect(ownDay.count).toBe(1);
        // The prior row must NOT carry a duplicate bead (it may carry a cross-day
        // ghost line, but no real bubble and a zero met-count).
        expect(priorDay.placed.some(c => c.id === 950 && !c.isPhantom && !c.isUndone)).toBe(false);
        expect(priorDay.count).toBe(0);
    });
});

describe('buildDayModel — undone tombstone', () => {
    const date = '2026-06-10';
    const swarmStarts = [{ id: 77, started_at: '2026-06-10 08:00:00', session_count: 1 }];
    const swarmUndos = [{
        id: 9, swarm_start_fk_at_undo: 77, req_id_at_undo: 902,
        task_name: 'undone-task', coordination_type: 'planned',
        reason: 'abandoned', undone_at: '2026-06-10 15:00:00',
    }];
    const ctx = buildModelContext({
        requirements: [], allRequirements: [], sessions: [], categoryList: [],
        swarmStarts, swarmUndos, timezone: TZ, dates: [date], today: '2026-06-13',
    });

    it('emits a tombstone chip at the undone-at time', () => {
        const { placed } = buildDayModel(date, ctx, {});
        const tomb = placed.find(c => c.isUndone);
        expect(tomb).toBeTruthy();
        // 15:00 → 15/24 = 62.5%.
        expect(tomb.leftPct).toBeCloseTo((15 / 24) * 100, 3);
    });
});

describe('buildDayModel — in-progress phantom', () => {
    const date = '2026-06-13';
    const swarmStarts = [{ id: 80, started_at: '2026-06-13 06:00:00', arguments: 'wip', session_count: 1 }];
    const swarmStartSessions = [{ swarm_start_fk: 80, session_fk: 6001 }];
    const sessions = [{ id: 6001, source_ref: 'requirement:903', swarm_status: 'active', started_at: '2026-06-13 06:00:00' }];
    const allRequirements = [{ id: 903, title: 'In flight', category_fk: 1, coordination_type: 'deployed', requirement_status: 'development' }];
    const categoryList = [{ id: 1, category_name: 'Swarm', color: '#1976d2' }];

    const ctx = buildModelContext({
        requirements: [], allRequirements, sessions, categoryList,
        swarmStarts, swarmStartSessions, timezone: TZ, dates: [date], today: date,
    });

    it('renders a phantom for the open session on today\'s row', () => {
        // nowIso fixed at 14:00 so "now" lands on the row deterministically.
        const { placed } = buildDayModel(date, ctx, { nowIso: '2026-06-13T14:00:00Z' });
        const phantom = placed.find(c => c.isPhantom);
        expect(phantom).toBeTruthy();
        expect(phantom.id).toBe(903);
        expect(phantom.markerMode).toBe('inprogress');
        // start 06:00 → 25%, head at now 14:00 → 58.33%.
        expect(phantom.startPct).toBeCloseTo((6 / 24) * 100, 2);
        expect(phantom.leftPct).toBeCloseTo((14 / 24) * 100, 2);
    });
});

describe('startGlyphPlacement — short-session swarm-start hug (req #2874)', () => {
    const geom = { cx: 100, cr: 9, trueX: 70, hugGap: 12 };

    it('returns null when there is no real start (bare requirement, startPct null)', () => {
        expect(startGlyphPlacement({ startPct: null, markerMode: 'left' }, geom)).toBeNull();
    });

    it('returns null when the start is clamped off-window (cross-day layer owns it)', () => {
        expect(startGlyphPlacement(
            { startPct: 0, startClamped: true, markerMode: 'clamped' }, geom,
        )).toBeNull();
    });

    it('returns null for a missing chip', () => {
        expect(startGlyphPlacement(null, geom)).toBeNull();
    });

    it('places the glyph at its true x with no connector for a normal-length session', () => {
        const p = startGlyphPlacement({ startPct: 33, markerMode: 'normal' }, geom);
        expect(p).toEqual({ glyphX: 70, connector: null });
    });

    it('hugs the glyph just left of the bead + draws a short connector for markerMode left', () => {
        const p = startGlyphPlacement({ startPct: 41, markerMode: 'left' }, geom);
        // glyph sits cr + hugGap left of the bead center; connector spans hugGap to the bead edge.
        expect(p.glyphX).toBe(100 - 9 - 12);        // 79
        expect(p.connector).toEqual({ x1: 79, x2: 91 });
        // connector length === hugGap (a short, always-visible duration stand-in).
        expect(p.connector.x2 - p.connector.x1).toBe(12);
    });

    it('ignores trueX in the left-hug case (start x overlaps the bead, so it is unused)', () => {
        const p = startGlyphPlacement(
            { startPct: 50, markerMode: 'left' }, { ...geom, trueX: 99.5 },
        );
        expect(p.glyphX).toBe(79);
    });
});
