"use client";
import {
  require_jsx_runtime
} from "./chunk-NZAIND7N.js";
import {
  require_react
} from "./chunk-UVNPGZG7.js";
import {
  __toESM
} from "./chunk-OL46QLBJ.js";

// node_modules/react-window/dist/react-window.js
var import_jsx_runtime = __toESM(require_jsx_runtime());
var import_react = __toESM(require_react());
function xe(e) {
  let t = e;
  for (; t; ) {
    if (t.dir)
      return t.dir === "rtl";
    t = t.parentElement;
  }
  return false;
}
function ve(e, t) {
  const [s, r] = (0, import_react.useState)(t === "rtl");
  return (0, import_react.useLayoutEffect)(() => {
    e && (t || r(xe(e)));
  }, [t, e]), s;
}
var q = typeof window < "u" ? import_react.useLayoutEffect : import_react.useEffect;
function ie(e) {
  if (e !== void 0)
    switch (typeof e) {
      case "number":
        return e;
      case "string": {
        if (e.endsWith("px"))
          return parseFloat(e);
        break;
      }
    }
}
function be({
  box: e,
  defaultHeight: t,
  defaultWidth: s,
  disabled: r,
  element: n,
  mode: o,
  style: i
}) {
  const { styleHeight: f, styleWidth: l } = (0, import_react.useMemo)(
    () => ({
      styleHeight: ie(i == null ? void 0 : i.height),
      styleWidth: ie(i == null ? void 0 : i.width)
    }),
    [i == null ? void 0 : i.height, i == null ? void 0 : i.width]
  ), [c, d] = (0, import_react.useState)({
    height: t,
    width: s
  }), a = r || o === "only-height" && f !== void 0 || o === "only-width" && l !== void 0 || f !== void 0 && l !== void 0;
  return q(() => {
    if (n === null || a)
      return;
    const h = new ResizeObserver((p) => {
      for (const I of p) {
        const { contentRect: u, target: w } = I;
        n === w && d((m) => m.height === u.height && m.width === u.width ? m : {
          height: u.height,
          width: u.width
        });
      }
    });
    return h.observe(n, { box: e }), () => {
      h == null ? void 0 : h.unobserve(n);
    };
  }, [e, a, n, f, l]), (0, import_react.useMemo)(
    () => ({
      height: f ?? c.height,
      width: l ?? c.width
    }),
    [c, f, l]
  );
}
function ae(e) {
  const t = (0, import_react.useRef)(() => {
    throw new Error("Cannot call during render.");
  });
  return q(() => {
    t.current = e;
  }, [e]), (0, import_react.useCallback)((s) => {
    var _a;
    return (_a = t.current) == null ? void 0 : _a.call(t, s);
  }, [t]);
}
var U = null;
function Ie(e = false) {
  if (U === null || e) {
    const t = document.createElement("div"), s = t.style;
    s.width = "50px", s.height = "50px", s.overflow = "scroll", s.direction = "rtl";
    const r = document.createElement("div"), n = r.style;
    return n.width = "100px", n.height = "100px", t.appendChild(r), document.body.appendChild(t), t.scrollLeft > 0 ? U = "positive-descending" : (t.scrollLeft = 1, t.scrollLeft === 0 ? U = "negative" : U = "positive-ascending"), document.body.removeChild(t), U;
  }
  return U;
}
function Z({
  containerElement: e,
  direction: t,
  isRtl: s,
  scrollOffset: r
}) {
  if (t === "horizontal" && s)
    switch (Ie()) {
      case "negative":
        return -r;
      case "positive-descending": {
        if (e) {
          const { clientWidth: n, scrollLeft: o, scrollWidth: i } = e;
          return i - n - o;
        }
        break;
      }
    }
  return r;
}
function L(e, t = "Assertion error") {
  if (!e)
    throw console.error(t), Error(t);
}
function Y(e, t) {
  if (e === t)
    return true;
  if (!!e != !!t || (L(e !== void 0), L(t !== void 0), Object.keys(e).length !== Object.keys(t).length))
    return false;
  for (const s in e)
    if (!Object.is(t[s], e[s]))
      return false;
  return true;
}
function fe({
  cachedBounds: e,
  itemCount: t,
  itemSize: s
}) {
  if (t === 0)
    return 0;
  if (typeof s == "number")
    return t * s;
  {
    const r = e.get(
      e.size === 0 ? 0 : e.size - 1
    );
    L(r !== void 0, "Unexpected bounds cache miss");
    const n = (r.scrollOffset + r.size) / e.size;
    return t * n;
  }
}
function we({
  align: e,
  cachedBounds: t,
  index: s,
  itemCount: r,
  itemSize: n,
  containerScrollOffset: o,
  containerSize: i
}) {
  if (s < 0 || s >= r)
    throw RangeError(`Invalid index specified: ${s}`, {
      cause: `Index ${s} is not within the range of 0 - ${r - 1}`
    });
  const f = fe({
    cachedBounds: t,
    itemCount: r,
    itemSize: n
  }), l = t.get(s), c = Math.max(
    0,
    Math.min(f - i, l.scrollOffset)
  ), d = Math.max(
    0,
    l.scrollOffset - i + l.size
  );
  switch (e === "smart" && (o >= d && o <= c ? e = "auto" : e = "center"), e) {
    case "start":
      return c;
    case "end":
      return d;
    case "center":
      return l.scrollOffset <= i / 2 ? 0 : l.scrollOffset + l.size / 2 >= f - i / 2 ? f - i : l.scrollOffset + l.size / 2 - i / 2;
    case "auto":
    default:
      return o >= d && o <= c ? o : o < d ? d : c;
  }
}
function P({
  cachedBounds: e,
  containerScrollOffset: t,
  containerSize: s,
  itemCount: r,
  overscanCount: n
}) {
  const o = r - 1;
  let i = 0, f = -1, l = 0, c = -1, d = 0;
  for (; d < o; ) {
    const a = e.get(d);
    if (a.scrollOffset + a.size > t)
      break;
    d++;
  }
  for (i = d, l = Math.max(0, i - n); d < o; ) {
    const a = e.get(d);
    if (a.scrollOffset + a.size >= t + s)
      break;
    d++;
  }
  return f = Math.min(o, d), c = Math.min(r - 1, f + n), i < 0 && (i = 0, f = -1, l = 0, c = -1), {
    startIndexVisible: i,
    stopIndexVisible: f,
    startIndexOverscan: l,
    stopIndexOverscan: c
  };
}
function me({
  itemCount: e,
  itemProps: t,
  itemSize: s
}) {
  const r = /* @__PURE__ */ new Map();
  return {
    get(n) {
      for (L(n < e, `Invalid index ${n}`); r.size - 1 < n; ) {
        const i = r.size;
        let f;
        switch (typeof s) {
          case "function": {
            f = s(i, t);
            break;
          }
          case "number": {
            f = s;
            break;
          }
        }
        if (i === 0)
          r.set(i, {
            size: f,
            scrollOffset: 0
          });
        else {
          const l = r.get(i - 1);
          L(
            l !== void 0,
            `Unexpected bounds cache miss for index ${n}`
          ), r.set(i, {
            scrollOffset: l.scrollOffset + l.size,
            size: f
          });
        }
      }
      const o = r.get(n);
      return L(
        o !== void 0,
        `Unexpected bounds cache miss for index ${n}`
      ), o;
    },
    set(n, o) {
      r.set(n, o);
    },
    get size() {
      return r.size;
    }
  };
}
function Oe({
  itemCount: e,
  itemProps: t,
  itemSize: s
}) {
  return (0, import_react.useMemo)(
    () => me({
      itemCount: e,
      itemProps: t,
      itemSize: s
    }),
    [e, t, s]
  );
}
function ye({
  containerSize: e,
  itemSize: t
}) {
  let s;
  switch (typeof t) {
    case "string": {
      L(
        t.endsWith("%"),
        `Invalid item size: "${t}"; string values must be percentages (e.g. "100%")`
      ), L(
        e !== void 0,
        "Container size must be defined if a percentage item size is specified"
      ), s = e * parseInt(t) / 100;
      break;
    }
    default: {
      s = t;
      break;
    }
  }
  return s;
}
function te({
  containerElement: e,
  containerStyle: t,
  defaultContainerSize: s = 0,
  direction: r,
  isRtl: n = false,
  itemCount: o,
  itemProps: i,
  itemSize: f,
  onResize: l,
  overscanCount: c
}) {
  const { height: d = s, width: a = s } = be({
    defaultHeight: r === "vertical" ? s : void 0,
    defaultWidth: r === "horizontal" ? s : void 0,
    element: e,
    mode: r === "vertical" ? "only-height" : "only-width",
    style: t
  }), h = (0, import_react.useRef)({
    height: 0,
    width: 0
  }), p = r === "vertical" ? d : a, I = ye({ containerSize: p, itemSize: f });
  (0, import_react.useLayoutEffect)(() => {
    if (typeof l == "function") {
      const g = h.current;
      (g.height !== d || g.width !== a) && (l({ height: d, width: a }, { ...g }), g.height = d, g.width = a);
    }
  }, [d, l, a]);
  const u = Oe({
    itemCount: o,
    itemProps: i,
    itemSize: I
  }), w = (0, import_react.useCallback)(
    (g) => u.get(g),
    [u]
  ), [m, O] = (0, import_react.useState)(
    () => P({
      cachedBounds: u,
      // TODO Potentially support a defaultScrollOffset prop?
      containerScrollOffset: 0,
      containerSize: p,
      itemCount: o,
      overscanCount: c
    })
  ), {
    startIndexVisible: G,
    startIndexOverscan: x,
    stopIndexVisible: F,
    stopIndexOverscan: V
  } = {
    startIndexVisible: Math.min(o - 1, m.startIndexVisible),
    startIndexOverscan: Math.min(o - 1, m.startIndexOverscan),
    stopIndexVisible: Math.min(o - 1, m.stopIndexVisible),
    stopIndexOverscan: Math.min(o - 1, m.stopIndexOverscan)
  }, z = (0, import_react.useCallback)(
    () => fe({
      cachedBounds: u,
      itemCount: o,
      itemSize: I
    }),
    [u, o, I]
  ), $ = (0, import_react.useCallback)(
    (g) => {
      const S = Z({
        containerElement: e,
        direction: r,
        isRtl: n,
        scrollOffset: g
      });
      return P({
        cachedBounds: u,
        containerScrollOffset: S,
        containerSize: p,
        itemCount: o,
        overscanCount: c
      });
    },
    [
      u,
      e,
      p,
      r,
      n,
      o,
      c
    ]
  );
  q(() => {
    const g = (r === "vertical" ? e == null ? void 0 : e.scrollTop : e == null ? void 0 : e.scrollLeft) ?? 0;
    O($(g));
  }, [e, r, $]), q(() => {
    if (!e)
      return;
    const g = () => {
      O((S) => {
        const { scrollLeft: E, scrollTop: b } = e, v = Z({
          containerElement: e,
          direction: r,
          isRtl: n,
          scrollOffset: r === "vertical" ? b : E
        }), R = P({
          cachedBounds: u,
          containerScrollOffset: v,
          containerSize: p,
          itemCount: o,
          overscanCount: c
        });
        return Y(R, S) ? S : R;
      });
    };
    return e.addEventListener("scroll", g), () => {
      e.removeEventListener("scroll", g);
    };
  }, [
    u,
    e,
    p,
    r,
    o,
    c
  ]);
  const y = ae(
    ({
      align: g = "auto",
      containerScrollOffset: S,
      index: E
    }) => {
      let b = we({
        align: g,
        cachedBounds: u,
        containerScrollOffset: S,
        containerSize: p,
        index: E,
        itemCount: o,
        itemSize: I
      });
      if (e) {
        if (b = Z({
          containerElement: e,
          direction: r,
          isRtl: n,
          scrollOffset: b
        }), typeof e.scrollTo != "function") {
          const v = $(b);
          Y(m, v) || O(v);
        }
        return b;
      }
    }
  );
  return {
    getCellBounds: w,
    getEstimatedSize: z,
    scrollToIndex: y,
    startIndexOverscan: x,
    startIndexVisible: G,
    stopIndexOverscan: V,
    stopIndexVisible: F
  };
}
function de(e) {
  return (0, import_react.useMemo)(() => e, Object.values(e));
}
function ue(e, t) {
  const {
    ariaAttributes: s,
    style: r,
    ...n
  } = e, {
    ariaAttributes: o,
    style: i,
    ...f
  } = t;
  return Y(s, o) && Y(r, i) && Y(n, f);
}
function Ee({
  cellComponent: e,
  cellProps: t,
  children: s,
  className: r,
  columnCount: n,
  columnWidth: o,
  defaultHeight: i = 0,
  defaultWidth: f = 0,
  dir: l,
  gridRef: c,
  onCellsRendered: d,
  onResize: a,
  overscanCount: h = 3,
  rowCount: p,
  rowHeight: I,
  style: u,
  tagName: w = "div",
  ...m
}) {
  const O = de(t), G = (0, import_react.useMemo)(
    () => (0, import_react.memo)(e, ue),
    [e]
  ), [x, F] = (0, import_react.useState)(null), V = ve(x, l), {
    getCellBounds: z,
    getEstimatedSize: $,
    startIndexOverscan: y,
    startIndexVisible: g,
    scrollToIndex: S,
    stopIndexOverscan: E,
    stopIndexVisible: b
  } = te({
    containerElement: x,
    containerStyle: u,
    defaultContainerSize: f,
    direction: "horizontal",
    isRtl: V,
    itemCount: n,
    itemProps: O,
    itemSize: o,
    onResize: a,
    overscanCount: h
  }), {
    getCellBounds: v,
    getEstimatedSize: R,
    startIndexOverscan: k,
    startIndexVisible: ne,
    scrollToIndex: Q,
    stopIndexOverscan: _,
    stopIndexVisible: oe
  } = te({
    containerElement: x,
    containerStyle: u,
    defaultContainerSize: i,
    direction: "vertical",
    itemCount: p,
    itemProps: O,
    itemSize: I,
    onResize: a,
    overscanCount: h
  });
  (0, import_react.useImperativeHandle)(
    c,
    () => ({
      get element() {
        return x;
      },
      scrollToCell({
        behavior: H = "auto",
        columnAlign: T = "auto",
        columnIndex: W,
        rowAlign: B = "auto",
        rowIndex: j
      }) {
        const N = S({
          align: T,
          containerScrollOffset: (x == null ? void 0 : x.scrollLeft) ?? 0,
          index: W
        }), ge = Q({
          align: B,
          containerScrollOffset: (x == null ? void 0 : x.scrollTop) ?? 0,
          index: j
        });
        typeof (x == null ? void 0 : x.scrollTo) == "function" && x.scrollTo({
          behavior: H,
          left: N,
          top: ge
        });
      },
      scrollToColumn({
        align: H = "auto",
        behavior: T = "auto",
        index: W
      }) {
        const B = S({
          align: H,
          containerScrollOffset: (x == null ? void 0 : x.scrollLeft) ?? 0,
          index: W
        });
        typeof (x == null ? void 0 : x.scrollTo) == "function" && x.scrollTo({
          behavior: T,
          left: B
        });
      },
      scrollToRow({
        align: H = "auto",
        behavior: T = "auto",
        index: W
      }) {
        const B = Q({
          align: H,
          containerScrollOffset: (x == null ? void 0 : x.scrollTop) ?? 0,
          index: W
        });
        typeof (x == null ? void 0 : x.scrollTo) == "function" && x.scrollTo({
          behavior: T,
          top: B
        });
      }
    }),
    [x, S, Q]
  ), (0, import_react.useEffect)(() => {
    y >= 0 && E >= 0 && k >= 0 && _ >= 0 && d && d(
      {
        columnStartIndex: g,
        columnStopIndex: b,
        rowStartIndex: ne,
        rowStopIndex: oe
      },
      {
        columnStartIndex: y,
        columnStopIndex: E,
        rowStartIndex: k,
        rowStopIndex: _
      }
    );
  }, [
    d,
    y,
    g,
    E,
    b,
    k,
    ne,
    _,
    oe
  ]);
  const he = (0, import_react.useMemo)(() => {
    const H = [];
    if (n > 0 && p > 0)
      for (let T = k; T <= _; T++) {
        const W = v(T), B = [];
        for (let j = y; j <= E; j++) {
          const N = z(j);
          B.push(
            (0, import_react.createElement)(
              G,
              {
                ...O,
                ariaAttributes: {
                  "aria-colindex": j + 1,
                  role: "gridcell"
                },
                columnIndex: j,
                key: j,
                rowIndex: T,
                style: {
                  position: "absolute",
                  left: V ? void 0 : 0,
                  right: V ? 0 : void 0,
                  transform: `translate(${V ? -N.scrollOffset : N.scrollOffset}px, ${W.scrollOffset}px)`,
                  height: W.size,
                  width: N.size
                }
              }
            )
          );
        }
        H.push(
          (0, import_jsx_runtime.jsx)("div", { role: "row", "aria-rowindex": T + 1, children: B }, T)
        );
      }
    return H;
  }, [
    G,
    O,
    n,
    y,
    E,
    z,
    v,
    V,
    p,
    k,
    _
  ]), pe = (0, import_jsx_runtime.jsx)(
    "div",
    {
      "aria-hidden": true,
      style: {
        height: R(),
        width: $(),
        zIndex: -1
      }
    }
  );
  return (0, import_react.createElement)(
    w,
    {
      "aria-colcount": n,
      "aria-rowcount": p,
      role: "grid",
      ...m,
      className: r,
      dir: l,
      ref: F,
      style: {
        position: "relative",
        maxHeight: "100%",
        maxWidth: "100%",
        flexGrow: 1,
        overflow: "auto",
        ...u
      }
    },
    he,
    s,
    pe
  );
}
var Re = import_react.useState;
var Ve = import_react.useRef;
function ze(e) {
  return e != null && typeof e == "object" && "getAverageRowHeight" in e && typeof e.getAverageRowHeight == "function";
}
var se = "data-react-window-index";
function Ae({
  children: e,
  className: t,
  defaultHeight: s = 0,
  listRef: r,
  onResize: n,
  onRowsRendered: o,
  overscanCount: i = 3,
  rowComponent: f,
  rowCount: l,
  rowHeight: c,
  rowProps: d,
  tagName: a = "div",
  style: h,
  ...p
}) {
  const I = de(d), u = (0, import_react.useMemo)(
    () => (0, import_react.memo)(f, ue),
    [f]
  ), [w, m] = (0, import_react.useState)(null), O = ze(c), G = (0, import_react.useMemo)(() => O ? (b) => c.getRowHeight(b) ?? c.getAverageRowHeight() : c, [O, c]), {
    getCellBounds: x,
    getEstimatedSize: F,
    scrollToIndex: V,
    startIndexOverscan: z,
    startIndexVisible: $,
    stopIndexOverscan: y,
    stopIndexVisible: g
  } = te({
    containerElement: w,
    containerStyle: h,
    defaultContainerSize: s,
    direction: "vertical",
    itemCount: l,
    itemProps: I,
    itemSize: G,
    onResize: n,
    overscanCount: i
  });
  (0, import_react.useImperativeHandle)(
    r,
    () => ({
      get element() {
        return w;
      },
      scrollToRow({
        align: b = "auto",
        behavior: v = "auto",
        index: R
      }) {
        const k = V({
          align: b,
          containerScrollOffset: (w == null ? void 0 : w.scrollTop) ?? 0,
          index: R
        });
        typeof (w == null ? void 0 : w.scrollTo) == "function" && w.scrollTo({
          behavior: v,
          top: k
        });
      }
    }),
    [w, V]
  ), q(() => {
    if (!w)
      return;
    const b = Array.from(w.children).filter((v, R) => {
      if (v.hasAttribute("aria-hidden"))
        return false;
      const k = `${z + R}`;
      return v.setAttribute(se, k), true;
    });
    if (O)
      return c.observeRowElements(b);
  }, [
    w,
    O,
    c,
    z,
    y
  ]), (0, import_react.useEffect)(() => {
    z >= 0 && y >= 0 && o && o(
      {
        startIndex: $,
        stopIndex: g
      },
      {
        startIndex: z,
        stopIndex: y
      }
    );
  }, [
    o,
    z,
    $,
    y,
    g
  ]);
  const S = (0, import_react.useMemo)(() => {
    const b = [];
    if (l > 0)
      for (let v = z; v <= y; v++) {
        const R = x(v);
        b.push(
          (0, import_react.createElement)(
            u,
            {
              ...I,
              ariaAttributes: {
                "aria-posinset": v + 1,
                "aria-setsize": l,
                role: "listitem"
              },
              key: v,
              index: v,
              style: {
                position: "absolute",
                left: 0,
                transform: `translateY(${R.scrollOffset}px)`,
                // In case of dynamic row heights, don't specify a height style
                // otherwise a default/estimated height would mask the actual height
                height: O ? void 0 : R.size,
                width: "100%"
              }
            }
          )
        );
      }
    return b;
  }, [
    u,
    x,
    O,
    l,
    I,
    z,
    y
  ]), E = (0, import_jsx_runtime.jsx)(
    "div",
    {
      "aria-hidden": true,
      style: {
        height: F(),
        width: "100%",
        zIndex: -1
      }
    }
  );
  return (0, import_react.createElement)(
    a,
    {
      role: "list",
      ...p,
      className: t,
      ref: m,
      style: {
        position: "relative",
        maxHeight: "100%",
        flexGrow: 1,
        overflowY: "auto",
        ...h
      }
    },
    S,
    e,
    E
  );
}
function ke({
  defaultRowHeight: e,
  key: t
}) {
  const [s, r] = (0, import_react.useState)({
    key: t,
    map: /* @__PURE__ */ new Map()
  });
  s.key !== t && r({
    key: t,
    map: /* @__PURE__ */ new Map()
  });
  const { map: n } = s, o = (0, import_react.useCallback)(() => {
    let a = 0;
    return n.forEach((h) => {
      a += h;
    }), a === 0 ? e : a / n.size;
  }, [e, n]), i = (0, import_react.useCallback)(
    (a) => {
      const h = n.get(a);
      return h !== void 0 ? h : (n.set(a, e), e);
    },
    [e, n]
  ), f = (0, import_react.useCallback)((a, h) => {
    r((p) => {
      if (p.map.get(a) === h)
        return p;
      const I = new Map(p.map);
      return I.set(a, h), {
        ...p,
        map: I
      };
    });
  }, []), l = ae(
    (a) => {
      a.length !== 0 && a.forEach((h) => {
        const { borderBoxSize: p, target: I } = h, u = I.getAttribute(se);
        L(
          u !== null,
          `Invalid ${se} attribute value`
        );
        const w = parseInt(u), { blockSize: m } = p[0];
        m && f(w, m);
      });
    }
  ), [c] = (0, import_react.useState)(() => {
    if (typeof ResizeObserver < "u")
      return new ResizeObserver(l);
  });
  (0, import_react.useEffect)(() => {
    if (c)
      return () => {
        c.disconnect();
      };
  }, [c]);
  const d = (0, import_react.useCallback)(
    (a) => c ? (a.forEach((h) => c.observe(h)), () => {
      a.forEach((h) => c.unobserve(h));
    }) : () => {
    },
    [c]
  );
  return (0, import_react.useMemo)(
    () => ({
      getAverageRowHeight: o,
      getRowHeight: i,
      setRowHeight: f,
      observeRowElements: d
    }),
    [o, i, f, d]
  );
}
var Le = import_react.useState;
var Me = import_react.useRef;
var C = -1;
function $e(e = false) {
  if (C === -1 || e) {
    const t = document.createElement("div"), s = t.style;
    s.width = "50px", s.height = "50px", s.overflow = "scroll", document.body.appendChild(t), C = t.offsetWidth - t.clientWidth, document.body.removeChild(t);
  }
  return C;
}
export {
  Ee as Grid,
  Ae as List,
  $e as getScrollbarSize,
  ke as useDynamicRowHeight,
  Re as useGridCallbackRef,
  Ve as useGridRef,
  Le as useListCallbackRef,
  Me as useListRef
};
//# sourceMappingURL=react-window.js.map
