// swarmPointObject.js — what the swarm visualizer's Konva canvas draws at a
// point, for the Requirement Filer's pushpin (req #4158).
//
// KonvaSwarmCanvas resolves a click to the topmost shape and fires `activate`
// on it, but no shape said WHAT it is, so a pinned filer over a bead named
// `konva-swarm-canvas`. Every shape a person points at now carries a
// `filerObject` attr — `{ kind, id, title }` — and the day row's Group carries
// the day, so a point over grid lines or the wire still names its day. The
// resolver walks from the intersected shape up to the first that says.

/** The object a bead, dot or cross-day track stands for. */
export function chipObject(chip) {
    if (!chip) return null;
    const title = chip.title || null;
    if (chip.isUndone && chip.undo?.id != null) return { kind: 'swarm undo', id: chip.undo.id, title };
    if (chip.id != null) return { kind: 'requirement', id: chip.id, title };
    if (chip.swarmStartId != null) return { kind: 'swarm start', id: chip.swarmStartId, title };
    return null;
}

/**
 * The object the stage draws at stage point (x, y): `{ kind, id, title, rect }`,
 * `rect` in stage px — the box of the shape that names it — or null.
 */
export function konvaObjectAt(stage, x, y) {
    const hit = stage?.getIntersection?.({ x, y });
    for (let n = hit; n; n = n.getParent?.()) {
        const o = n.getAttr?.('filerObject');
        if (!o) continue;
        const r = n.getClientRect?.({ relativeTo: stage }) || null;
        return { ...o, rect: r ? { left: r.x, top: r.y, width: r.width, height: r.height } : null };
    }
    return null;
}
