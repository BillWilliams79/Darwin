import { describe, it, expect } from 'vitest';
import { telemetryWindows, attachTelemetry, WINDOW_DAYS } from '../telemetryWindows';
import { SWARM_COMPLETE_DEFAULT_FIELDS } from '../../hooks/factory/devopsQueries';

describe('telemetryWindows (req #4113)', () => {
    it('no rows / no started_at → no windows', () => {
        expect(telemetryWindows([])).toEqual([]);
        expect(telemetryWindows(null)).toEqual([]);
        expect(telemetryWindows([{ id: 1, started_at: null }])).toEqual([]);
    });

    it('covers every row, newest window first, with no gaps or overlap', () => {
        const rows = [
            { id: 1, started_at: '2026-06-01T05:00:00' },
            { id: 2, started_at: '2026-10-31T23:59:59' },
            { id: 3, started_at: '2026-08-15T12:00:00' },
        ];
        const w = telemetryWindows(rows);
        expect(w[0].end >= '2026-10-31T23:59:59').toBe(true);
        expect(w[w.length - 1].start).toBe('2026-06-01T00:00:00');
        for (const r of rows) {
            const hits = w.filter(x => r.started_at >= x.start && r.started_at <= x.end);
            expect(hits).toHaveLength(1);
        }
        // consecutive windows are contiguous to the second
        for (let i = 0; i < w.length - 1; i++) {
            const next = Date.parse(`${w[i + 1].end}Z`) + 1000;
            expect(next).toBe(Date.parse(`${w[i].start}Z`));
        }
    });

    it('a window spans WINDOW_DAYS days', () => {
        const [w] = telemetryWindows([{ id: 1, started_at: '2026-10-01T00:00:00' }]);
        expect(Date.parse(`${w.end}Z`) + 1000 - Date.parse(`${w.start}Z`)).toBe(WINDOW_DAYS * 86400000);
    });
});

describe('attachTelemetry', () => {
    it('attaches by id, null where a window returned nothing', () => {
        expect(attachTelemetry([{ id: 1 }, { id: 2 }], { 1: 'T' }))
            .toEqual([{ id: 1, telemetry: 'T' }, { id: 2, telemetry: null }]);
    });
});

describe('swarm_completes list projection (req #4113)', () => {
    it('never carries the blobs that overflow the 6 MB Lambda cap', () => {
        const f = SWARM_COMPLETE_DEFAULT_FIELDS.split(',');
        expect(f).not.toContain('telemetry');
        expect(f).not.toContain('complete_summary');
        expect(f).toEqual(expect.arrayContaining(['id', 'status', 'started_at', 'ai_model', 'effort']));
    });
});
