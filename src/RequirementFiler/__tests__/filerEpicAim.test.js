// Req #3854 — the registry the plan visualizer aims the filer's + through.
import { describe, it, expect, vi } from 'vitest';

import { epicAimAt, highlightEpicAim, notifyEpicSeated, registerEpicAim, seatProblem } from '../filerEpicAim';

describe('filerEpicAim (req #3854)', () => {
    it('answers nothing with no plan registered', () => {
        expect(epicAimAt(1, 2)).toBe(null);
        expect(() => { highlightEpicAim({ epicId: 1 }); notifyEpicSeated(1); }).not.toThrow();
    });

    it('asks the newest registered plan; unregistering an older one leaves it', () => {
        const a = { at: () => ({ epicId: 1 }) };
        const b = { at: vi.fn(() => ({ epicId: 2 })), highlight: vi.fn(), seated: vi.fn() };
        const offA = registerEpicAim(a);
        const offB = registerEpicAim(b);
        offA();
        expect(epicAimAt(10, 20)).toEqual({ epicId: 2 });
        expect(b.at).toHaveBeenCalledWith(10, 20);
        highlightEpicAim(undefined);
        expect(b.highlight).toHaveBeenCalledWith(null);
        notifyEpicSeated(2);
        expect(b.seated).toHaveBeenCalledWith(2);
        offB();
        expect(epicAimAt(10, 20)).toBe(null);
    });

    it('a point it cannot read, or a hit test that throws, is no epic', () => {
        const off = registerEpicAim({ at: () => { throw new Error('no layout'); } });
        expect(epicAimAt(1, 1)).toBe(null);
        expect(epicAimAt(undefined, 1)).toBe(null);
        off();
    });

    it('seatProblem: locked, another database, or none', () => {
        const uri = 'https://api/darwin';
        expect(seatProblem(null, uri)).toBe(null);
        expect(seatProblem({ ok: true, darwinUri: uri }, uri)).toBe(null);
        expect(seatProblem({ ok: false, darwinUri: uri }, uri)).toMatch(/locked/);
        expect(seatProblem({ ok: true, darwinUri: 'https://api/darwin_dev' }, uri)).toMatch(/darwin_dev/);
    });
});
