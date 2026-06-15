import {
  ButtonBase_default
} from "./chunk-E3YXWCSQ.js";
import {
  useSlot
} from "./chunk-KLNJAZIL.js";
import {
  memoTheme_default
} from "./chunk-OBAIKB4Z.js";
import {
  useDefaultProps
} from "./chunk-JLYTP63F.js";
import {
  composeClasses,
  generateUtilityClass,
  generateUtilityClasses,
  styled_default2 as styled_default
} from "./chunk-GCWAOTMB.js";
import {
  require_prop_types
} from "./chunk-W67RA64Z.js";
import {
  clsx_default
} from "./chunk-LNJWJNFR.js";
import {
  require_jsx_runtime
} from "./chunk-NZAIND7N.js";
import {
  require_react
} from "./chunk-UVNPGZG7.js";
import {
  __toESM
} from "./chunk-OL46QLBJ.js";

// node_modules/@mui/material/esm/CardActionArea/CardActionArea.js
var React = __toESM(require_react(), 1);
var import_prop_types = __toESM(require_prop_types(), 1);

// node_modules/@mui/material/esm/CardActionArea/cardActionAreaClasses.js
function getCardActionAreaUtilityClass(slot) {
  return generateUtilityClass("MuiCardActionArea", slot);
}
var cardActionAreaClasses = generateUtilityClasses("MuiCardActionArea", ["root", "focusVisible", "focusHighlight"]);
var cardActionAreaClasses_default = cardActionAreaClasses;

// node_modules/@mui/material/esm/CardActionArea/CardActionArea.js
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var useUtilityClasses = (ownerState) => {
  const {
    classes
  } = ownerState;
  const slots = {
    root: ["root"],
    focusHighlight: ["focusHighlight"]
  };
  return composeClasses(slots, getCardActionAreaUtilityClass, classes);
};
var CardActionAreaRoot = styled_default(ButtonBase_default, {
  name: "MuiCardActionArea",
  slot: "Root"
})(memoTheme_default(({
  theme
}) => ({
  display: "block",
  textAlign: "inherit",
  borderRadius: "inherit",
  // for Safari to work https://github.com/mui/material-ui/issues/36285.
  width: "100%",
  [`&:hover .${cardActionAreaClasses_default.focusHighlight}`]: {
    opacity: (theme.vars || theme).palette.action.hoverOpacity,
    "@media (hover: none)": {
      opacity: 0
    }
  },
  [`&.${cardActionAreaClasses_default.focusVisible} .${cardActionAreaClasses_default.focusHighlight}`]: {
    opacity: (theme.vars || theme).palette.action.focusOpacity
  }
})));
var CardActionAreaFocusHighlight = styled_default("span", {
  name: "MuiCardActionArea",
  slot: "FocusHighlight"
})(memoTheme_default(({
  theme
}) => ({
  overflow: "hidden",
  pointerEvents: "none",
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  borderRadius: "inherit",
  opacity: 0,
  backgroundColor: "currentcolor",
  transition: theme.transitions.create("opacity", {
    duration: theme.transitions.duration.short
  })
})));
var CardActionArea = React.forwardRef(function CardActionArea2(inProps, ref) {
  const props = useDefaultProps({
    props: inProps,
    name: "MuiCardActionArea"
  });
  const {
    children,
    className,
    focusVisibleClassName,
    slots = {},
    slotProps = {},
    ...other
  } = props;
  const ownerState = props;
  const classes = useUtilityClasses(ownerState);
  const externalForwardedProps = {
    slots,
    slotProps
  };
  const [RootSlot, rootProps] = useSlot("root", {
    elementType: CardActionAreaRoot,
    externalForwardedProps: {
      ...externalForwardedProps,
      ...other
    },
    shouldForwardComponentProp: true,
    ownerState,
    ref,
    className: clsx_default(classes.root, className),
    additionalProps: {
      focusVisibleClassName: clsx_default(focusVisibleClassName, classes.focusVisible)
    }
  });
  const [FocusHighlightSlot, focusHighlightProps] = useSlot("focusHighlight", {
    elementType: CardActionAreaFocusHighlight,
    externalForwardedProps,
    ownerState,
    className: classes.focusHighlight
  });
  return (0, import_jsx_runtime.jsxs)(RootSlot, {
    ...rootProps,
    children: [children, (0, import_jsx_runtime.jsx)(FocusHighlightSlot, {
      ...focusHighlightProps
    })]
  });
});
true ? CardActionArea.propTypes = {
  // ┌────────────────────────────── Warning ──────────────────────────────┐
  // │ These PropTypes are generated from the TypeScript type definitions. │
  // │    To update them, edit the d.ts file and run `pnpm proptypes`.     │
  // └─────────────────────────────────────────────────────────────────────┘
  /**
   * The content of the component.
   */
  children: import_prop_types.default.node,
  /**
   * Override or extend the styles applied to the component.
   */
  classes: import_prop_types.default.object,
  /**
   * @ignore
   */
  className: import_prop_types.default.string,
  /**
   * @ignore
   */
  focusVisibleClassName: import_prop_types.default.string,
  /**
   * The props used for each slot inside.
   * @default {}
   */
  slotProps: import_prop_types.default.shape({
    focusHighlight: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
    root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
  }),
  /**
   * The components used for each slot inside.
   * @default {}
   */
  slots: import_prop_types.default.shape({
    focusHighlight: import_prop_types.default.elementType,
    root: import_prop_types.default.elementType
  }),
  /**
   * The system prop that allows defining system overrides as well as additional CSS styles.
   */
  sx: import_prop_types.default.oneOfType([import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object, import_prop_types.default.bool])), import_prop_types.default.func, import_prop_types.default.object])
} : void 0;
var CardActionArea_default = CardActionArea;

export {
  getCardActionAreaUtilityClass,
  cardActionAreaClasses_default,
  CardActionArea_default
};
//# sourceMappingURL=chunk-ETKKNUIA.js.map
