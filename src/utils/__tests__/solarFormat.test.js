import { describe, it, expect } from 'vitest';
import {
    formatWatts, formatKwh, formatSavings, formatPercentOfPeak,
    formatVoltage, formatCurrent, formatPowerFactor,
    getInverterStatus, getInverterColor,
} from '../solarFormat';

describe('formatWatts', () => {
    it('formats zero', () => expect(formatWatts(0)).toBe('0 W'));
    it('formats small value', () => expect(formatWatts(262)).toBe('262 W'));
    it('formats large value with commas', () => expect(formatWatts(11100)).toBe('11,100 W'));
    it('rounds decimals', () => expect(formatWatts(251.6)).toBe('252 W'));
    it('returns dash for null', () => expect(formatWatts(null)).toBe('—'));
    it('returns dash for undefined', () => expect(formatWatts(undefined)).toBe('—'));
});

describe('formatKwh', () => {
    it('converts watt-hours to kWh', () => expect(formatKwh(8126)).toBe('8.1 kWh'));
    it('formats large lifetime', () => expect(formatKwh(8071061)).toBe('8,071.1 kWh'));
    it('formats zero', () => expect(formatKwh(0)).toBe('0.0 kWh'));
    it('returns dash for null', () => expect(formatKwh(null)).toBe('—'));
});

describe('formatSavings', () => {
    it('calculates savings at default rate', () => expect(formatSavings(8071061, 0.30)).toBe('$2,421.32'));
    it('calculates daily savings', () => expect(formatSavings(8126, 0.30)).toBe('$2.44'));
    it('returns dash for null wattHours', () => expect(formatSavings(null, 0.30)).toBe('—'));
    it('returns dash for null rate', () => expect(formatSavings(8000, null)).toBe('—'));
});

describe('formatPercentOfPeak', () => {
    it('formats full peak', () => expect(formatPercentOfPeak(11100, 11100)).toBe('100%'));
    it('formats partial', () => expect(formatPercentOfPeak(262, 11100)).toBe('2%'));
    it('formats zero', () => expect(formatPercentOfPeak(0, 11100)).toBe('0%'));
    it('returns dash for null watts', () => expect(formatPercentOfPeak(null, 11100)).toBe('—'));
    it('returns dash for zero peak', () => expect(formatPercentOfPeak(100, 0)).toBe('—'));
});

describe('formatVoltage', () => {
    it('formats voltage', () => expect(formatVoltage(244.4)).toBe('244.4 V'));
    it('returns dash for null', () => expect(formatVoltage(null)).toBe('—'));
});

describe('formatCurrent', () => {
    it('formats current', () => expect(formatCurrent(22.6)).toBe('22.6 A'));
    it('returns dash for null', () => expect(formatCurrent(null)).toBe('—'));
});

describe('formatPowerFactor', () => {
    it('formats power factor', () => expect(formatPowerFactor(0.09)).toBe('0.09'));
    it('formats unity', () => expect(formatPowerFactor(1.0)).toBe('1.00'));
    it('returns dash for null', () => expect(formatPowerFactor(null)).toBe('—'));
});

describe('getInverterStatus', () => {
    it('returns green for >80% output', () => expect(getInverterStatus(300, 347)).toBe('green'));
    it('returns green at exactly 80%', () => expect(getInverterStatus(80, 100)).toBe('green'));
    it('returns yellow for 50-80%', () => expect(getInverterStatus(200, 347)).toBe('yellow'));
    it('returns yellow at exactly 50%', () => expect(getInverterStatus(50, 100)).toBe('yellow'));
    it('returns orange for <50%', () => expect(getInverterStatus(20, 347)).toBe('orange'));
    it('returns red for 0 watts', () => expect(getInverterStatus(0, 347)).toBe('red'));
    it('returns red for null watts', () => expect(getInverterStatus(null, 347)).toBe('red'));
    it('returns red for zero maxWatts', () => expect(getInverterStatus(100, 0)).toBe('red'));
});

describe('getInverterColor', () => {
    it('maps green to hex', () => expect(getInverterColor('green')).toBe('#4caf50'));
    it('maps yellow to hex', () => expect(getInverterColor('yellow')).toBe('#ff9800'));
    it('maps orange to hex', () => expect(getInverterColor('orange')).toBe('#f57c00'));
    it('maps red to hex', () => expect(getInverterColor('red')).toBe('#f44336'));
    it('defaults to red for unknown', () => expect(getInverterColor('unknown')).toBe('#f44336'));
});
