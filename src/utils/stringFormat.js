export function trimTo35(str) {
    if (!str) return '';
    const s = String(str);
    return s.length > 35 ? s.slice(0, 34) + '…' : s;
}
