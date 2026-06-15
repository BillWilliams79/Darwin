import {
  ButtonBase_default
} from "./chunk-UA3GRSOW.js";
import {
  useSlot
} from "./chunk-KLNJAZIL.js";
import {
  unsupportedProp_default
} from "./chunk-YN4LU4GR.js";
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

// node_modules/@mui/material/esm/BottomNavigationAction/BottomNavigationAction.js
var React = __toESM(require_react(), 1);
var import_prop_types = __toESM(require_prop_types(), 1);

// node_modules/@mui/material/esm/BottomNavigationAction/bottomNavigationActionClasses.js
function getBottomNavigationActionUtilityClass(slot) {
  return generateUtilityClass("MuiBottomNavigationAction", slot);
}
var bottomNavigationActionClasses = generateUtilityClasses("MuiBottomNavigationAction", ["root", "iconOnly", "selected", "label"]);
var bottomNavigationActionClasses_default = bottomNavigationActionClasses;

// node_modules/@mui/material/esm/BottomNavigationAction/BottomNavigationAction.js
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var useUtilityClasses = (ownerState) => {
  const {
    classes,
    showLabel,
    selected
  } = ownerState;
  const slots = {
    root: ["root", !showLabel && !selected && "iconOnly", selected && "selected"],
    label: ["label", !showLabel && !selected && "iconOnly", selected && "selected"]
  };
  return composeClasses(slots, getBottomNavigationActionUtilityClass, classes);
};
var BottomNavigationActionRoot = styled_default(ButtonBase_default, {
  name: "MuiBottomNavigationAction",
  slot: "Root",
  overridesResolver: (props, styles) => {
    const {
      ownerState
    } = props;
    return [styles.root, !ownerState.showLabel && !ownerState.selected && styles.iconOnly];
  }
})(memoTheme_default(({
  theme
}) => ({
  transition: theme.transitions.create(["color", "padding-top"], {
    duration: theme.transitions.duration.short
  }),
  padding: "0px 12px",
  minWidth: 80,
  maxWidth: 168,
  color: (theme.vars || theme).palette.text.secondary,
  flexDirection: "column",
  flex: "1",
  [`&.${bottomNavigationActionClasses_default.selected}`]: {
    color: (theme.vars || theme).palette.primary.main
  },
  variants: [{
    props: ({
      showLabel,
      selected
    }) => !showLabel && !selected,
    style: {
      paddingTop: 14
    }
  }, {
    props: ({
      showLabel,
      selected,
      label
    }) => !showLabel && !selected && !label,
    style: {
      paddingTop: 0
    }
  }]
})));
var BottomNavigationActionLabel = styled_default("span", {
  name: "MuiBottomNavigationAction",
  slot: "Label"
})(memoTheme_default(({
  theme
}) => ({
  fontFamily: theme.typography.fontFamily,
  fontSize: theme.typography.pxToRem(12),
  opacity: 1,
  transition: "font-size 0.2s, opacity 0.2s",
  transitionDelay: "0.1s",
  [`&.${bottomNavigationActionClasses_default.selected}`]: {
    fontSize: theme.typography.pxToRem(14)
  },
  variants: [{
    props: ({
      showLabel,
      selected
    }) => !showLabel && !selected,
    style: {
      opacity: 0,
      transitionDelay: "0s"
    }
  }]
})));
var BottomNavigationAction = React.forwardRef(function BottomNavigationAction2(inProps, ref) {
  const props = useDefaultProps({
    props: inProps,
    name: "MuiBottomNavigationAction"
  });
  const {
    className,
    icon,
    label,
    onChange,
    onClick,
    // eslint-disable-next-line react/prop-types -- private, always overridden by BottomNavigation
    selected,
    showLabel,
    value,
    slots = {},
    slotProps = {},
    ...other
  } = props;
  const ownerState = props;
  const classes = useUtilityClasses(ownerState);
  const handleChange = (event) => {
    if (onChange) {
      onChange(event, value);
    }
    if (onClick) {
      onClick(event);
    }
  };
  const externalForwardedProps = {
    slots,
    slotProps
  };
  const [RootSlot, rootProps] = useSlot("root", {
    elementType: BottomNavigationActionRoot,
    externalForwardedProps: {
      ...externalForwardedProps,
      ...other
    },
    shouldForwardComponentProp: true,
    ownerState,
    ref,
    className: clsx_default(classes.root, className),
    additionalProps: {
      focusRipple: true
    },
    getSlotProps: (handlers) => ({
      ...handlers,
      onClick: (event) => {
        var _a;
        (_a = handlers.onClick) == null ? void 0 : _a.call(handlers, event);
        handleChange(event);
      }
    })
  });
  const [LabelSlot, labelProps] = useSlot("label", {
    elementType: BottomNavigationActionLabel,
    externalForwardedProps,
    ownerState,
    className: classes.label
  });
  return (0, import_jsx_runtime.jsxs)(RootSlot, {
    ...rootProps,
    children: [icon, (0, import_jsx_runtime.jsx)(LabelSlot, {
      ...labelProps,
      children: label
    })]
  });
});
true ? BottomNavigationAction.propTypes = {
  // ┌────────────────────────────── Warning ──────────────────────────────┐
  // │ These PropTypes are generated from the TypeScript type definitions. │
  // │    To update them, edit the d.ts file and run `pnpm proptypes`.     │
  // └─────────────────────────────────────────────────────────────────────┘
  /**
   * This prop isn't supported.
   * Use the `component` prop if you need to change the children structure.
   */
  children: unsupportedProp_default,
  /**
   * Override or extend the styles applied to the component.
   */
  classes: import_prop_types.default.object,
  /**
   * @ignore
   */
  className: import_prop_types.default.string,
  /**
   * The icon to display.
   */
  icon: import_prop_types.default.node,
  /**
   * The label element.
   */
  label: import_prop_types.default.node,
  /**
   * @ignore
   */
  onChange: import_prop_types.default.func,
  /**
   * @ignore
   */
  onClick: import_prop_types.default.func,
  /**
   * If `true`, the `BottomNavigationAction` will show its label.
   * By default, only the selected `BottomNavigationAction`
   * inside `BottomNavigation` will show its label.
   *
   * The prop defaults to the value (`false`) inherited from the parent BottomNavigation component.
   */
  showLabel: import_prop_types.default.bool,
  /**
   * The props used for each slot inside.
   * @default {}
   */
  slotProps: import_prop_types.default.shape({
    label: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
    root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
  }),
  /**
   * The components used for each slot inside.
   * @default {}
   */
  slots: import_prop_types.default.shape({
    label: import_prop_types.default.elementType,
    root: import_prop_types.default.elementType
  }),
  /**
   * The system prop that allows defining system overrides as well as additional CSS styles.
   */
  sx: import_prop_types.default.oneOfType([import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object, import_prop_types.default.bool])), import_prop_types.default.func, import_prop_types.default.object]),
  /**
   * You can provide your own value. Otherwise, we fallback to the child position index.
   */
  value: import_prop_types.default.any
} : void 0;
var BottomNavigationAction_default = BottomNavigationAction;

export {
  getBottomNavigationActionUtilityClass,
  bottomNavigationActionClasses_default,
  BottomNavigationAction_default
};
//# sourceMappingURL=chunk-EL3K5242.js.map
