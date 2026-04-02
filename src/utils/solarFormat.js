export function formatWatts(watts) {
    if (watts == null) return '—';
    return `${Math.round(watts).toLocaleString()} W`;
}

export function formatKwh(wattHours) {
    if (wattHours == null) return '—';
    const kwh = wattHours / 1000;
    return `${kwh.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
}

export function formatSavings(wattHours, ratePerKwh) {
    if (wattHours == null || ratePerKwh == null) return '—';
    const amount = (wattHours / 1000) * ratePerKwh;
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercentOfPeak(watts, peakWatts) {
    if (watts == null || !peakWatts) return '—';
    return `${Math.round((watts / peakWatts) * 100)}%`;
}

export function formatVoltage(voltage) {
    if (voltage == null) return '—';
    return `${voltage.toFixed(1)} V`;
}

export function formatCurrent(current) {
    if (current == null) return '—';
    return `${current.toFixed(1)} A`;
}

export function formatPowerFactor(pf) {
    if (pf == null) return '—';
    return pf.toFixed(2);
}

export function getInverterStatus(watts, maxWatts) {
    if (watts == null || watts === 0) return 'red';
    if (!maxWatts || maxWatts === 0) return 'red';
    const pct = watts / maxWatts;
    if (pct >= 0.8) return 'green';
    if (pct >= 0.5) return 'yellow';
    return 'orange';
}

export function getInverterColor(status) {
    const colors = {
        green: '#4caf50',
        yellow: '#ff9800',
        orange: '#f57c00',
        red: '#f44336',
    };
    return colors[status] || colors.red;
}
