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
  require_react_is
} from "./chunk-NYRLRBKU.js";
import {
  require_jsx_runtime
} from "./chunk-NZAIND7N.js";
import {
  require_react
} from "./chunk-UVNPGZG7.js";
import {
  __toESM
} from "./chunk-OL46QLBJ.js";

// node_modules/@mui/material/esm/BottomNavigation/BottomNavigation.js
var React = __toESM(require_react(), 1);
var import_react_is = __toESM(require_react_is(), 1);
var import_prop_types = __toESM(require_prop_types(), 1);

// node_modules/@mui/material/esm/BottomNavigation/bottomNavigationClasses.js
function getBottomNavigationUtilityClass(slot) {
  return generateUtilityClass("MuiBottomNavigation", slot);
}
var bottomNavigationClasses = generateUtilityClasses("MuiBottomNavigation", ["root"]);
var bottomNavigationClasses_default = bottomNavigationClasses;

// node_modules/@mui/material/esm/BottomNavigation/BottomNavigation.js
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var useUtilityClasses = (ownerState) => {
  const {
    classes
  } = ownerState;
  const slots = {
    root: ["root"]
  };
  return composeClasses(slots, getBottomNavigationUtilityClass, classes);
};
var BottomNavigationRoot = styled_default("div", {
  name: "MuiBottomNavigation",
  slot: "Root"
})(memoTheme_default(({
  theme
}) => ({
  display: "flex",
  justifyContent: "center",
  height: 56,
  backgroundColor: (theme.vars || theme).palette.background.paper
})));
var BottomNavigation = React.forwardRef(function BottomNavigation2(inProps, ref) {
  const props = useDefaultProps({
    props: inProps,
    name: "MuiBottomNavigation"
  });
  const {
    children,
    className,
    component = "div",
    onChange,
    showLabels = false,
    value,
    ...other
  } = props;
  const ownerState = {
    ...props,
    component,
    showLabels
  };
  const classes = useUtilityClasses(ownerState);
  return (0, import_jsx_runtime.jsx)(BottomNavigationRoot, {
    as: component,
    className: clsx_default(classes.root, className),
    ref,
    ownerState,
    ...other,
    children: React.Children.map(children, (child, childIndex) => {
      if (!React.isValidElement(child)) {
        return null;
      }
      if (true) {
        if ((0, import_react_is.isFragment)(child)) {
          console.error(["MUI: The BottomNavigation component doesn't accept a Fragment as a child.", "Consider providing an array instead."].join("\n"));
        }
      }
      const childValue = child.props.value === void 0 ? childIndex : child.props.value;
      return React.cloneElement(child, {
        selected: childValue === value,
        showLabel: child.props.showLabel !== void 0 ? child.props.showLabel : showLabels,
        value: childValue,
        onChange
      });
    })
  });
});
true ? BottomNavigation.propTypes = {
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
   * The component used for the root node.
   * Either a string to use a HTML element or a component.
   */
  component: import_prop_types.default.elementType,
  /**
   * Callback fired when the value changes.
   *
   * @param {React.SyntheticEvent} event The event source of the callback. **Warning**: This is a generic event not a change event.
   * @param {any} value We default to the index of the child.
   */
  onChange: import_prop_types.default.func,
  /**
   * If `true`, all `BottomNavigationAction`s will show their labels.
   * By default, only the selected `BottomNavigationAction` will show its label.
   * @default false
   */
  showLabels: import_prop_types.default.bool,
  /**
   * The system prop that allows defining system overrides as well as additional CSS styles.
   */
  sx: import_prop_types.default.oneOfType([import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object, import_prop_types.default.bool])), import_prop_types.default.func, import_prop_types.default.object]),
  /**
   * The value of the currently selected `BottomNavigationAction`.
   */
  value: import_prop_types.default.any
} : void 0;
var BottomNavigation_default = BottomNavigation;

export {
  getBottomNavigationUtilityClass,
  bottomNavigationClasses_default,
  BottomNavigation_default
};
//# sourceMappingURL=chunk-3RMWGJVS.js.map
