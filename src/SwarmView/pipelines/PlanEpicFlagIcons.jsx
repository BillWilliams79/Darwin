// Req #3673 — the picture on the epic card's barrier button, and on the
// initiative chip's padlock. (The epic card's own padlock button went in req #3742;
// a locked epic's card has a red perimeter instead.)
//
// User directive: "lock and unlock should show an icon with a locked lock for
// locked state and unlocked icon for unlocked state. the pics should be
// clear" — and the ⚑ was "unclear … either all white or [with] a dark
// center", so the barrier gets a different picture altogether.
//
// THE BARRIER IS DRAWN AS A BOOM BARRIER — the striped arm across a road.
// The metaphor is the flag's own meaning: arm DOWN, orange-and-white, is a
// barrier (the epics after this one are held until it is done); arm RAISED
// and grey is not (they may start before it). The two states differ in SHAPE
// and COLOUR, never only in fill, which is what made the flag unreadable.
//
// The padlock is MUI's own pair — solid `Lock` (closed shackle, keyhole) and
// `LockOpen` (shackle swung open) — the most recognisable padlock there is,
// so "locked" and "unlocked" never need a key to read.

import { memo } from 'react';
import SvgIcon from '@mui/material/SvgIcon';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';

// The arm, in its own 24-unit box: pivot at (PIVOT_X, PIVOT_Y), four stripes.
const PIVOT_X = 3.75;
const PIVOT_Y = 13;
const ARM_X0 = 5.5;
const ARM_LEN = 16;
const ARM_T = 4;
const STRIPE = ARM_LEN / 4;
// How far the arm swings up when the gate is open. Far enough that it can
// never be mistaken for a closed arm, short of vertical so it never reads as
// a second post — and the tip stays inside the 24-unit box.
const RAISED_DEG = -40;

/**
 * A boom barrier: `closed` draws the arm across (a barrier), otherwise
 * raised. `stripe`/`light` colour a closed arm; an open one is drawn in
 * `currentColor` with alternating strengths so it still reads as a barrier.
 *
 * Memoised: every card's button re-renders on every pan/zoom frame, and every
 * prop here is a primitive (MUI's own `Lock`/`LockOpen` are memoised likewise).
 */
export const BarrierGateIcon = memo(function BarrierGateIcon({
    closed, stripe, light, ...props
}) {
    const y0 = PIVOT_Y - ARM_T / 2;
    const base = closed ? light : 'currentColor';
    const band = closed ? stripe : 'currentColor';
    return (
        <SvgIcon viewBox="0 0 24 24" {...props}>
            <g transform={closed ? undefined : `rotate(${RAISED_DEG} ${PIVOT_X} ${PIVOT_Y})`}
               data-arm={closed ? 'down' : 'up'}>
                <rect x={ARM_X0} y={y0} width={ARM_LEN} height={ARM_T} rx={1.5}
                      fill={base} opacity={closed ? 1 : 0.45} />
                <rect x={ARM_X0} y={y0} width={STRIPE} height={ARM_T} fill={band} />
                <rect x={ARM_X0 + 2 * STRIPE} y={y0} width={STRIPE} height={ARM_T} fill={band} />
            </g>
            {/* The post and its foot, then the pivot cap over the arm's root. */}
            <rect x={2} y={6.5} width={3.5} height={14} rx={1} fill="currentColor" />
            <rect x={0.5} y={19.5} width={6.5} height={2.5} rx={1} fill="currentColor" />
            <circle cx={PIVOT_X} cy={PIVOT_Y} r={2.3} fill="currentColor" />
        </SvgIcon>
    );
});

/** The padlock: closed when `locked`, swung open otherwise. */
export function PlanLockIcon({ locked, ...props }) {
    return locked
        ? <LockIcon data-lock="closed" {...props} />
        : <LockOpenIcon data-lock="open" {...props} />;
}

// What the barrier button says on hover and to assistive tech: the state,
// what it means, and what a click will do.
// A locked epic refuses the barrier click, so its title says that instead of
// promising a change.
export function barrierTitle(on, lockedBy) {
    const state = on
        ? 'Barrier ON — Dependent epics may start requirements only when all requirements in this epic are met, wontfix, deferred, or paused.'
        : 'Barrier OFF — Dependent epics may start requirements only when all requirements in this epic have been started or are met, wontfix, deferred or paused.';
    if (lockedBy) {
        return `${state} ${lockedBy === 'epic' ? 'This epic is locked'
            : `Locked by its ${lockedBy}`} — unlock it to change this.`;
    }
    return `${state} ${on ? 'Click to turn it off.' : 'Click to make it a barrier.'}`;
}
