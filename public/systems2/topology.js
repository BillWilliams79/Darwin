/**
 * NVLink Topology — Driver + Design-Language Infrastructure
 *
 * Canonical reference: memory/topology-architecture.md (single source of truth for the
 * NVLink mental model, design language, element catalog, data schema, and factory pattern).
 *
 * This file has four sections:
 *
 *   1. DESIGN LANGUAGE CONSTANTS (`DL`) — palette, typography, geometry tokens.
 *      Every visual decision references a `DL.*` constant, not a magic value.
 *
 *   2. SVG ELEMENT FACTORIES — `createCallout`, `createGpuPackage`, `createNvSwitch`,
 *      `createMesh`, `createFrame`, `createTrayBox`, `createTitle`, `createCurlyBracket`.
 *      Pure functions: input is data, output is an SVG `<g>` (or element). No globals.
 *
 *   3. TOPOLOGIES DATA REGISTRY — one record per diagram. The data record is the
 *      single source of truth for a diagram's content. Adding a new diagram = adding
 *      a record (and rarely, a new factory if a new primitive is introduced).
 *
 *   4. LEGACY DRIVER (`config`, `CALLOUTS`, `makeCallout`, `setOption`) — drives the
 *      existing static-SVG diagrams. Will be migrated diagram-by-diagram to the
 *      factory + data path. Keep working until migrated.
 *
 * Adding a new diagram (post-migration):
 *   1. Add a record to `TOPOLOGIES` with category, family, generation, scale, callouts.
 *   2. Confirm it renders via the existing factory set; add a factory if it introduces
 *      a genuinely new primitive (and update memory/topology-architecture.md element catalog).
 *   3. Add a `<button data-opt="X">` in the appropriate category tab of the HTML.
 *      The button bar reads its category from the data record.
 */

// =============================================================================
// 1. DESIGN LANGUAGE CONSTANTS
// -----------------------------------------------------------------------------
// Single source of truth for the visual vocabulary. Mirrors the "Design language"
// section of memory/topology-architecture.md. Update both together.
// =============================================================================

const DL = {
  // Palette
  bg:               '#0a1929',
  accent:           '#5fa3d4',  // cyan: strokes, leaders, dashed outlines, anchors
  accentDim:        '#4a8fc7',  // callout title-separator
  titleFill:        '#ffffff',  // main title, platform, callout title, GPU label
  bodyFill:         '#cfe4f7',  // callout body text
  bodyDim:          '#9bbcd6',  // subtle annotations
  sectionLabel:     '#7bb8de',  // section labels, NVSwitch chip labels
  dieFillActive:    '#7bb8de',  // filled die quadrant
  dieFillEmpty:     '#2a4060',  // empty die quadrant
  hopperStroke:     '#5cb83e',  // compute-hopper only
  hopperFill:       '#7cc46d',  // compute-hopper only
  nicOrange:        '#f5a623',  // ConnectX NIC only — never callouts/bandwidth
  panelGradGpu:     'url(#panel)',
  panelGradSw:      'url(#panel-sw)',
  panelGradCallout: 'url(#panel-callout)',

  // Typography (size in pt, weight as string for SVG)
  type: {
    mainTitle:     { size: 26, weight: '700', fill: '#ffffff' },
    platform:      { size: 20, weight: '700', fill: '#ffffff' },
    sectionLabel:  { size: 14, weight: '700', fill: '#7bb8de' },
    gpuLabel:      { size: 14, weight: '600', fill: '#ffffff' },
    swLabel:       { size: 12, weight: '400', fill: '#7bb8de' },
    calloutTitle:  { size: 15, weight: '700', fill: '#ffffff' },
    calloutBody:   { size: 12, weight: '400', fill: '#cfe4f7' },
    dim:           { size: 11, weight: '600', fill: '#5fa3d4' },
    hbm:           { size:  9, weight: '700', fill: '#7bb8de' },
  },

  // Geometry
  viewBox:          { w: 1400, h: 720 },
  centerX:          700,
  // Title block — tuned so the gap to NVL72 frame top (y=130) reads ~35px
  // (was 60px; ~40% tightened per Bill's "remove the line of white space" ask).
  titleY:           57,
  platformY:        87,
  gpuPackage:       { w: 80, h: 40 },
  dieCell:          { w: 17, h: 17, gap: 2 },
  nvSwitch:         { w: 80, h: 32 },
  gpuRowY:          174,
  swRowY:           544,
  meshTopY:         214,    // GPU row bottom
  meshBotY:         544,    // NVSwitch row top
  meshMidY:         379,    // (meshTopY + meshBotY) / 2
  computeTrayBox:   { x: 350, y: 164, w: 390, h: 60 },
  switchTrayBox:    { x: 350, y: 534, w: 390, h: 50 },
  // Callout x-positions are computed per-topology so the left- and right-side panels
  // are EQUIDISTANT (`edgeClear`) from the diagram's frame edges. See the helper
  // `leftCalloutXFor(t)` / `rightCalloutXFor(t)` defined below the factory section.
  edgeClear:        50,         // canonical distance from frame edge to callout panel edge (looser version preferred)
  leftCalloutW:     185,
  rightCalloutW:    185,
  defaultLeftX:     130,        // fallback when topology lacks frame & sled (= 340 - 25 - 185)
  defaultRightX:    1085,       // fallback (= 340 + 720 + 25)
  // Standard NVL72-style frame y/h. Frame x and w come from the topology data record
  // because they vary (A/C w=720, B/D w=860).
  frameY:           130,
  frameH:           500,

  // Leader-attachment geometry (v2 convention: oval encircles ALL NVLinks of the
  // adjacent target, sits in the mesh area with a CLEAR gap to the dashed tray box —
  // ovals must not touch the dashed box outline).
  leader: {
    // Compute-tray callout oval — sits 10px below the dashed compute-tray box bottom
    // (y=224 + 10 + ry=8 = cy=234). cx shifted right to center the wider fan-out at
    // this y (lines from G1 span x=410..~445 at y=234), rx widened so the oval
    // encircles all 6 lines with margin.
    computeOvalCx:   428,
    computeOvalCy:   234,
    // Switch-tray callout oval — symmetric: 10px above the dashed switch-tray box
    // top (y=534 - 10 - ry=8 = cy=516… we use cy=524 to keep 2px breathing room from
    // the box edge while preserving line coverage). Spans NVS6-1's 6 incoming lines.
    switchOvalCx:    428,
    switchOvalCy:    524,
    // Phy callout — y-centered on mesh midpoint, arrow into leftmost mesh line.
    phyY:            379,
    // Oval dimensions. ry kept thin (8); rx widened from 18 → 20 to cover the wider
    // line-fan at the new oval-y. "Don't make it huge" applies to ry, not rx.
    ovalRx:          20,
    ovalRy:          8,
    // Right-side callouts use a STRAIGHT horizontal leader. The anchor sits at the
    // MIDDLE-RIGHT edge of the target (the edge facing the panel). For G72 (rect
    // x=950 w=80): right edge x = 1030. For NVS6-36: same. The leader bridges the
    // ~55px gap between the target and the panel's left edge — clean, no routing.
    rightAnchorX:      1030,
    rightAnchorY_gpu:   194,  // = DL.gpuRowY (174) + DL.gpuPackage.h / 2 (20)
    rightAnchorY_sw:    560,  // = DL.swRowY  (544) + DL.nvSwitch.h / 2   (16)
  },

  // Callout panel height formula. Title at y+24, separator y+34, body lines start
  // at y+54 with 16px gap, last line at y+54+16(n-1)=y+38+16n, then 14px bottom
  // padding → h = 52 + 16n. This eliminates trailing white space and makes spacing
  // uniform across 1/2/3-line callouts.
  calloutH(n)       { return 52 + 16 * n; },
};

// SVG namespace + element helper. Used by every factory below.
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') el.textContent = child;
    else if (child) el.appendChild(child);
  }
  return el;
}

function svgText(x, y, text, style = {}, extra = {}) {
  return svgEl('text', {
    x, y,
    'text-anchor': extra.anchor || 'middle',
    'font-size': style.size,
    'font-weight': style.weight,
    fill: style.fill,
    ...(extra.baseline ? { 'dominant-baseline': extra.baseline } : {}),
  }, [text]);
}


// =============================================================================
// 2. SVG ELEMENT FACTORIES
// -----------------------------------------------------------------------------
// Pure: data in, SVG element out. Compose into a diagram in the renderer.
// Z-order is the caller's responsibility (frame → mesh → chips → tray boxes → callouts).
// =============================================================================

/**
 * Standard callout panel: title + separator + body lines + leader + anchor.
 * Used for every callout, left- or right-side. Heights: 1 body=76, 2=78, 3=92.
 *
 * spec = { x, y, w, h, title, lines[], leader:{from:[x,y], to:[x,y]}, anchor:'circle'|'oval'|'arrow' }
 */
function createCallout(spec) {
  const {
    x, y, w, h, title, lines, leader,
    anchor = 'circle',
    anchorRx = DL.leader.ovalRx,
    anchorRy = DL.leader.ovalRy,
    anchorR  = 3,
  } = spec;
  const cx = x + w / 2;
  const g = svgEl('g');

  g.appendChild(svgEl('rect', {
    x, y, width: w, height: h, rx: 4,
    fill: DL.panelGradCallout, stroke: DL.accent, 'stroke-width': '1.2',
  }));
  g.appendChild(svgText(cx, y + 24, title, DL.type.calloutTitle));
  g.appendChild(svgEl('line', {
    x1: x + 15, y1: y + 34, x2: x + w - 15, y2: y + 34,
    stroke: DL.accentDim, 'stroke-width': '0.8', opacity: '0.6',
  }));
  (lines || []).forEach((line, i) => {
    g.appendChild(svgText(cx, y + 54 + i * 16, line, DL.type.calloutBody));
  });

  if (leader) {
    const [fx, fy] = leader.from;
    const [tx, ty] = leader.to;
    const via      = leader.via || [];   // optional intermediate waypoints (L/Z routing)

    // Arrow leaders are a single straight line to the target (no anchor element).
    if (anchor === 'arrow') {
      g.appendChild(svgEl('line', {
        x1: tx, y1: ty, x2: fx, y2: fy,
        stroke: DL.accent, 'stroke-width': '1.5', 'marker-end': 'url(#arrowhead)',
      }));
      return g;
    }

    // For circle/oval leaders, the visible line ends at the SIDE of the anchor
    // facing the FIRST segment (toward `via[0]` if present, else toward `to`).
    // Direction inferred from sign of (next.x - fx); fallback to vertical if same x.
    const firstNext = via.length > 0 ? via[0] : [tx, ty];
    let exitX = fx, exitY = fy;
    if (anchor === 'oval' || anchor === 'circle') {
      const rx = anchor === 'oval' ? anchorRx : anchorR;
      const ry = anchor === 'oval' ? anchorRy : anchorR;
      if (firstNext[0] !== fx) {
        exitX = firstNext[0] < fx ? fx - rx : fx + rx;
      } else if (firstNext[1] !== fy) {
        exitY = firstNext[1] < fy ? fy - ry : fy + ry;
      }
    }

    // Build the polyline path: anchor-edge → via... → leader.to.
    const points = [[exitX, exitY], ...via, [tx, ty]];
    g.appendChild(svgEl('polyline', {
      points: points.map(p => p.join(',')).join(' '),
      fill: 'none', stroke: DL.accent, 'stroke-width': '1.2', 'stroke-dasharray': '5 3',
    }));

    // Anchor marker — drawn last so it sits on top of the line endpoint.
    if (anchor === 'circle') {
      g.appendChild(svgEl('circle', {
        cx: fx, cy: fy, r: anchorR, fill: DL.accent,
      }));
    } else if (anchor === 'oval') {
      g.appendChild(svgEl('ellipse', {
        cx: fx, cy: fy, rx: anchorRx, ry: anchorRy,
        fill: 'none', stroke: DL.accent, 'stroke-width': '1.5',
      }));
    }
  }
  return g;
}

/**
 * GPU package: 80×40 outer rect + 2×2 die grid + label.
 * dieMask = bitfield {TL=1, TR=2, BL=4, BR=8}. e.g. Rubin (2 dies, top filled) = 0b0011 = 3.
 */
function createGpuPackage(x, y, label, dieMask) {
  const g = svgEl('g');
  g.appendChild(svgEl('rect', {
    x, y, width: DL.gpuPackage.w, height: DL.gpuPackage.h, rx: 2,
    class: 'gpu-pkg',
  }));
  // 2×2 die grid, 4px inset on left half (x+4, x+4+19); top/bottom rows at y+2, y+21
  const cells = [
    { mask: 1, cls: 'die-tl', x: x + 4,  y: y + 2  },
    { mask: 2, cls: 'die-tr', x: x + 23, y: y + 2  },
    { mask: 4, cls: 'die-bl', x: x + 4,  y: y + 21 },
    { mask: 8, cls: 'die-br', x: x + 23, y: y + 21 },
  ];
  cells.forEach(c => {
    g.appendChild(svgEl('rect', {
      x: c.x, y: c.y, width: DL.dieCell.w, height: DL.dieCell.h, rx: 1.5,
      class: `die-cell ${c.cls}`,
    }));
  });
  // Label right of dies (centered at x + w/2 + offset toward right half)
  g.appendChild(svgText(x + 60, y + 20, label, DL.type.gpuLabel, { baseline: 'middle' }));
  return g;
}

/**
 * NVSwitch chip: 80×32 rect + label.
 */
function createNvSwitch(x, y, label) {
  const g = svgEl('g');
  g.appendChild(svgEl('rect', {
    x, y, width: DL.nvSwitch.w, height: DL.nvSwitch.h,
    fill: DL.panelGradSw, stroke: DL.accent, 'stroke-width': '1',
  }));
  g.appendChild(svgText(x + DL.nvSwitch.w / 2, y + DL.nvSwitch.h / 2, label, DL.type.swLabel, { baseline: 'middle' }));
  return g;
}

/**
 * All-to-all mesh between two rows of x-coordinates.
 * gpuXs = array of GPU center-x's at y=meshTopY (default DL.meshTopY).
 * swXs  = array of NVSwitch center-x's at y=meshBotY (default DL.meshBotY).
 */
function createMesh(gpuXs, swXs, opts = {}) {
  const yTop = opts.yTop ?? DL.meshTopY;
  const yBot = opts.yBot ?? DL.meshBotY;
  const g = svgEl('g', {
    stroke: '#a8d0ed', 'stroke-width': '0.6', opacity: '0.7', fill: 'none',
  });
  for (const gx of gpuXs) {
    for (const sx of swXs) {
      g.appendChild(svgEl('line', { x1: gx, y1: yTop, x2: sx, y2: yBot }));
    }
  }
  return g;
}

/**
 * Dashed bounding box for a tray (compute or switch) + optional section label above/below.
 * spec = { x, y, w, h, label, labelPos: 'above'|'below'|null, labelOffset: 7 }
 */
function createTrayBox(spec) {
  const { x, y, w, h, label, labelPos, labelOffset = 7 } = spec;
  const g = svgEl('g');
  g.appendChild(svgEl('rect', {
    x, y, width: w, height: h, rx: 3,
    stroke: DL.accent, 'stroke-width': '1.2', 'stroke-dasharray': '4 3', fill: 'none',
  }));
  if (label && labelPos) {
    const lx = x + w / 2;
    const ly = labelPos === 'above' ? (y - labelOffset) : (y + h + labelOffset + 12);
    g.appendChild(svgText(lx, ly, label, DL.type.sectionLabel));
  }
  return g;
}

/**
 * Diagram frame outline (NVL72-style dashed rect + small identifier text in bottom-left).
 * spec = { x, y, w, h, idText, opacity }
 */
function createFrame(spec) {
  const { x, y, w, h, idText, opacity = 0.7 } = spec;
  const g = svgEl('g');
  g.appendChild(svgEl('rect', {
    x, y, width: w, height: h, rx: 6,
    stroke: DL.accent, 'stroke-width': '1', 'stroke-dasharray': '5 3', fill: 'none',
    opacity,
  }));
  if (idText) {
    g.appendChild(svgEl('text', {
      x: x + 10, y: y + h - 7,
      'font-size': '11', 'font-weight': '600',
      'letter-spacing': '1', fill: DL.accent, opacity: '0.75',
    }, [idText]));
  }
  return g;
}

/**
 * Top title block: main title + platform line + optional tertiary line, centered at DL.centerX.
 * y-positions are tuned so the gap between the title block bottom and the diagram body
 * reads tight (~35px) — about 40% less than the original 60px.
 * spec = { title, platform: { name, suffix }, tertiary?: 'string' }
 *
 * The tertiary line uses the platform style (20pt white bold) and sits 25px below platform.
 * Used today only by Blackwell NVL36×2 ("Designed - Not Produced"); future use cases that
 * need a third title line follow the same pattern.
 */
function createTitle(spec) {
  const g = svgEl('g');
  g.appendChild(svgText(DL.centerX, DL.titleY,    spec.title, DL.type.mainTitle));
  const platformText = spec.platform
    ? (spec.platform.suffix ? `${spec.platform.name} — ${spec.platform.suffix}` : spec.platform.name)
    : '';
  g.appendChild(svgText(DL.centerX, DL.platformY, platformText, DL.type.platform));
  if (spec.tertiary) {
    g.appendChild(svgText(DL.centerX, DL.platformY + 22, spec.tertiary, DL.type.platform));
  }
  return g;
}

/**
 * Curly bracket spanning x1..x2 at y, opening 'top' (down-pointing) or 'bottom' (up-pointing).
 */
function createCurlyBracket(x1, x2, y, dir = 'top') {
  const tipOffset = dir === 'top' ? -10 : 10;
  const armOffset = dir === 'top' ? -10 : 10;
  const midX = (x1 + x2) / 2;
  const d = [
    `M ${x1},${y}`,
    `C ${x1 + 8},${y} ${x1 + 10},${y + armOffset} ${x1 + 18},${y + armOffset}`,
    `L ${midX - 5},${y + armOffset}`,
    `C ${midX - 2},${y + armOffset} ${midX - 2},${y + tipOffset * 2} ${midX},${y + tipOffset * 2}`,
    `C ${midX + 2},${y + tipOffset * 2} ${midX + 2},${y + armOffset} ${midX + 5},${y + armOffset}`,
    `L ${x2 - 18},${y + armOffset}`,
    `C ${x2 - 10},${y + armOffset} ${x2 - 8},${y} ${x2},${y}`,
  ].join(' ');
  return svgEl('path', {
    d, stroke: DL.accent, 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round',
  });
}


/**
 * Overlap guard. Pass an array of `{x, y, w, h, title}` rects; logs a console.warn
 * (and returns the count) for any pair that overlap. Used at the tail of factory
 * renders to catch layout bugs of the "callout floats over another callout" kind.
 */
function checkCalloutOverlap(rects) {
  let violations = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const sep = (a.x + a.w <= b.x) || (b.x + b.w <= a.x)
               || (a.y + a.h <= b.y) || (b.y + b.h <= a.y);
      if (!sep) {
        console.warn(`[topology] callout overlap: "${a.title}" ↔ "${b.title}"`);
        violations++;
      }
    }
  }
  return violations;
}


// =============================================================================
// 3. TOPOLOGIES DATA REGISTRY
// -----------------------------------------------------------------------------
// One record per diagram. Adding a new diagram = adding a record here. Schema is
// documented in memory/topology-architecture.md § 4. Fields marked OPTIONAL can
// be omitted; the renderer fills in defaults.
//
// CURRENT STATE: records are present for catalog/category/button purposes. Full
// renderer migration is in progress — option A is the first migration target.
// Records carry enough data to drive button rendering today; renderer-relevant
// fields are populated for A and stubbed for the rest.
// =============================================================================

const TOPOLOGIES = {
  A: {
    id: 'A', category: 'scale-up', family: 'rubin', layout: 'standard',
    label: 'Rubin NVL72',
    title: 'Rubin NVL72 Scale Up Network',
    platform: { name: 'Oberon Platform', suffix: null },
    generation: { nvlink: 6, nvswitch: 6, dies: 2, dieMask: 0b0011, cpu: 'Vera' },
    scale: { gpus: 72, nvswitches: 36, trays: 9, chipsPerTray: 4 },
    visual: {
      gpuRow:      { centers: [410,500,590,680,900,990],
                     labels:  ['G1','G2','G3','G4','G71','G72'],
                     dotsX: 790 },
      swRow:       { centers: [410,500,590,680,900,990],
                     labels:  ['NVS6-1','NVS6-2','NVS6-3','NVS6-4','NVS6-35','NVS6-36'],
                     dotsX: 790 },
      computeTray: { boxX: 350, boxW: 390, label: '1× Compute Tray' },
      switchTray:  { boxX: 350, boxW: 390, label: '1× NVSwitch Tray' },
      frame:       { idText: 'NVL72 Rack', x: 340, w: 720 },
    },
    callouts: {
      topComputeTray: { title: 'NVLink 6',
        lines: ['36× NVLink', '72× PAM4 200G BiDi', '28.8Tb - 3.6TB/s'] },
      phy: { title: '1× NVLink',
        lines: ['2× PAM4 200G BiDi', '800Gb - 100GB/s'] },
      switchTray: { title: 'NVSwitch 6',
        lines: ['72× NVLink', '144× PAM4 200G BiDi', '57.6Tb - 7.2TB/s'] },
      rightCompute: { title: '18 Compute Trays',
        lines: ['72 GPU Packages', '144 GPU die', '36 Vera CPU'] },
      rightSwitch: { title: '9 NVSwitch Trays', lines: ['36 Switch Chips'] },
    },
  },

  B: {
    id: 'B', category: 'scale-up', family: 'rubin-ultra', layout: 'standard',
    label: 'Rubin Ultra NVL72',
    title: 'Rubin Ultra NVL 72 Scale Up Network',
    platform: { name: 'Kyber Platform', suffix: 'One Cartridge' },
    generation: { nvlink: 7, nvswitch: 7, dies: 4, dieMask: 0b1111, cpu: 'Vera' },
    // Rubin Ultra NVL72 spec (per Bill, 2026-05-15): 72 GPUs (18 Compute Trays × 4
    // GPUs/tray, Kyber One Cartridge), 36 NVLinks per GPU (NVLink 7). Total GPU
    // NVLinks = 72 × 36 = 2592. With NVSwitch7 chips at 72 lanes each, fabric needs
    // 2592 / 72 = 36 switch chips = 6 NVSwitch trays × 6 chips/tray.
    // Per-GPU bandwidth: 36 × 100 GB/s = 3.6 TB/s = 28.8 Tb.
    scale: { gpus: 72, nvswitches: 36, trays: 6, chipsPerTray: 6 },
    visual: {
      gpuRow:      { centers: [410,500,590,680,900,990],
                     labels:  ['G1','G2','G3','G4','G71','G72'],
                     dotsX: 790 },
      swRow:       { centers: [410,500,590,680,770,860,970,1060],
                     labels:  ['NVS7-1','NVS7-2','NVS7-3','NVS7-4','NVS7-5','NVS7-6','NVS7-35','NVS7-36'],
                     dotsX: 915 },
      computeTray: { boxX: 350, boxW: 390, label: '1× Compute Tray' },
      switchTray:  { boxX: 350, boxW: 550, label: '1× NVSwitch Tray' },
      frame:       { idText: 'NVL72 Rack', x: 340, w: 800 },
    },
    callouts: {
      topComputeTray: { title: 'NVLink 7',
        lines: ['36× NVLink', '72× PAM4 200G BiDi', '28.8Tb - 3.6TB/s'] },
      phy: { title: '1× NVLink',
        lines: ['2× PAM4 200G BiDi', '800Gb - 100GB/s'] },
      switchTray: { title: 'NVSwitch 7',
        lines: ['72× NVLink', '144× PAM4 200G BiDi', '57.6Tb - 7.2TB/s'] },
      rightCompute: { title: '18 Compute Trays',
        lines: ['72 GPU Packages', '288 GPU die', '36 Vera CPU'] },
      rightSwitch: { title: '6 NVSwitch Trays', lines: ['36 Switch Chips'] },
    },
  },

  C: {
    id: 'C', category: 'scale-up', family: 'blackwell', layout: 'standard',
    label: 'Blackwell NVL72',
    title: 'Blackwell Ultra NVL72 Scale Up Network',
    platform: { name: 'Oberon Platform', suffix: null },
    generation: { nvlink: 5, nvswitch: 5, dies: 2, dieMask: 0b0011, cpu: 'Grace' },
    scale: { gpus: 72, nvswitches: 18, trays: 9, chipsPerTray: 2 },
    visual: {
      gpuRow:      { centers: [410,500,590,680,900,990],
                     labels:  ['G1','G2','G3','G4','G71','G72'],
                     dotsX: 790 },
      swRow:       { centers: [410,500,900,990],
                     labels:  ['NVS5-1','NVS5-2','NVS5-17','NVS5-18'],
                     dotsX: 700 },
      computeTray: { boxX: 350, boxW: 390, label: '1× Compute Tray' },
      switchTray:  { boxX: 350, boxW: 200, label: '1× NVSwitch Tray' },
      frame:       { idText: 'NVL72 Rack', x: 340, w: 720 },
    },
    callouts: {
      topComputeTray: { title: 'NVLink 5',
        lines: ['18× NVLink', '36× PAM4 200G', '7.2Tb - 1.8TB/s'] },
      phy: { title: '1× NVLink',
        lines: ['2× PAM4 200G', '400Gb - 50GB/s'] },
      switchTray: { title: 'NVSwitch 5',
        lines: ['72× NVLink', '144× PAM4 200G', '28.8Tb - 3.6TB/s'] },
      rightCompute: { title: '18 Compute Trays',
        lines: ['72 GPU Packages', '144 GPU die', '36 Grace CPU'] },
      rightSwitch: { title: '9 NVSwitch Trays', lines: ['18 Switch Chips'] },
    },
  },

  D: {
    id: 'D', category: 'scale-up', family: 'rubin-ultra', layout: 'standard',
    label: 'Rubin Ultra NVL144',
    title: 'Rubin Ultra NVL 144 Scale Up Network',
    platform: { name: 'Kyber Platform', suffix: 'Two Cartridges' },
    generation: { nvlink: 7, nvswitch: 7, dies: 4, dieMask: 0b1111, cpu: 'Vera' },
    // NVL144 spec (per Bill, 2026-05-15): 144 GPUs, 36 NVLinks per GPU (NVLink 7),
    // 12 NVSwitch trays × 6 chips = 72 switch chips total. Each NVSwitch7 chip has
    // 72 ports (same as in NVL72). Per-GPU bandwidth = 36 × 100 = 3.6 TB/s = 28.8 Tb.
    scale: { gpus: 144, nvswitches: 72, trays: 12, chipsPerTray: 6 },
    visual: {
      gpuRow:      { centers: [410,500,590,680,900,990],
                     labels:  ['G1','G2','G3','G4','G143','G144'],
                     dotsX: 790 },
      swRow:       { centers: [410,500,590,680,770,860,970,1060],
                     labels:  ['NVS7-1','NVS7-2','NVS7-3','NVS7-4','NVS7-5','NVS7-6','NVS7-71','NVS7-72'],
                     dotsX: 915 },
      computeTray: { boxX: 350, boxW: 390, label: '1× Compute Tray' },
      switchTray:  { boxX: 350, boxW: 550, label: '1× NVSwitch Tray' },
      frame:       { idText: 'NVL144 Rack', x: 340, w: 800 },
    },
    callouts: {
      topComputeTray: { title: 'NVLink 7',
        lines: ['36× NVLink', '72× PAM4 200G BiDi', '28.8Tb - 3.6TB/s'] },
      phy: { title: '1× NVLink',
        lines: ['2× PAM4 200G BiDi', '800Gb - 100GB/s'] },
      switchTray: { title: 'NVSwitch 7',
        lines: ['72× NVLink', '144× PAM4 200G BiDi', '57.6Tb - 7.2TB/s'] },
      rightCompute: { title: '36 Compute Trays',
        lines: ['144 GPU Packages', '576 GPU die', '72 Vera CPU'] },
      rightSwitch: { title: '12 NVSwitch Trays', lines: ['72 Switch Chips'] },
    },
  },

  E: {
    id: 'E', category: 'scale-up', family: 'hopper', layout: 'hopper-sled',
    label: 'Hopper NVL8',
    title: 'Hopper DGX H100 Scale Up Network',
    platform: { name: 'DGX / HGX Platform', suffix: null },
    generation: { nvlink: 4, nvswitch: 4, dies: 1, dieMask: 0b0001, cpu: 'x86' },
    scale: { gpus: 8, nvswitches: 4, trays: 1, chipsPerTray: 4 },
    visual: {
      gpuRow:      { centers: [350,450,550,650,750,850,950,1050],
                     labels:  ['G1','G2','G3','G4','G5','G6','G7','G8'],
                     dotsX: null },
      swRow:       { centers: [400,600,800,1000],
                     labels:  ['NVS4-1','NVS4-2','NVS4-3','NVS4-4'],
                     dotsX: null },
      // HGX sled encloses BOTH GPUs and NVSwitches — no separate tray dashed boxes.
      // The sled dashed-box carries its OWN identifier "HGX H100" inside its bottom-left
      // corner (like NVL72 Rack does in A); no separate label or curly bracket above.
      sledBox:     { x: 300, y: 164, w: 800, h: 416, idText: 'HGX H100' },
      computeTray: null,
      switchTray:  null,
      frame:       null,
      topCurly:    false,
    },
    callouts: {
      topComputeTray: { title: 'NVLink 4',
        lines: ['18× NVLink', '36× PAM4 100G', '3.6Tb - 900GB/s'] },
      phy: { title: '1× NVLink',
        lines: ['2× PAM4 100G', '200Gb - 25GB/s'] },
      switchTray: { title: 'NVSwitch 4',
        lines: ['64× NVLink', '128× PAM4 100G', '12.8Tb - 1.6TB/s'] },
      // Asymmetric NVLink fan-out clarification (per Bill — moved out of the phy
      // callout body to a standalone right-side annotation).
      rightAsymmetry: { title: 'Asymmetric Fan-Out',
        lines: ['Each GPU spreads its', '18 NVLinks across the 4', 'NVSwitches in a 4-5-5-4', 'lane pattern.'] },
      rightCompute: null,
      rightSwitch:  null,
    },
  },

  K: {
    id: 'K', category: 'scale-up', family: 'blackwell', layout: 'two-rack',
    label: 'Blackwell NVL36×2',
    title: 'Blackwell NVL36 × 2 Scale Up Network',
    platform: { name: 'Oberon Platform', suffix: 'Two-Rack Configuration' },
    generation: { nvlink: 5, nvswitch: 5, dies: 2, dieMask: 0b0011, cpu: 'Grace' },
    scale: { gpus: 72, nvswitches: 36, trays: 18, chipsPerTray: 2 },
    // Two-rack layout. Each rack gets its own NVL36 dashed frame outline (mirror of A's
    // NVL72 frame). Racks mirror vertically; the inter-rack mesh + annotation callout
    // fill the middle band.
    racks: [
      { name: 'Rack #1',
        // NVL36 dashed frame, top rack.
        // Geometry rules being enforced (see § Design language v2):
        //   • title-to-frame whitespace ≥ 16px (frame y=115; platform descender ~91 → 24px gap)
        //   • tray-label whitespace ≥ 10px from dashed box edge (labelOffset=14 "above"
        //     gives gap = 14-4 = 10; labelOffset=8 "below" gives gap = 8+2 = 10)
        //   • frame identifier (NVL36 Rack) ≥ 5px below bottom-most label
        //     (switch label descender at y=352, identifier ascender at y=363 → 11px gap)
        frame: { idText: 'NVL36 Rack', x: 340, y: 115, w: 720, h: 263 },
        gpuRow: { centers: [410,500,590,680,900,990], y: 154,
                  labels: ['G1','G2','G3','G4','G35','G36'], dotsX: 790, dotsY: 179 },
        swRow:  { centers: [410,500,590,900,990], y: 288,
                  labels: ['NVS5-1','NVS5-2','NVS5-3','NVS5-17','NVS5-18'], dotsX: 745, dotsY: 304 },
        computeTrayBox: { x: 350, y: 144, w: 390, h: 60, label: '1× Compute Tray', labelPos: 'above', labelOffset: 14 },
        switchTrayBox:  { x: 350, y: 278, w: 200, h: 50, label: '1× NVSwitch Tray', labelPos: 'below', labelOffset: 8 },
        meshTopY: 194, meshBotY: 288,
        rightCompute: { title: '9 Compute Trays',
          lines: ['36 GPU Packages', '72 GPU die', '18 Grace CPU'],
          anchorY: 174 },
        rightSwitch:  { title: '9 NVSwitch Trays', lines: ['18 Switch Chips'],
          anchorY: 304 },
      },
      { name: 'Rack #2',
        // NVL36 dashed frame, bottom rack. Mirrors rack 1's roles vertically: switch
        // tray at top, compute tray at bottom. Frame height 275 (vs rack 1's 263) to
        // accommodate the same identifier-below-compute-label rule (the asymmetric
        // createTrayBox "below" formula puts compute label 12px farther from its box
        // than rack 1's "above" compute label is from its).
        frame: { idText: 'NVL36 Rack', x: 340, y: 395, w: 720, h: 275 },
        gpuRow: { centers: [410,500,590,680,900,990], y: 574,
                  labels: ['G37','G38','G39','G40','G71','G72'], dotsX: 790, dotsY: 599 },
        swRow:  { centers: [410,500,590,900,990], y: 430,
                  labels: ['NVS5-19','NVS5-20','NVS5-21','NVS5-35','NVS5-36'], dotsX: 745, dotsY: 446 },
        computeTrayBox: { x: 350, y: 564, w: 390, h: 60, label: '1× Compute Tray', labelPos: 'below', labelOffset: 8 },
        switchTrayBox:  { x: 350, y: 420, w: 200, h: 50, label: '1× NVSwitch Tray', labelPos: 'above', labelOffset: 14 },
        meshTopY: 462, meshBotY: 574,
        rightCompute: { title: '9 Compute Trays',
          lines: ['36 GPU Packages', '72 GPU die', '18 Grace CPU'],
          anchorY: 594 },
        rightSwitch:  { title: '9 NVSwitch Trays', lines: ['18 Switch Chips'],
          anchorY: 446 },
      },
    ],
    // Inter-rack annotation callout — sits on the LEFT (x=20..320). Width shrunk to
    // 300 so the right edge (x=320) clears the rack frames at x=340 by 20px (no overlap
    // with the rack dashed lines). Design rule: mesh-detail callouts are centered on
    // the mesh's vertical mid-point. Inter-rack mesh y=320..430 → mid y=375 → h=100,
    // panel y=325 puts the center exactly on the mesh midpoint.
    interRackCallout: {
      x: 20, y: 325, w: 300, h: 100,
      title: 'Inter-Rack All to All',
      lines: ['18 NVswitches per Rack',
              '36 NVLinks to Compute Trays per NVswitch',
              '36 NVLinks for Inter-rack switching per NVSwitch'],
    },
  },
  // GB300 compute sled lives on the Blackwell ULTRA column; reuses the compute-blackwell
  // static SVG with ConnectX-8 NICs + "800Gb IB/400GbE" output.
  F: { id: 'F', category: 'compute', family: 'blackwell-ultra',
    label: 'GB300', title: 'GB300 Compute Sled' },
  // GB200 compute sled — Blackwell column. Reuses the compute-blackwell static SVG
  // but setOptionLegacy overrides the ConnectX-8/CX-8 labels to "ConnectX-7" and the
  // bandwidth lines to "400GbE/IB".
  L: { id: 'L', category: 'compute', family: 'blackwell',
    label: 'GB200', title: 'GB200 Compute Sled', reusesOpt: 'F' },
  G: { id: 'G', category: 'compute', family: 'rubin',
    label: 'Rubin Compute', title: 'Vera Rubin sled' },
  H: { id: 'H', category: 'compute', family: 'rubin',
    label: 'Rubin Compute (Strata)', title: 'Vera Rubin sled — Strata view' },
  I: { id: 'I', category: 'compute', family: 'hopper',
    label: 'Hopper Compute', title: 'DGX H100 Server' },
  J: { id: 'J', category: 'compute', family: 'rubin-ultra',
    label: 'Rubin Ultra Compute', title: 'Vera Rubin Ultra sled',
    reusesOpt: 'H' },
};

// Categories registered in stable order for the button bar.
const CATEGORIES = [
  { id: 'scale-up', label: 'Scale-Up',
    description: 'NVLink fabric topologies (rack-level)' },
  { id: 'compute',  label: 'Compute',
    description: 'Single-tray block diagrams' },
  // Reserved slots for future categories. Buttons for these only appear when
  // at least one TOPOLOGIES record has the matching category id.
  { id: 'scale-out', label: 'Scale-Out',
    description: 'InfiniBand / Ethernet fat-trees (data-center)' },
  { id: 'system',    label: 'System',
    description: 'End-to-end views' },
  { id: 'component', label: 'Components',
    description: 'Chip-level details' },
];

// Family order within a category (Hopper → Blackwell → Rubin → Rubin Ultra).
const FAMILY_ORDER = ['hopper', 'blackwell', 'rubin', 'rubin-ultra'];


// =============================================================================
// 4. LEGACY DRIVER (existing static-SVG renderer — to be migrated)
// =============================================================================

// =============================================================================
// CONFIG — per-option titles, NVLink/NVSwitch specs, trailing label overrides
// =============================================================================

const config = {
  A: {
    title:    "Rubin NVL72 Scale Up Network",
    platform: "Oberon Platform",
    topSub:   "",
    topSub2:  "",
    gen:      "NVLink 6",
    topLane:  "36× NVLink",
    topSerdes:"72× PAM4 200G BiDi",
    topThru:  "28.8 Tb · 3.6 TB/s",
    line2:    "2× PAM4 200G BiDi",
    line3:    "800 Gb · 100 GB/s",
    swTitle:  "NVSwitch 6",
    swLane:   "72× NVLink",
    swSerdes: "144× PAM4 200G BiDi",
    swThru:   "57.6 Tb NVLink",
    gpuLast:  ["G71", "G72"]
  },
  B: {
    title:    "Rubin Ultra NVL 72 Scale Up Network",
    platform: "Kyber Platform - One Cartridge",
    topSub:   "",
    topSub2:  "",
    gen:      "NVLink 7",
    topLane:  "72× NVLink",
    topSerdes:"144× PAM4 200G BiDi",
    topThru:  "57.6 Tb · 7.2 TB/s",
    line2:    "2× PAM4 200G BiDi",
    line3:    "800 Gb · 100 GB/s",
    swTitle:  "NVSwitch 7",
    swLane:   "72× NVLink",
    swSerdes: "144× PAM4 200G BiDi",
    swThru:   "57.6 Tb NVLink",
    gpuLast:  ["G71", "G72"],
    swLast:   ["NVS7-71", "NVS7-72"],
    bottomSub:"12 Rubin Ultra NVSwitch Trays"
  },
  C: {
    title:    "Blackwell Ultra NVL72 Scale Up Network",
    platform: "Oberon Platform",
    topSub:   "",
    topSub2:  "",
    gen:      "NVLink 5",
    topLane:  "18× NVLink",
    topSerdes:"36× PAM4 200G",
    topThru:  "7.2 Tb · 1.8 TB/s",
    line2:    "2× PAM4 200G",
    line3:    "400 Gb · 50 GB/s",
    swTitle:  "NVSwitch 5",
    swLane:   "72× NVLink",
    swSerdes: "144× PAM4 200G",
    swThru:   "28.8 Tb NVLink",
    gpuLast:  ["G71", "G72"]
  },
  D: {
    title:    "Rubin Ultra NVL 144 Scale Up Network",
    platform: "Kyber Platform - Two Cartridges",
    topSub:   "",
    topSub2:  "",
    gen:      "NVLink 7",
    topLane:  "72× NVLink",
    topSerdes:"144× PAM4 200G BiDi",
    topThru:  "57.6 Tb · 7.2 TB/s",
    line2:    "2× PAM4 200G BiDi",
    line3:    "800 Gb · 100 GB/s",
    swTitle:  "NVSwitch 7",
    swLane:   "72× NVLink",
    swSerdes: "144× PAM4 200G BiDi",
    swThru:   "57.6 Tb NVLink",
    gpuLast:  ["G143", "G144"],
    swLast:   ["NVS7-143", "NVS7-144"],
    bottomSub:"24 Rubin Ultra NVSwitch Trays"
  },
  E: {
    title:    "Hopper DGX H100 Scale Up Network",
    platform: "DGX / HGX Platform",
    topSub:   "1× HGX H100 - 8 GPU packages - 8 GPU die",
    topSub2:  "4 NVSwitch packages / die",
    gen:      "NVLink 4",
    topLane:  "18× NVLink",
    topSerdes:"36× PAM4 100G",
    topThru:  "3.6 Tb · 900 GB/s",
    line2:    "2× PAM4 100G",
    line3:    "200 Gb · 25 GB/s",
    swTitle:  "NVSwitch 4",
    swLane:   "64x NVLink",
    swSerdes: "128x PAM4 100G",
    swThru:   "12.8 Tb NVLink",
    gpuLast:  ["G71", "G72"]
  },
  F: { title: "GB300 Compute Sled",           platform: "Oberon Platform", topSub: "1× Compute Tray - Internal Block Diagram" },
  L: { title: "GB200 Compute Sled",           platform: "Oberon Platform", topSub: "1× Compute Tray - Internal Block Diagram" },
  G: { title: "Vera Rubin Compute Tray",      platform: "Oberon Platform", topSub: "1× Compute Tray - Internal Block Diagram" },
  H: { title: "Vera Rubin Compute Tray",      platform: "Oberon Platform", topSub: "1× Compute Tray" },
  I: { title: "Hopper Server",                platform: "DGX H100 Server", topSub: "" },
  J: { title: "Vera Rubin Ultra Compute Tray",platform: "Oberon Platform", topSub: "1× Compute Tray" },
  K: {
    title:    "Blackwell NVL36 × 2 Scale Up Network",
    platform: "Oberon Platform · Two-Rack Configuration",
    topSub:   "",
    topSub2:  "",
    gen:      "NVLink 5",
    topLane:  "18× NVLink",
    topSerdes:"36× PAM4 200G",
    topThru:  "7.2 Tb · 1.8 TB/s",
    line2:    "2× PAM4 200G",
    line3:    "400 Gb · 50 GB/s",
    swTitle:  "NVSwitch 5",
    swLane:   "72× NVLink",
    swSerdes: "144× PAM4 200G",
    swThru:   "28.8 Tb NVLink",
    gpuLast:  ["G71", "G72"]
  }
};

// =============================================================================
// CALLOUTS — per-option right-side summary callouts
// -----------------------------------------------------------------------------
// Each entry is an array of callout specs. Each spec is rendered by
// makeCallout() into an SVG <g> with a panel rect, title, separator, body
// lines, a horizontal leader, and an anchor dot.
//
// Numbers are sourced from each system's published topology:
//   - "Compute Trays"     : 4 GPUs/tray on Oberon, 4 GPUs/tray on Kyber (per cartridge)
//   - "Full reticle die"  : Hopper 1/GPU, Blackwell 2/GPU, Rubin 2/GPU, Rubin Ultra 4/GPU
//   - CPU family          : Blackwell pairs with Grace; Rubin & Rubin Ultra pair with Vera
//   - "Switch Chips"      : trays × chips/tray (Rubin 9×4=36, Blackwell 9×2=18,
//                           Rubin Ultra NVL72/144 12×6=72 — same chip count, 2× lanes/chip on NVL144)
// =============================================================================

const CALLOUTS = {
  A: [
    { kind: 'compute',
      x: 1085, y: 120, w: 185, h: 100,
      title: "18 Compute Trays",
      lines: ["72 GPU Packages", "144 GPU die", "36 Vera CPU"],
      leader: { from: [950, 174], to: [1085, 174] } },
    { kind: 'switch',
      x: 1085, y: 500, w: 185, h: 78,
      title: "9 NVSwitch Trays",
      lines: ["36 Switch Chips"],
      leader: { from: [950, 544], to: [1085, 544] } }
  ],
  B: [
    { kind: 'compute',
      x: 1050, y: 120, w: 185, h: 100,
      title: "18 Compute Trays",
      lines: ["72 GPU Packages", "288 Full reticle die", "36 Vera CPU"],
      leader: { from: [950, 174], to: [1050, 174] } },
    { kind: 'switch',
      x: 1190, y: 500, w: 185, h: 78,
      title: "12 NVSwitch Trays",
      lines: ["72 Switch Chips"],
      leader: { from: [1090, 544], to: [1190, 544] } }
  ],
  C: [
    { kind: 'compute',
      x: 1050, y: 120, w: 185, h: 100,
      title: "18 Compute Trays",
      lines: ["72 GPU Packages", "144 Full reticle die", "36 Grace CPU"],
      leader: { from: [950, 174], to: [1050, 174] } },
    { kind: 'switch',
      x: 1050, y: 500, w: 185, h: 78,
      title: "9 NVSwitch Trays",
      lines: ["18 Switch Chips"],
      leader: { from: [950, 544], to: [1050, 544] } }
  ],
  D: [
    { kind: 'compute',
      x: 1050, y: 120, w: 185, h: 100,
      title: "36 Compute Trays",
      lines: ["144 GPU Packages", "576 Full reticle die", "72 Vera CPU"],
      leader: { from: [950, 174], to: [1050, 174] } },
    { kind: 'switch',
      x: 1190, y: 500, w: 185, h: 78,
      title: "12 NVSwitch Trays",
      lines: ["72 Switch Chips"],
      leader: { from: [1090, 544], to: [1190, 544] } }
  ],
  K: [
    // Rack 1 — top half. Panels centered on rack ROW centers (G36 mid-y=174,
    // NVS5-18 mid-y=304) so leaders sit horizontally on the panel mid-line and
    // each callout sits opposite its target row instead of straddling the title.
    { kind: 'compute',
      x: 1050, y: 128, w: 185, h: 92,
      title: "9 Compute Trays",
      lines: ["36 GPU Packages", "72 Full reticle die", "18 Grace CPU"],
      leader: { from: [950, 174], to: [1050, 174] } },
    { kind: 'switch',
      x: 1050, y: 266, w: 185, h: 76,
      title: "9 NVSwitch Trays",
      lines: ["18 Switch Chips"],
      leader: { from: [950, 304], to: [1050, 304] } },
    // Rack 2 — bottom half (NVS5-36 mid-y=446, G72 mid-y=594).
    { kind: 'switch',
      x: 1050, y: 408, w: 185, h: 76,
      title: "9 NVSwitch Trays",
      lines: ["18 Switch Chips"],
      leader: { from: [950, 446], to: [1050, 446] } },
    { kind: 'compute',
      x: 1050, y: 548, w: 185, h: 92,
      title: "9 Compute Trays",
      lines: ["36 GPU Packages", "72 Full reticle die", "18 Grace CPU"],
      leader: { from: [950, 594], to: [1050, 594] } }
  ]
};

// =============================================================================
// SVG factory — makeCallout(spec) → SVG <g> element
// -----------------------------------------------------------------------------
// A single helper that materialises a callout's geometry from data. The visual
// vocabulary (panel gradient, accent colors, font sizes, dash patterns) is the
// shared one used across every callout in the diagram.
// =============================================================================

// Back-compat alias: existing callers pass right-callout specs through `makeCallout`.
// Delegates to `createCallout` (the canonical factory defined in section 2 above).
// SVG_NS and svgEl are also defined in section 2 — no need to redeclare here.
function makeCallout(spec) {
  return createCallout(spec);
}

function renderRightCallouts(opt) {
  const host = document.getElementById('right-callouts');
  if (!host) return;
  // Clear and repopulate
  while (host.firstChild) host.removeChild(host.firstChild);
  const specs = CALLOUTS[opt];
  if (!specs) return;
  specs.forEach(spec => host.appendChild(makeCallout(spec)));
}

// =============================================================================
// View id sets — drives show/hide between scale-up vs compute-tray diagrams
// =============================================================================

const SCALE_UP_IDS = [
  'default-top', 'hopper-top', 'top-callout',
  'option-A', 'option-B', 'option-C', 'option-E', 'option-K',
  'phy-callout', 'switch-callout', 'right-callouts'
];

const COMPUTE_VIEW_IDS = [
  'compute-blackwell', 'compute-rubin', 'compute-rubin2', 'compute-hopper'
];

// =============================================================================
// FACTORY-PATH RENDERER (currently used for opt A only — Rubin NVL72)
// -----------------------------------------------------------------------------
// Builds the entire diagram for a given opt from `TOPOLOGIES[opt]` via the
// element factories in section 2. When this path is active for an opt, the
// static SVG groups for that opt are hidden and `#factory-canvas` is shown.
// =============================================================================

// Set of opts that render via the factory path. As diagrams are migrated, add
// their letter here. Anything not in this set falls through to the legacy path.
const FACTORY_OPTS = new Set(['A', 'B', 'C', 'D', 'E', 'K']);

// Static elements that get hidden when the factory path is active for a scale-up
// diagram. These are the elements the factory replaces.
const FACTORY_HIDDEN_STATIC = [
  'main-title', 'platform', 'top-sub', 'top-sub2',
  'default-top', 'hopper-top',
  'top-callout', 'phy-callout', 'switch-callout',
  'option-A', 'option-B', 'option-C', 'option-E', 'option-K',
  'right-callouts',
];

function setStaticDisplay(visible) {
  for (const id of FACTORY_HIDDEN_STATIC) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }
}

// -----------------------------------------------------------------------------
// Per-topology x-position helpers — implements the equidistant-from-frame rule.
// Left- and right-side callout panels are placed `DL.edgeClear` (25px) from the
// diagram's frame edge. For Hopper (no NVL frame) the HGX sled is the framing
// element. Topologies that have neither (only K so far) handle positions themselves.
// -----------------------------------------------------------------------------
function leftCalloutXFor(t) {
  if (t.visual.frame)   return t.visual.frame.x   - DL.edgeClear - DL.leftCalloutW;
  if (t.visual.sledBox) return t.visual.sledBox.x - DL.edgeClear - DL.leftCalloutW;
  return DL.defaultLeftX;
}
function rightCalloutXFor(t) {
  if (t.visual.frame)   return t.visual.frame.x   + t.visual.frame.w   + DL.edgeClear;
  if (t.visual.sledBox) return t.visual.sledBox.x + t.visual.sledBox.w + DL.edgeClear;
  return DL.defaultRightX;
}

// Where the right-side callout's anchor sits on its target's RIGHT edge. The
// rightmost visible target's right edge = (last center) + nvSwitch.w/2 for switches
// or gpuPackage.w/2 for GPUs. Center-of-edge gives a clean horizontal leader.
function rightTargetEdgeX(centers, halfW) {
  return centers[centers.length - 1] + halfW;
}

// =============================================================================
// FACTORY-PATH RENDERERS
// -----------------------------------------------------------------------------
// renderFromFactory(opt) dispatches by `t.layout` to one of three renderers:
//   - 'standard'    — A/B/C/D: NVL72/144 frame, GPU row over mesh over NVSwitch row,
//                     3 left callouts + 2 right callouts.
//   - 'hopper-sled' — E: HGX sled enclosing GPUs+NVSwitches, no NVL frame, no tray
//                     dashed boxes, 8 GPUs unabbreviated, 4 NVSwitches, top curly,
//                     phy callout with asymmetric 4-5-5-4 addendum, no right callouts.
//   - 'two-rack'    — K: two stacked racks with inter-rack mesh + LEFT-side annotation
//                     callout + per-rack right callouts (4 total).
// =============================================================================

function renderFromFactory(opt) {
  const t = TOPOLOGIES[opt];
  const host = document.getElementById('factory-canvas');
  if (!t || !host) return;
  while (host.firstChild) host.removeChild(host.firstChild);

  // Body-class drives die-fill via CSS rules (body.opt-A .die-tl, etc.). Opt D reuses
  // B's die styling (Rubin Ultra — 4 dies filled), so the body class maps D → B (same
  // as legacy setOption did). Otherwise the GPUs in NVL144 would render with no dies on.
  const dieClass = (opt === 'D') ? 'B' : opt;
  document.body.className = 'opt-' + dieClass;

  switch (t.layout) {
    case 'standard':    renderStandardScaleUp(t, host); break;
    case 'hopper-sled': renderHopperLayout(t, host);    break;
    case 'two-rack':    renderTwoRackLayout(t, host);   break;
    default:            renderStandardScaleUp(t, host);
  }

  host.style.display = '';
  document.querySelectorAll('button[data-opt]').forEach(b => {
    b.classList.toggle('selected', b.dataset.opt === opt);
  });
  document.title = t.title;
}

// ---------------------------------------------------------------------------
// Layout: standard scale-up (A, B, C, D)
// ---------------------------------------------------------------------------
function renderStandardScaleUp(t, host) {
  const v = t.visual;
  const calloutRects = [];

  // Layer 1: NVL72/144 frame
  if (v.frame) {
    host.appendChild(createFrame({
      x: v.frame.x, y: DL.frameY, w: v.frame.w, h: DL.frameH,
      idText: v.frame.idText,
    }));
  }

  // Layer 2: Title block
  host.appendChild(createTitle({ title: t.title, platform: t.platform }));

  // Layer 3: Mesh (every GPU center to every NVSwitch center, all-to-all)
  host.appendChild(createMesh(v.gpuRow.centers, v.swRow.centers));

  // Layer 4: Compute-tray dashed box + GPU row
  host.appendChild(createTrayBox({
    x: v.computeTray.boxX, y: DL.computeTrayBox.y,
    w: v.computeTray.boxW, h: DL.computeTrayBox.h,
    label: v.computeTray.label, labelPos: 'above', labelOffset: 5,
  }));
  v.gpuRow.centers.forEach((cx, i) => {
    host.appendChild(createGpuPackage(cx - DL.gpuPackage.w / 2, DL.gpuRowY,
                                       v.gpuRow.labels[i], t.generation.dieMask));
  });
  if (v.gpuRow.dotsX !== null && v.gpuRow.dotsX !== undefined) {
    host.appendChild(svgText(v.gpuRow.dotsX, 199, '. . .',
                             { size: 22, weight: '400', fill: DL.bodyFill }));
  }

  // Layer 5: NVSwitch-tray dashed box + NVSwitch row
  host.appendChild(createTrayBox({
    x: v.switchTray.boxX, y: DL.switchTrayBox.y,
    w: v.switchTray.boxW, h: DL.switchTrayBox.h,
    label: v.switchTray.label, labelPos: 'below', labelOffset: 14,
  }));
  v.swRow.centers.forEach((cx, i) => {
    host.appendChild(createNvSwitch(cx - DL.nvSwitch.w / 2, DL.swRowY, v.swRow.labels[i]));
  });
  if (v.swRow.dotsX !== null && v.swRow.dotsX !== undefined) {
    host.appendChild(svgText(v.swRow.dotsX, 566, '. . .',
                             { size: 22, weight: '400', fill: DL.bodyFill }));
  }

  // Layer 6: Callouts. x-positions computed from frame for equidistant placement.
  const leftX    = leftCalloutXFor(t);
  const leftRight = leftX + DL.leftCalloutW;
  const rightX   = rightCalloutXFor(t);
  const swRightX = rightTargetEdgeX(v.swRow.centers, DL.nvSwitch.w / 2);
  const gpuRightX = rightTargetEdgeX(v.gpuRow.centers, DL.gpuPackage.w / 2);

  // (1) Top compute-tray callout — leader enters at MIDDLE of panel's right edge
  // (design rule: left-side callouts symmetric with right-side callouts; leader
  // origin = oval, leader terminus = middle of the side of the panel facing it).
  const topL = t.callouts.topComputeTray;
  const topH = DL.calloutH(topL.lines.length);
  const topY = DL.leader.computeOvalCy - topH / 2;
  calloutRects.push({ x: leftX, y: topY, w: DL.leftCalloutW, h: topH, title: 'topComputeTray' });
  host.appendChild(createCallout({
    x: leftX, y: topY, w: DL.leftCalloutW, h: topH,
    title: topL.title, lines: topL.lines,
    leader: { from: [DL.leader.computeOvalCx, DL.leader.computeOvalCy],
              to:   [leftRight,               DL.leader.computeOvalCy] },
    anchor: 'oval',
  }));

  // (2) Phy callout — y-centered on mesh midpoint, arrow leader.
  const phyL = t.callouts.phy;
  const phyH = DL.calloutH(phyL.lines.length);
  const phyY = DL.leader.phyY - phyH / 2;
  calloutRects.push({ x: leftX, y: phyY, w: DL.leftCalloutW, h: phyH, title: 'phy' });
  host.appendChild(createCallout({
    x: leftX, y: phyY, w: DL.leftCalloutW, h: phyH,
    title: phyL.title, lines: phyL.lines,
    leader: { from: [410, DL.leader.phyY], to: [leftRight, DL.leader.phyY] },
    anchor: 'arrow',
  }));

  // (3) Switch-tray callout — leader enters at MIDDLE of panel's right edge
  // (mirror of top compute-tray rule).
  const swL = t.callouts.switchTray;
  const swH = DL.calloutH(swL.lines.length);
  const swY = DL.leader.switchOvalCy - swH / 2;
  calloutRects.push({ x: leftX, y: swY, w: DL.leftCalloutW, h: swH, title: 'switchTray' });
  host.appendChild(createCallout({
    x: leftX, y: swY, w: DL.leftCalloutW, h: swH,
    title: swL.title, lines: swL.lines,
    leader: { from: [DL.leader.switchOvalCx, DL.leader.switchOvalCy],
              to:   [leftRight,              DL.leader.switchOvalCy] },
    anchor: 'oval',
  }));

  // (4) Right compute summary — straight horizontal leader from G72 right edge.
  if (t.callouts.rightCompute) {
    const rcL = t.callouts.rightCompute;
    const rcH = DL.calloutH(rcL.lines.length);
    const rcY = DL.leader.rightAnchorY_gpu - rcH / 2;
    calloutRects.push({ x: rightX, y: rcY, w: DL.rightCalloutW, h: rcH, title: 'rightCompute' });
    host.appendChild(createCallout({
      x: rightX, y: rcY, w: DL.rightCalloutW, h: rcH,
      title: rcL.title, lines: rcL.lines,
      leader: { from: [gpuRightX, DL.leader.rightAnchorY_gpu],
                to:   [rightX,    DL.leader.rightAnchorY_gpu] },
      anchor: 'circle',
    }));
  }

  // (5) Right switch summary — anchor at MIDDLE-RIGHT of last NVSwitch.
  if (t.callouts.rightSwitch) {
    const rsL = t.callouts.rightSwitch;
    const rsH = DL.calloutH(rsL.lines.length);
    const rsY = DL.leader.rightAnchorY_sw - rsH / 2;
    calloutRects.push({ x: rightX, y: rsY, w: DL.rightCalloutW, h: rsH, title: 'rightSwitch' });
    host.appendChild(createCallout({
      x: rightX, y: rsY, w: DL.rightCalloutW, h: rsH,
      title: rsL.title, lines: rsL.lines,
      leader: { from: [swRightX, DL.leader.rightAnchorY_sw],
                to:   [rightX,   DL.leader.rightAnchorY_sw] },
      anchor: 'circle',
    }));
  }

  checkCalloutOverlap(calloutRects);
}

// ---------------------------------------------------------------------------
// Layout: Hopper HGX sled (E)
// ---------------------------------------------------------------------------
function renderHopperLayout(t, host) {
  const v = t.visual;
  const calloutRects = [];

  // Title
  host.appendChild(createTitle({ title: t.title, platform: t.platform }));

  // Top curly bracket (rendered only if data record explicitly asks for it).
  if (v.topCurly) {
    const sledX1 = v.sledBox.x + 10;
    const sledX2 = v.sledBox.x + v.sledBox.w - 10;
    host.appendChild(createCurlyBracket(sledX1, sledX2, 142, 'top'));
  }

  // HGX sled dashed box — encloses BOTH GPUs and NVSwitches; carries its own
  // identifier ("HGX H100") in its bottom-left interior, like the NVL72 frame does.
  host.appendChild(svgEl('rect', {
    x: v.sledBox.x, y: v.sledBox.y, width: v.sledBox.w, height: v.sledBox.h,
    rx: 3, stroke: DL.accent, 'stroke-width': '1.2',
    'stroke-dasharray': '4 3', fill: 'none',
  }));
  if (v.sledBox.idText) {
    host.appendChild(svgEl('text', {
      x: v.sledBox.x + 10, y: v.sledBox.y + v.sledBox.h - 7,
      'font-size': '11', 'font-weight': '600',
      'letter-spacing': '1', fill: DL.accent, opacity: '0.75',
    }, [v.sledBox.idText]));
  }

  // Mesh — 8 GPUs × 4 NVSwitches asymmetric
  host.appendChild(createMesh(v.gpuRow.centers, v.swRow.centers));

  // GPU row (no abbreviation)
  v.gpuRow.centers.forEach((cx, i) => {
    host.appendChild(createGpuPackage(cx - DL.gpuPackage.w / 2, DL.gpuRowY,
                                       v.gpuRow.labels[i], t.generation.dieMask));
  });

  // NVSwitch row (no tray box, no abbreviation — inside the sled)
  v.swRow.centers.forEach((cx, i) => {
    host.appendChild(createNvSwitch(cx - DL.nvSwitch.w / 2, DL.swRowY, v.swRow.labels[i]));
  });

  // Left callouts — equidistant from the SLED's left edge (no special shift).
  const leftX    = leftCalloutXFor(t);
  const leftRight = leftX + DL.leftCalloutW;

  // Top compute-tray callout — oval sits in the MESH AREA below G1, clear of the chip.
  // Same convention as standard layouts: oval cy 20px below G1's bottom (y=214 → cy=234).
  const topL = t.callouts.topComputeTray;
  const topH = DL.calloutH(topL.lines.length);
  const topOvalCy = DL.leader.computeOvalCy;     // 234 — 20px below G1, oval body y=226..242
  // Leader enters at MIDDLE of panel's right edge (design rule applied to all scale-ups).
  const topY = topOvalCy - topH / 2;
  // cx of the oval: shifted right of G1 center so oval covers the NVLink fan-out at y=234.
  // Hopper's leftmost mesh fans from G1 (350) outward; at y=234 the rightmost line reaches
  // ~x=383. We place oval at cx=370 rx=20 → covers x=350..390 (includes all fan-out lines).
  const topOvalCx = v.gpuRow.centers[0] + 20;     // = 370 for Hopper
  calloutRects.push({ x: leftX, y: topY, w: DL.leftCalloutW, h: topH, title: 'topComputeTray' });
  host.appendChild(createCallout({
    x: leftX, y: topY, w: DL.leftCalloutW, h: topH,
    title: topL.title, lines: topL.lines,
    leader: { from: [topOvalCx, topOvalCy],
              to:   [leftRight, topOvalCy] },
    anchor: 'oval',
  }));

  // Phy callout — arrow points at the LEFTMOST MESH LINE at the mesh midpoint (y=379).
  // Hopper's leftmost mesh line runs (G1=350, y=214) → (NVS4-1=400, y=544); at y=379 its
  // x = 350 + (400−350)·(379−214)/(544−214) = 350 + 25 = 375. The arrow tip lands ON the
  // line, not in empty space. (Addendum about 4-5-5-4 fan-out removed per design language —
  // body lines are reserved for NVLink-spec content, not prose.)
  const phyL = t.callouts.phy;
  const phyH = DL.calloutH(phyL.lines.length);
  const phyY = DL.leader.phyY - phyH / 2;
  const gpuX = v.gpuRow.centers[0];
  const swX  = v.swRow.centers[0];
  const phyLineX = gpuX + (swX - gpuX) * (DL.leader.phyY - DL.meshTopY) / (DL.meshBotY - DL.meshTopY);
  calloutRects.push({ x: leftX, y: phyY, w: DL.leftCalloutW, h: phyH, title: 'phy' });
  host.appendChild(createCallout({
    x: leftX, y: phyY, w: DL.leftCalloutW, h: phyH,
    title: phyL.title, lines: phyL.lines,
    leader: { from: [phyLineX, DL.leader.phyY],
              to:   [leftRight, DL.leader.phyY] },
    anchor: 'arrow',
  }));

  // Right-side asymmetric-fanout annotation (the 4-5-5-4 pattern note). Standalone
  // callout panel; no leader line — it's a general note about the mesh, not anchored
  // to one chip. Centered vertically on the mesh midpoint (mesh-detail callout rule).
  if (t.callouts.rightAsymmetry) {
    const aL = t.callouts.rightAsymmetry;
    const aH = DL.calloutH(aL.lines.length);
    const aX = rightCalloutXFor(t);
    const aY = DL.leader.phyY - aH / 2;
    calloutRects.push({ x: aX, y: aY, w: DL.rightCalloutW, h: aH, title: 'rightAsymmetry' });
    host.appendChild(createCallout({
      x: aX, y: aY, w: DL.rightCalloutW, h: aH,
      title: aL.title, lines: aL.lines,
      leader: null,
    }));
  }

  // Switch-tray callout — oval sits ABOVE NVS4-1 in the mesh area (cy=524, clear of chip).
  // Same convention as standard layouts: oval 20px above NVSwitch row top (y=544 → cy=524).
  const swL = t.callouts.switchTray;
  const swH = DL.calloutH(swL.lines.length);
  const swOvalCy = DL.leader.switchOvalCy;       // 524 — 20px above NVS4-1, oval body y=516..532
  // Leader enters at MIDDLE of panel's right edge (design rule applied to all scale-ups).
  const swY = swOvalCy - swH / 2;
  // Mirror of topOvalCx: oval cx shifted right of NVS4-1 center to cover fan-in lines.
  const swOvalCx = v.swRow.centers[0] + 20;       // = 420 for Hopper
  calloutRects.push({ x: leftX, y: swY, w: DL.leftCalloutW, h: swH, title: 'switchTray' });
  host.appendChild(createCallout({
    x: leftX, y: swY, w: DL.leftCalloutW, h: swH,
    title: swL.title, lines: swL.lines,
    leader: { from: [swOvalCx, swOvalCy],
              to:   [leftRight, swOvalCy] },
    anchor: 'oval',
  }));

  checkCalloutOverlap(calloutRects);
}

// ---------------------------------------------------------------------------
// Layout: two-rack (K — Blackwell NVL36×2)
// ---------------------------------------------------------------------------
function renderTwoRackLayout(t, host) {
  const calloutRects = [];

  // Title (with optional tertiary "Designed - Not Produced" line)
  host.appendChild(createTitle({ title: t.title, platform: t.platform, tertiary: t.tertiary }));

  t.racks.forEach((rack, rackIdx) => {
    // Per-rack NVL36 dashed frame (analogous to A's NVL72 frame).
    if (rack.frame) {
      host.appendChild(createFrame({
        x: rack.frame.x, y: rack.frame.y,
        w: rack.frame.w, h: rack.frame.h,
        idText: rack.frame.idText,
      }));
    }

    // Rack titles intentionally not rendered — the main title block already says
    // "Blackwell NVL36 × 2" and each rack is self-evident from the layout. (Removed
    // per Bill's request, 2026-05-15.)

    // Compute-tray dashed box + label via the standard factory (consistent with A).
    if (rack.computeTrayBox) {
      host.appendChild(createTrayBox(rack.computeTrayBox));
    }

    // GPU row
    rack.gpuRow.centers.forEach((cx, i) => {
      host.appendChild(createGpuPackage(cx - DL.gpuPackage.w / 2, rack.gpuRow.y,
                                         rack.gpuRow.labels[i], t.generation.dieMask));
    });
    if (rack.gpuRow.dotsX) {
      host.appendChild(svgText(rack.gpuRow.dotsX, rack.gpuRow.dotsY ?? rack.gpuRow.y + 25,
                               '. . .', { size: 22, weight: '400', fill: DL.bodyFill }));
    }

    // Per-rack intra-rack mesh: GPU row ↔ NVSwitch row.
    // Rack 1 (idx 0): GPUs on top, NVSwitches on bottom. Rack 2 (idx 1) is the mirror
    // — NVSwitches on top, GPUs on bottom — so we swap the x-arrays so the lines
    // emerge from the actual top-row chips (not phantom positions). Without the swap,
    // rack 2 had lines emerging from x=680 (a GPU x) at the NVSwitch row's y, which
    // visually read as "NVLinks going to a non-existent NVS5-22".
    const topXs = (rackIdx === 0) ? rack.gpuRow.centers : rack.swRow.centers;
    const botXs = (rackIdx === 0) ? rack.swRow.centers : rack.gpuRow.centers;
    host.appendChild(createMesh(topXs, botXs,
                                { yTop: rack.meshTopY, yBot: rack.meshBotY }));

    // NVSwitch-tray dashed box + label via the standard factory.
    if (rack.switchTrayBox) {
      host.appendChild(createTrayBox(rack.switchTrayBox));
    }

    // NVSwitch row
    rack.swRow.centers.forEach((cx, i) => {
      host.appendChild(createNvSwitch(cx - DL.nvSwitch.w / 2, rack.swRow.y, rack.swRow.labels[i]));
    });
    if (rack.swRow.dotsX) {
      host.appendChild(svgText(rack.swRow.dotsX, rack.swRow.dotsY ?? rack.swRow.y + 16,
                               '. . .', { size: 22, weight: '400', fill: DL.bodyFill }));
    }

    // Per-rack right callouts (compute + switch summary), equidistant from rack frame.
    const rightX = (rack.frame ? rack.frame.x + rack.frame.w + DL.edgeClear : DL.defaultRightX);
    const rcL = rack.rightCompute;
    if (rcL) {
      const rcH = DL.calloutH(rcL.lines.length);
      const rcY = rcL.anchorY - rcH / 2;
      const rcRightEdgeX = rack.gpuRow.centers[rack.gpuRow.centers.length - 1] + DL.gpuPackage.w / 2;
      calloutRects.push({ x: rightX, y: rcY, w: DL.rightCalloutW, h: rcH, title: `rightCompute_${rackIdx}` });
      host.appendChild(createCallout({
        x: rightX, y: rcY, w: DL.rightCalloutW, h: rcH,
        title: rcL.title, lines: rcL.lines,
        leader: { from: [rcRightEdgeX, rcL.anchorY], to: [rightX, rcL.anchorY] },
        anchor: 'circle',
      }));
    }
    const rsL = rack.rightSwitch;
    if (rsL) {
      const rsH = DL.calloutH(rsL.lines.length);
      const rsY = rsL.anchorY - rsH / 2;
      const rsRightEdgeX = rack.swRow.centers[rack.swRow.centers.length - 1] + DL.nvSwitch.w / 2;
      calloutRects.push({ x: rightX, y: rsY, w: DL.rightCalloutW, h: rsH, title: `rightSwitch_${rackIdx}` });
      host.appendChild(createCallout({
        x: rightX, y: rsY, w: DL.rightCalloutW, h: rsH,
        title: rsL.title, lines: rsL.lines,
        leader: { from: [rsRightEdgeX, rsL.anchorY], to: [rightX, rsL.anchorY] },
        anchor: 'circle',
      }));
    }
  });

  // Inter-rack mesh — a representative 5×5 all-to-all between the visible NVSwitches
  // of rack 1 and rack 2 (full mesh is 18×18 = 324 pairs; we render 25 lines to convey).
  const r1Sw = t.racks[0].swRow;
  const r2Sw = t.racks[1].swRow;
  const interMesh = svgEl('g', {
    stroke: DL.accent, 'stroke-width': '0.9', opacity: '0.7', fill: 'none',
  });
  // Top of inter-mesh = bottom of rack-1 NVSwitches; bottom = top of rack-2 NVSwitches.
  const interTopY = r1Sw.y + DL.nvSwitch.h;
  const interBotY = r2Sw.y;
  for (const cx1 of r1Sw.centers) {
    for (const cx2 of r2Sw.centers) {
      interMesh.appendChild(svgEl('line', { x1: cx1, y1: interTopY, x2: cx2, y2: interBotY }));
    }
  }
  host.appendChild(interMesh);

  // Inter-rack annotation callout (LEFT side, no leader)
  const irc = t.interRackCallout;
  if (irc) {
    host.appendChild(createCallout({
      x: irc.x, y: irc.y, w: irc.w, h: irc.h,
      title: irc.title, lines: irc.lines,
      leader: null,
    }));
    calloutRects.push({ x: irc.x, y: irc.y, w: irc.w, h: irc.h, title: 'interRack' });
  }

  checkCalloutOverlap(calloutRects);
}

// =============================================================================
// setOption(opt) — single entry point for all buttons
// =============================================================================

function setOption(opt) {
  // Factory path — preferred for migrated diagrams.
  if (FACTORY_OPTS.has(opt)) {
    setStaticDisplay(false);
    // Also hide any compute-view groups that the legacy path might have shown last.
    COMPUTE_VIEW_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    renderFromFactory(opt);
    return;
  }

  // Legacy path — restore static elements and continue with the original flow.
  setStaticDisplay(true);
  const factoryCanvas = document.getElementById('factory-canvas');
  if (factoryCanvas) {
    while (factoryCanvas.firstChild) factoryCanvas.removeChild(factoryCanvas.firstChild);
    factoryCanvas.style.display = 'none';
  }
  setOptionLegacy(opt);
}

function setOptionLegacy(opt) {
  const c = config[opt];

  // Header
  document.getElementById('main-title').textContent = c.title;
  document.getElementById('platform').textContent   = c.platform;
  document.getElementById('top-sub').textContent    = c.topSub;
  document.getElementById('top-sub2').textContent   = c.topSub2 || '';
  document.title = c.title;

  // Button selection state
  document.querySelectorAll('button[data-opt]').forEach(b => {
    b.classList.toggle('selected', b.dataset.opt === opt);
  });

  // Compute-tray block diagrams (F/G/H/I/J/L) — show one, hide all scale-up views.
  // Opt F (GB300) and opt L (GB200) both use compute-blackwell static SVG; the only
  // difference is the NIC label (ConnectX-7 vs CX-8) and the bandwidth line (400GbE/IB
  // vs 800Gb IB/400GbE). setOptionLegacy swaps those via the cx-label / cx-bw-label
  // classes when either opt is selected.
  if (['F', 'G', 'H', 'I', 'J', 'L'].includes(opt)) {
    SCALE_UP_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const isBlackwellCompute = (opt === 'F' || opt === 'L');
    document.getElementById('compute-blackwell').style.display = isBlackwellCompute ? '' : 'none';
    document.getElementById('compute-rubin').style.display     = (opt === 'G') ? '' : 'none';
    document.getElementById('compute-rubin2').style.display    = (opt === 'H' || opt === 'J') ? '' : 'none';
    document.getElementById('compute-hopper').style.display    = (opt === 'I') ? '' : 'none';
    document.body.className = 'opt-' + opt;
    // GB200 vs GB300 NIC + bandwidth swap on compute-blackwell.
    if (isBlackwellCompute) {
      const isGb200 = (opt === 'L');
      document.querySelectorAll('.cx-label').forEach(el => {
        el.textContent = isGb200 ? 'ConnectX-7' : 'ConnectX-8';
      });
      document.querySelectorAll('.cx-bw-label').forEach(el => {
        el.textContent = isGb200 ? '400GbE / IB' : '800Gb IB / 400GbE';
      });
    }
    // Rubin Ultra HBM swap (768GB / 44TB/s) inside compute-rubin2
    if (opt === 'H' || opt === 'J') {
      document.querySelectorAll('.hbm-line2').forEach(el => el.textContent = (opt === 'J') ? '768GB' : '288GB');
      document.querySelectorAll('.hbm-line3').forEach(el => el.textContent = (opt === 'J') ? '44TB/s est' : '22TB/s');
    }
    return;
  }

  // ----- Scale-up views (A, B, C, D, E, K) -----
  COMPUTE_VIEW_IDS.forEach(id => { document.getElementById(id).style.display = 'none'; });

  document.getElementById('top-callout').style.display    = '';
  document.getElementById('phy-callout').style.display    = '';
  document.getElementById('switch-callout').style.display = '';

  // Shared left-side callouts: gen header, single-link spec, switch panel
  document.getElementById('top-gen').textContent    = c.gen;
  document.getElementById('top-lane').textContent   = c.topLane;
  document.getElementById('top-serdes').textContent = c.topSerdes;
  document.getElementById('top-thru').textContent   = c.topThru;
  document.getElementById('box-line2').textContent  = c.line2;
  document.getElementById('box-line3').textContent  = c.line3;
  document.getElementById('sw-title').textContent   = c.swTitle;
  document.getElementById('sw-lane').textContent    = c.swLane;
  document.getElementById('sw-serdes').textContent  = c.swSerdes;
  document.getElementById('sw-thru').textContent    = c.swThru;

  // Default 6-GPU trailing labels (G71/G72 or per-opt override)
  document.getElementById('gpu-71').textContent     = c.gpuLast[0];
  document.getElementById('gpu-72').textContent     = c.gpuLast[1];

  // Top-row layout: default 6-GPU bracket for A/B/C/D, 8-GPU sled for Hopper (E)
  document.getElementById('default-top').style.display = opt === 'E' ? 'none' : '';
  document.getElementById('hopper-top').style.display  = opt === 'E' ? '' : 'none';
  // Top curly bracket is hidden on Rubin NVL72 (opt A); the NVL72 dashed outline already
  // bounds the view, and bill removed the curly braces from this option's styling pass.
  const topCurly = document.getElementById('default-top-curly');
  if (topCurly) topCurly.style.display = opt === 'A' ? 'none' : '';

  // Single-NVLink PHY spec: title + separator + 2 body lines; Hopper appends an addendum
  // and shifts the whole callout back to its original y to keep extras visible.
  document.getElementById('hopper-phy-extra').style.display = opt === 'E' ? '' : 'none';
  document.getElementById('phy-rect').setAttribute('height', opt === 'E' ? 130 : 78);
  const phyBody = document.getElementById('phy-callout-body');
  if (phyBody) phyBody.setAttribute('transform', opt === 'E' ? 'translate(0,-51)' : '');
  const phyLine = document.getElementById('phy-leader-line');
  if (phyLine) {
    const phyLeaderY = opt === 'E' ? 329 : 379;
    phyLine.setAttribute('y1', phyLeaderY);
    phyLine.setAttribute('y2', phyLeaderY);
  }

  // Option-group visibility (D reuses B's SVG since switch hardware is identical)
  document.getElementById('option-A').style.display = opt === 'A' ? '' : 'none';
  document.getElementById('option-B').style.display = (opt === 'B' || opt === 'D') ? '' : 'none';
  document.getElementById('option-C').style.display = opt === 'C' ? '' : 'none';
  document.getElementById('option-E').style.display = opt === 'E' ? '' : 'none';
  document.getElementById('option-K').style.display = opt === 'K' ? '' : 'none';

  // Option K (two-rack) has its own self-contained layout — hide the shared header + left callouts
  if (opt === 'K') {
    document.getElementById('default-top').style.display    = 'none';
    document.getElementById('hopper-top').style.display     = 'none';
    document.getElementById('top-callout').style.display    = 'none';
    document.getElementById('phy-callout').style.display    = 'none';
    document.getElementById('switch-callout').style.display = 'none';
  }

  // B/D differ in the trailing two switch labels and the bottom subtitle (the right callouts
  // for B vs D are now generated by makeCallout from CALLOUTS.B / CALLOUTS.D)
  if (opt === 'B' || opt === 'D') {
    document.getElementById('nvs-last1-B').textContent = c.swLast[0];
    document.getElementById('nvs-last2-B').textContent = c.swLast[1];
    document.getElementById('bottom-sub-B').textContent = c.bottomSub;
  }

  // Reposition leader endpoints (Hopper has different first-GPU/first-switch x-coords)
  // Hopper also shifts the entire left-callout column 60px left so it doesn't crowd the
  // Hopper diagram (whose leftmost GPU sits at x=310 vs x=370 for the Oberon/Kyber views).
  // Group transform handles the visual shift; leader endpoints are written in pre-transform
  // space so they still land on the correct GPU/NVSwitch in display space.
  const isHopper     = opt === 'E';
  const calloutShift = isHopper ? -60 : 0;
  const topLeadX     = isHopper ? 350 : 410;
  const swLeadX      = isHopper ? 400 : 410;
  const phyArrowX    = isHopper ? 350 : 410;
  // Top-callout leader y: A/B/C/D drop the oval just BELOW the dashed compute-tray box
  // (box bottom y=224 → oval at y=230). Hopper sled is one big dashed box that already
  // encloses GPUs+switches, so the oval stays at G1's bottom edge (y=214).
  const topLeadY = isHopper ? 214 : 230;
  // Switch-callout leader y: A/B/C/D lift the oval ABOVE the dashed NVSwitch-tray box
  // (box top y=534 → oval at y=520). Hopper has no separate NVSwitch tray so the oval
  // stays at NVS-1's top edge (y=544).
  const swLeadY  = isHopper ? 544 : 520;
  document.getElementById('top-leader-line').setAttribute('x2', (topLeadX - 18) - calloutShift);
  document.getElementById('top-leader-line').setAttribute('y1', topLeadY);
  document.getElementById('top-leader-line').setAttribute('y2', topLeadY);
  document.getElementById('top-leader-oval').setAttribute('cx', topLeadX - calloutShift);
  document.getElementById('top-leader-oval').setAttribute('cy', topLeadY);
  document.getElementById('switch-leader-line').setAttribute('x2', (swLeadX - 18) - calloutShift);
  document.getElementById('switch-leader-line').setAttribute('y1', swLeadY);
  document.getElementById('switch-leader-line').setAttribute('y2', swLeadY);
  document.getElementById('switch-leader-oval').setAttribute('cx', swLeadX - calloutShift);
  document.getElementById('switch-leader-oval').setAttribute('cy', swLeadY);
  document.getElementById('phy-leader-line').setAttribute('x2', phyArrowX - calloutShift);
  const calloutTransform = calloutShift ? `translate(${calloutShift},0)` : '';
  document.getElementById('top-callout').setAttribute('transform', calloutTransform);
  document.getElementById('phy-callout').setAttribute('transform', calloutTransform);
  document.getElementById('switch-callout').setAttribute('transform', calloutTransform);
  // Top/switch callout bodies sit at "Rubin" positions statically (rect shifted to align
  // leader with the dashed-box edge). Hopper restores the original positions: top-body up
  // 10px (rect y=130→120), switch-body down 24px (rect y=516→540).
  const topBody = document.getElementById('top-callout-body');
  const swBody  = document.getElementById('switch-callout-body');
  if (topBody) topBody.setAttribute('transform', isHopper ? 'translate(0,-10)' : '');
  if (swBody)  swBody.setAttribute('transform',  isHopper ? 'translate(0,24)'  : '');

  // Body class controls die-fill via CSS. D reuses B's SVG; E has its own markup.
  const dieClass = (opt === 'D') ? 'B' : opt;
  document.body.className = 'opt-' + dieClass;

  // Render the right-side compute/switch summary callouts from data
  renderRightCallouts(opt);
}

// Initial paint — first option is Rubin NVL72 (A), matching the default layout in the SVG
document.addEventListener('DOMContentLoaded', () => setOption('A'));
