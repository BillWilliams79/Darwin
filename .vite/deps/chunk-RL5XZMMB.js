import {
  KeyboardArrowLeft_default,
  KeyboardArrowRight_default
} from "./chunk-7RTYUCQ6.js";
import {
  Toolbar_default
} from "./chunk-2HOO2W4P.js";
import {
  TableCell_default
} from "./chunk-Q7WDDGT2.js";
import {
  MenuItem_default
} from "./chunk-J5ZNC4U5.js";
import {
  Select_default
} from "./chunk-YL2PI3Y5.js";
import {
  InputBase_default
} from "./chunk-FYSJIKZX.js";
import {
  IconButton_default
} from "./chunk-YQIGD563.js";
import {
  integerPropType_default
} from "./chunk-N4T3NUR7.js";
import {
  chainPropTypes
} from "./chunk-JX37XSKT.js";
import {
  useSlot
} from "./chunk-KLNJAZIL.js";
import {
  useId_default
} from "./chunk-7RBGCX5T.js";
import {
  createSvgIcon
} from "./chunk-B4YA2I2D.js";
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
  styled_default2 as styled_default,
  useRtl
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

// node_modules/@mui/material/esm/TablePagination/TablePagination.js
var React2 = __toESM(require_react(), 1);
var import_prop_types2 = __toESM(require_prop_types(), 1);

// node_modules/@mui/material/esm/TablePaginationActions/TablePaginationActions.js
var React = __toESM(require_react(), 1);
var import_prop_types = __toESM(require_prop_types(), 1);

// node_modules/@mui/material/esm/internal/svg-icons/LastPage.js
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var LastPage_default = createSvgIcon((0, import_jsx_runtime.jsx)("path", {
  d: "M5.59 7.41L10.18 12l-4.59 4.59L7 18l6-6-6-6zM16 6h2v12h-2z"
}), "LastPage");

// node_modules/@mui/material/esm/internal/svg-icons/FirstPage.js
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var FirstPage_default = createSvgIcon((0, import_jsx_runtime2.jsx)("path", {
  d: "M18.41 16.59L13.82 12l4.59-4.59L17 6l-6 6 6 6zM6 6h2v12H6z"
}), "FirstPage");

// node_modules/@mui/material/esm/TablePaginationActions/tablePaginationActionsClasses.js
function getTablePaginationActionsUtilityClass(slot) {
  return generateUtilityClass("MuiTablePaginationActions", slot);
}
var tablePaginationActionsClasses = generateUtilityClasses("MuiTablePaginationActions", ["root"]);
var tablePaginationActionsClasses_default = tablePaginationActionsClasses;

// node_modules/@mui/material/esm/TablePaginationActions/TablePaginationActions.js
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var useUtilityClasses = (ownerState) => {
  const {
    classes
  } = ownerState;
  const slots = {
    root: ["root"]
  };
  return composeClasses(slots, getTablePaginationActionsUtilityClass, classes);
};
var TablePaginationActionsRoot = styled_default("div", {
  name: "MuiTablePaginationActions",
  slot: "Root"
})({});
var TablePaginationActions = React.forwardRef(function TablePaginationActions2(inProps, ref) {
  const props = useDefaultProps({
    props: inProps,
    name: "MuiTablePaginationActions"
  });
  const {
    backIconButtonProps,
    className,
    count,
    disabled = false,
    getItemAriaLabel,
    nextIconButtonProps,
    onPageChange,
    page,
    rowsPerPage,
    showFirstButton,
    showLastButton,
    slots = {},
    slotProps = {},
    ...other
  } = props;
  const isRtl = useRtl();
  const ownerState = props;
  const classes = useUtilityClasses(ownerState);
  const handleFirstPageButtonClick = (event) => {
    onPageChange(event, 0);
  };
  const handleBackButtonClick = (event) => {
    onPageChange(event, page - 1);
  };
  const handleNextButtonClick = (event) => {
    onPageChange(event, page + 1);
  };
  const handleLastPageButtonClick = (event) => {
    onPageChange(event, Math.max(0, Math.ceil(count / rowsPerPage) - 1));
  };
  const FirstButton = slots.firstButton ?? IconButton_default;
  const LastButton = slots.lastButton ?? IconButton_default;
  const NextButton = slots.nextButton ?? IconButton_default;
  const PreviousButton = slots.previousButton ?? IconButton_default;
  const FirstButtonIcon = slots.firstButtonIcon ?? FirstPage_default;
  const LastButtonIcon = slots.lastButtonIcon ?? LastPage_default;
  const NextButtonIcon = slots.nextButtonIcon ?? KeyboardArrowRight_default;
  const PreviousButtonIcon = slots.previousButtonIcon ?? KeyboardArrowLeft_default;
  const FirstButtonSlot = isRtl ? LastButton : FirstButton;
  const PreviousButtonSlot = isRtl ? NextButton : PreviousButton;
  const NextButtonSlot = isRtl ? PreviousButton : NextButton;
  const LastButtonSlot = isRtl ? FirstButton : LastButton;
  const firstButtonSlotProps = isRtl ? slotProps.lastButton : slotProps.firstButton;
  const previousButtonSlotProps = isRtl ? slotProps.nextButton : slotProps.previousButton;
  const nextButtonSlotProps = isRtl ? slotProps.previousButton : slotProps.nextButton;
  const lastButtonSlotProps = isRtl ? slotProps.firstButton : slotProps.lastButton;
  return (0, import_jsx_runtime3.jsxs)(TablePaginationActionsRoot, {
    ref,
    className: clsx_default(classes.root, className),
    ...other,
    children: [showFirstButton && (0, import_jsx_runtime3.jsx)(FirstButtonSlot, {
      onClick: handleFirstPageButtonClick,
      disabled: disabled || page === 0,
      "aria-label": getItemAriaLabel("first", page),
      title: getItemAriaLabel("first", page),
      ...firstButtonSlotProps,
      children: isRtl ? (0, import_jsx_runtime3.jsx)(LastButtonIcon, {
        ...slotProps.lastButtonIcon
      }) : (0, import_jsx_runtime3.jsx)(FirstButtonIcon, {
        ...slotProps.firstButtonIcon
      })
    }), (0, import_jsx_runtime3.jsx)(PreviousButtonSlot, {
      onClick: handleBackButtonClick,
      disabled: disabled || page === 0,
      color: "inherit",
      "aria-label": getItemAriaLabel("previous", page),
      title: getItemAriaLabel("previous", page),
      ...previousButtonSlotProps ?? backIconButtonProps,
      children: isRtl ? (0, import_jsx_runtime3.jsx)(NextButtonIcon, {
        ...slotProps.nextButtonIcon
      }) : (0, import_jsx_runtime3.jsx)(PreviousButtonIcon, {
        ...slotProps.previousButtonIcon
      })
    }), (0, import_jsx_runtime3.jsx)(NextButtonSlot, {
      onClick: handleNextButtonClick,
      disabled: disabled || (count !== -1 ? page >= Math.ceil(count / rowsPerPage) - 1 : false),
      color: "inherit",
      "aria-label": getItemAriaLabel("next", page),
      title: getItemAriaLabel("next", page),
      ...nextButtonSlotProps ?? nextIconButtonProps,
      children: isRtl ? (0, import_jsx_runtime3.jsx)(PreviousButtonIcon, {
        ...slotProps.previousButtonIcon
      }) : (0, import_jsx_runtime3.jsx)(NextButtonIcon, {
        ...slotProps.nextButtonIcon
      })
    }), showLastButton && (0, import_jsx_runtime3.jsx)(LastButtonSlot, {
      onClick: handleLastPageButtonClick,
      disabled: disabled || page >= Math.ceil(count / rowsPerPage) - 1,
      "aria-label": getItemAriaLabel("last", page),
      title: getItemAriaLabel("last", page),
      ...lastButtonSlotProps,
      children: isRtl ? (0, import_jsx_runtime3.jsx)(FirstButtonIcon, {
        ...slotProps.firstButtonIcon
      }) : (0, import_jsx_runtime3.jsx)(LastButtonIcon, {
        ...slotProps.lastButtonIcon
      })
    })]
  });
});
true ? TablePaginationActions.propTypes = {
  // ┌────────────────────────────── Warning ──────────────────────────────┐
  // │ These PropTypes are generated from the TypeScript type definitions. │
  // │    To update them, edit the d.ts file and run `pnpm proptypes`.     │
  // └─────────────────────────────────────────────────────────────────────┘
  /**
   * This prop is an alias for `slotProps.previousButton` and will be overridden by it if both are used.
   * @deprecated Use `slotProps.previousButton` instead.
   */
  backIconButtonProps: import_prop_types.default.object,
  /**
   * @ignore
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
  count: import_prop_types.default.number.isRequired,
  /**
   * If `true`, the component is disabled.
   * @default false
   */
  disabled: import_prop_types.default.bool,
  /**
   * Accepts a function which returns a string value that provides a user-friendly name for the current page.
   * This is important for screen reader users.
   *
   * For localization purposes, you can use the provided [translations](https://mui.com/material-ui/guides/localization/).
   * @param {string} type The link or button type to format ('first' | 'last' | 'next' | 'previous').
   * @returns {string}
   */
  getItemAriaLabel: import_prop_types.default.func.isRequired,
  /**
   * This prop is an alias for `slotProps.nextButton` and will be overridden by it if both are used.
   * @deprecated Use `slotProps.nextButton` instead.
   */
  nextIconButtonProps: import_prop_types.default.object,
  /**
   * @ignore
   */
  onPageChange: import_prop_types.default.func.isRequired,
  /**
   * @ignore
   */
  page: import_prop_types.default.number.isRequired,
  /**
   * @ignore
   */
  rowsPerPage: import_prop_types.default.number.isRequired,
  /**
   * @ignore
   */
  showFirstButton: import_prop_types.default.bool.isRequired,
  /**
   * @ignore
   */
  showLastButton: import_prop_types.default.bool.isRequired,
  /**
   * @ignore
   */
  slotProps: import_prop_types.default.shape({
    firstButton: import_prop_types.default.object,
    firstButtonIcon: import_prop_types.default.object,
    lastButton: import_prop_types.default.object,
    lastButtonIcon: import_prop_types.default.object,
    nextButton: import_prop_types.default.object,
    nextButtonIcon: import_prop_types.default.object,
    previousButton: import_prop_types.default.object,
    previousButtonIcon: import_prop_types.default.object
  }),
  /**
   * @ignore
   */
  slots: import_prop_types.default.shape({
    firstButton: import_prop_types.default.elementType,
    firstButtonIcon: import_prop_types.default.elementType,
    lastButton: import_prop_types.default.elementType,
    lastButtonIcon: import_prop_types.default.elementType,
    nextButton: import_prop_types.default.elementType,
    nextButtonIcon: import_prop_types.default.elementType,
    previousButton: import_prop_types.default.elementType,
    previousButtonIcon: import_prop_types.default.elementType
  })
} : void 0;
var TablePaginationActions_default = TablePaginationActions;

// node_modules/@mui/material/esm/TablePagination/tablePaginationClasses.js
function getTablePaginationUtilityClass(slot) {
  return generateUtilityClass("MuiTablePagination", slot);
}
var tablePaginationClasses = generateUtilityClasses("MuiTablePagination", ["root", "toolbar", "spacer", "selectLabel", "selectRoot", "select", "selectIcon", "input", "menuItem", "displayedRows", "actions"]);
var tablePaginationClasses_default = tablePaginationClasses;

// node_modules/@mui/material/esm/TablePagination/TablePagination.js
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var import_react = __toESM(require_react(), 1);
var _InputBase;
var TablePaginationRoot = styled_default(TableCell_default, {
  name: "MuiTablePagination",
  slot: "Root"
})(memoTheme_default(({
  theme
}) => ({
  overflow: "auto",
  color: (theme.vars || theme).palette.text.primary,
  fontSize: theme.typography.pxToRem(14),
  // Increase the specificity to override TableCell.
  "&:last-child": {
    padding: 0
  }
})));
var TablePaginationToolbar = styled_default(Toolbar_default, {
  name: "MuiTablePagination",
  slot: "Toolbar",
  overridesResolver: (props, styles) => ({
    [`& .${tablePaginationClasses_default.actions}`]: styles.actions,
    ...styles.toolbar
  })
})(memoTheme_default(({
  theme
}) => ({
  minHeight: 52,
  paddingRight: 2,
  [`${theme.breakpoints.up("xs")} and (orientation: landscape)`]: {
    minHeight: 52
  },
  [theme.breakpoints.up("sm")]: {
    minHeight: 52,
    paddingRight: 2
  },
  [`& .${tablePaginationClasses_default.actions}`]: {
    flexShrink: 0,
    marginLeft: 20
  }
})));
var TablePaginationSpacer = styled_default("div", {
  name: "MuiTablePagination",
  slot: "Spacer"
})({
  flex: "1 1 100%"
});
var TablePaginationSelectLabel = styled_default("p", {
  name: "MuiTablePagination",
  slot: "SelectLabel"
})(memoTheme_default(({
  theme
}) => ({
  ...theme.typography.body2,
  flexShrink: 0
})));
var TablePaginationSelect = styled_default(Select_default, {
  name: "MuiTablePagination",
  slot: "Select",
  overridesResolver: (props, styles) => ({
    [`& .${tablePaginationClasses_default.selectIcon}`]: styles.selectIcon,
    [`& .${tablePaginationClasses_default.select}`]: styles.select,
    ...styles.input,
    ...styles.selectRoot
  })
})({
  color: "inherit",
  fontSize: "inherit",
  flexShrink: 0,
  marginRight: 32,
  marginLeft: 8,
  [`& .${tablePaginationClasses_default.select}`]: {
    paddingLeft: 8,
    paddingRight: 24,
    textAlign: "right",
    textAlignLast: "right"
    // Align <select> on Chrome.
  }
});
var TablePaginationMenuItem = styled_default(MenuItem_default, {
  name: "MuiTablePagination",
  slot: "MenuItem"
})({});
var TablePaginationDisplayedRows = styled_default("p", {
  name: "MuiTablePagination",
  slot: "DisplayedRows"
})(memoTheme_default(({
  theme
}) => ({
  ...theme.typography.body2,
  flexShrink: 0
})));
function defaultLabelDisplayedRows({
  from,
  to,
  count
}) {
  return `${from}–${to} of ${count !== -1 ? count : `more than ${to}`}`;
}
function defaultGetAriaLabel(type) {
  return `Go to ${type} page`;
}
var useUtilityClasses2 = (ownerState) => {
  const {
    classes
  } = ownerState;
  const slots = {
    root: ["root"],
    toolbar: ["toolbar"],
    spacer: ["spacer"],
    selectLabel: ["selectLabel"],
    select: ["select"],
    input: ["input"],
    selectIcon: ["selectIcon"],
    menuItem: ["menuItem"],
    displayedRows: ["displayedRows"],
    actions: ["actions"]
  };
  return composeClasses(slots, getTablePaginationUtilityClass, classes);
};
var TablePagination = React2.forwardRef(function TablePagination2(inProps, ref) {
  const props = useDefaultProps({
    props: inProps,
    name: "MuiTablePagination"
  });
  const {
    ActionsComponent = TablePaginationActions_default,
    backIconButtonProps,
    colSpan: colSpanProp,
    component = TableCell_default,
    count,
    disabled = false,
    getItemAriaLabel = defaultGetAriaLabel,
    labelDisplayedRows = defaultLabelDisplayedRows,
    labelRowsPerPage = "Rows per page:",
    nextIconButtonProps,
    onPageChange,
    onRowsPerPageChange,
    page,
    rowsPerPage,
    rowsPerPageOptions = [10, 25, 50, 100],
    SelectProps = {},
    showFirstButton = false,
    showLastButton = false,
    slotProps = {},
    slots = {},
    ...other
  } = props;
  const ownerState = props;
  const classes = useUtilityClasses2(ownerState);
  const selectProps = (slotProps == null ? void 0 : slotProps.select) ?? SelectProps;
  const MenuItemComponent = selectProps.native ? "option" : TablePaginationMenuItem;
  let colSpan;
  if (component === TableCell_default || component === "td") {
    colSpan = colSpanProp || 1e3;
  }
  const selectId = useId_default(selectProps.id);
  const labelId = useId_default(selectProps.labelId);
  const getLabelDisplayedRowsTo = () => {
    if (count === -1) {
      return (page + 1) * rowsPerPage;
    }
    return rowsPerPage === -1 ? count : Math.min(count, (page + 1) * rowsPerPage);
  };
  const externalForwardedProps = {
    slots,
    slotProps
  };
  const [RootSlot, rootSlotProps] = useSlot("root", {
    ref,
    className: classes.root,
    elementType: TablePaginationRoot,
    externalForwardedProps: {
      ...externalForwardedProps,
      component,
      ...other
    },
    ownerState,
    additionalProps: {
      colSpan
    }
  });
  const [ToolbarSlot, toolbarSlotProps] = useSlot("toolbar", {
    className: classes.toolbar,
    elementType: TablePaginationToolbar,
    externalForwardedProps,
    ownerState
  });
  const [SpacerSlot, spacerSlotProps] = useSlot("spacer", {
    className: classes.spacer,
    elementType: TablePaginationSpacer,
    externalForwardedProps,
    ownerState
  });
  const [SelectLabelSlot, selectLabelSlotProps] = useSlot("selectLabel", {
    className: classes.selectLabel,
    elementType: TablePaginationSelectLabel,
    externalForwardedProps,
    ownerState,
    additionalProps: {
      id: labelId
    }
  });
  const [SelectSlot, selectSlotProps] = useSlot("select", {
    className: classes.select,
    elementType: TablePaginationSelect,
    externalForwardedProps,
    ownerState
  });
  const [MenuItemSlot, menuItemSlotProps] = useSlot("menuItem", {
    className: classes.menuItem,
    elementType: MenuItemComponent,
    externalForwardedProps,
    ownerState
  });
  const [DisplayedRows, displayedRowsProps] = useSlot("displayedRows", {
    className: classes.displayedRows,
    elementType: TablePaginationDisplayedRows,
    externalForwardedProps,
    ownerState
  });
  return (0, import_jsx_runtime4.jsx)(RootSlot, {
    ...rootSlotProps,
    children: (0, import_jsx_runtime4.jsxs)(ToolbarSlot, {
      ...toolbarSlotProps,
      children: [(0, import_jsx_runtime4.jsx)(SpacerSlot, {
        ...spacerSlotProps
      }), rowsPerPageOptions.length > 1 && (0, import_jsx_runtime4.jsx)(SelectLabelSlot, {
        ...selectLabelSlotProps,
        children: labelRowsPerPage
      }), rowsPerPageOptions.length > 1 && (0, import_jsx_runtime4.jsx)(SelectSlot, {
        variant: "standard",
        ...!selectProps.variant && {
          input: _InputBase || (_InputBase = (0, import_jsx_runtime4.jsx)(InputBase_default, {}))
        },
        value: rowsPerPage,
        onChange: onRowsPerPageChange,
        id: selectId,
        labelId,
        ...selectProps,
        classes: {
          ...selectProps.classes,
          // TODO v5 remove `classes.input`
          root: clsx_default(classes.input, classes.selectRoot, (selectProps.classes || {}).root),
          select: clsx_default(classes.select, (selectProps.classes || {}).select),
          // TODO v5 remove `selectIcon`
          icon: clsx_default(classes.selectIcon, (selectProps.classes || {}).icon)
        },
        disabled,
        ...selectSlotProps,
        children: rowsPerPageOptions.map((rowsPerPageOption) => (0, import_react.createElement)(MenuItemSlot, {
          ...menuItemSlotProps,
          key: rowsPerPageOption.label ? rowsPerPageOption.label : rowsPerPageOption,
          value: rowsPerPageOption.value ? rowsPerPageOption.value : rowsPerPageOption
        }, rowsPerPageOption.label ? rowsPerPageOption.label : rowsPerPageOption))
      }), (0, import_jsx_runtime4.jsx)(DisplayedRows, {
        ...displayedRowsProps,
        children: labelDisplayedRows({
          from: count === 0 ? 0 : page * rowsPerPage + 1,
          to: getLabelDisplayedRowsTo(),
          count: count === -1 ? -1 : count,
          page
        })
      }), (0, import_jsx_runtime4.jsx)(ActionsComponent, {
        className: classes.actions,
        backIconButtonProps,
        count,
        nextIconButtonProps,
        onPageChange,
        page,
        rowsPerPage,
        showFirstButton,
        showLastButton,
        slotProps: slotProps.actions,
        slots: slots.actions,
        getItemAriaLabel,
        disabled
      })]
    })
  });
});
true ? TablePagination.propTypes = {
  // ┌────────────────────────────── Warning ──────────────────────────────┐
  // │ These PropTypes are generated from the TypeScript type definitions. │
  // │    To update them, edit the d.ts file and run `pnpm proptypes`.     │
  // └─────────────────────────────────────────────────────────────────────┘
  /**
   * The component used for displaying the actions.
   * Either a string to use a HTML element or a component.
   * @default TablePaginationActions
   */
  ActionsComponent: import_prop_types2.default.elementType,
  /**
   * Props applied to the back arrow [`IconButton`](https://mui.com/material-ui/api/icon-button/) component.
   *
   * This prop is an alias for `slotProps.actions.previousButton` and will be overridden by it if both are used.
   * @deprecated Use `slotProps.actions.previousButton` instead.
   */
  backIconButtonProps: import_prop_types2.default.object,
  /**
   * Override or extend the styles applied to the component.
   */
  classes: import_prop_types2.default.object,
  /**
   * @ignore
   */
  colSpan: import_prop_types2.default.number,
  /**
   * The component used for the root node.
   * Either a string to use a HTML element or a component.
   */
  component: import_prop_types2.default.elementType,
  /**
   * The total number of rows.
   *
   * To enable server side pagination for an unknown number of items, provide -1.
   */
  count: integerPropType_default.isRequired,
  /**
   * If `true`, the component is disabled.
   * @default false
   */
  disabled: import_prop_types2.default.bool,
  /**
   * Accepts a function which returns a string value that provides a user-friendly name for the current page.
   * This is important for screen reader users.
   *
   * For localization purposes, you can use the provided [translations](https://mui.com/material-ui/guides/localization/).
   * @param {string} type The link or button type to format ('first' | 'last' | 'next' | 'previous').
   * @returns {string}
   * @default function defaultGetAriaLabel(type) {
   *   return `Go to ${type} page`;
   * }
   */
  getItemAriaLabel: import_prop_types2.default.func,
  /**
   * Customize the displayed rows label. Invoked with a `{ from, to, count, page }`
   * object.
   *
   * For localization purposes, you can use the provided [translations](https://mui.com/material-ui/guides/localization/).
   * @default function defaultLabelDisplayedRows({ from, to, count }) {
   *   return `${from}–${to} of ${count !== -1 ? count : `more than ${to}`}`;
   * }
   */
  labelDisplayedRows: import_prop_types2.default.func,
  /**
   * Customize the rows per page label.
   *
   * For localization purposes, you can use the provided [translations](https://mui.com/material-ui/guides/localization/).
   * @default 'Rows per page:'
   */
  labelRowsPerPage: import_prop_types2.default.node,
  /**
   * Props applied to the next arrow [`IconButton`](https://mui.com/material-ui/api/icon-button/) element.
   *
   * This prop is an alias for `slotProps.actions.nextButton` and will be overridden by it if both are used.
   * @deprecated Use `slotProps.actions.nextButton` instead.
   */
  nextIconButtonProps: import_prop_types2.default.object,
  /**
   * Callback fired when the page is changed.
   *
   * @param {React.MouseEvent<HTMLButtonElement> | null} event The event source of the callback.
   * @param {number} page The page selected.
   */
  onPageChange: import_prop_types2.default.func.isRequired,
  /**
   * Callback fired when the number of rows per page is changed.
   *
   * @param {React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>} event The event source of the callback.
   */
  onRowsPerPageChange: import_prop_types2.default.func,
  /**
   * The zero-based index of the current page.
   */
  page: chainPropTypes(integerPropType_default.isRequired, (props) => {
    const {
      count,
      page,
      rowsPerPage
    } = props;
    if (count === -1) {
      return null;
    }
    const newLastPage = Math.max(0, Math.ceil(count / rowsPerPage) - 1);
    if (page < 0 || page > newLastPage) {
      return new Error(`MUI: The page prop of a TablePagination is out of range (0 to ${newLastPage}, but page is ${page}).`);
    }
    return null;
  }),
  /**
   * The number of rows per page.
   *
   * Set -1 to display all the rows.
   */
  rowsPerPage: integerPropType_default.isRequired,
  /**
   * Customizes the options of the rows per page select field. If less than two options are
   * available, no select field will be displayed.
   * Use -1 for the value with a custom label to show all the rows.
   * @default [10, 25, 50, 100]
   */
  rowsPerPageOptions: import_prop_types2.default.arrayOf(import_prop_types2.default.oneOfType([import_prop_types2.default.number, import_prop_types2.default.shape({
    label: import_prop_types2.default.string.isRequired,
    value: import_prop_types2.default.number.isRequired
  })]).isRequired),
  /**
   * Props applied to the rows per page [`Select`](https://mui.com/material-ui/api/select/) element.
   *
   * This prop is an alias for `slotProps.select` and will be overridden by it if both are used.
   * @deprecated Use `slotProps.select` instead.
   *
   * @default {}
   */
  SelectProps: import_prop_types2.default.object,
  /**
   * If `true`, show the first-page button.
   * @default false
   */
  showFirstButton: import_prop_types2.default.bool,
  /**
   * If `true`, show the last-page button.
   * @default false
   */
  showLastButton: import_prop_types2.default.bool,
  /**
   * The props used for each slot inside.
   * @default {}
   */
  slotProps: import_prop_types2.default.shape({
    actions: import_prop_types2.default.shape({
      firstButton: import_prop_types2.default.object,
      firstButtonIcon: import_prop_types2.default.object,
      lastButton: import_prop_types2.default.object,
      lastButtonIcon: import_prop_types2.default.object,
      nextButton: import_prop_types2.default.object,
      nextButtonIcon: import_prop_types2.default.object,
      previousButton: import_prop_types2.default.object,
      previousButtonIcon: import_prop_types2.default.object
    }),
    displayedRows: import_prop_types2.default.oneOfType([import_prop_types2.default.func, import_prop_types2.default.object]),
    menuItem: import_prop_types2.default.oneOfType([import_prop_types2.default.func, import_prop_types2.default.object]),
    root: import_prop_types2.default.oneOfType([import_prop_types2.default.func, import_prop_types2.default.object]),
    select: import_prop_types2.default.object,
    selectLabel: import_prop_types2.default.oneOfType([import_prop_types2.default.func, import_prop_types2.default.object]),
    spacer: import_prop_types2.default.oneOfType([import_prop_types2.default.func, import_prop_types2.default.object]),
    toolbar: import_prop_types2.default.oneOfType([import_prop_types2.default.func, import_prop_types2.default.object])
  }),
  /**
   * The components used for each slot inside.
   * @default {}
   */
  slots: import_prop_types2.default.shape({
    actions: import_prop_types2.default.shape({
      firstButton: import_prop_types2.default.elementType,
      firstButtonIcon: import_prop_types2.default.elementType,
      lastButton: import_prop_types2.default.elementType,
      lastButtonIcon: import_prop_types2.default.elementType,
      nextButton: import_prop_types2.default.elementType,
      nextButtonIcon: import_prop_types2.default.elementType,
      previousButton: import_prop_types2.default.elementType,
      previousButtonIcon: import_prop_types2.default.elementType
    }),
    displayedRows: import_prop_types2.default.elementType,
    menuItem: import_prop_types2.default.elementType,
    root: import_prop_types2.default.elementType,
    select: import_prop_types2.default.elementType,
    selectLabel: import_prop_types2.default.elementType,
    spacer: import_prop_types2.default.elementType,
    toolbar: import_prop_types2.default.elementType
  }),
  /**
   * The system prop that allows defining system overrides as well as additional CSS styles.
   */
  sx: import_prop_types2.default.oneOfType([import_prop_types2.default.arrayOf(import_prop_types2.default.oneOfType([import_prop_types2.default.func, import_prop_types2.default.object, import_prop_types2.default.bool])), import_prop_types2.default.func, import_prop_types2.default.object])
} : void 0;
var TablePagination_default = TablePagination;

export {
  FirstPage_default,
  LastPage_default,
  tablePaginationActionsClasses_default,
  TablePaginationActions_default,
  getTablePaginationUtilityClass,
  tablePaginationClasses_default,
  TablePagination_default
};
//# sourceMappingURL=chunk-RL5XZMMB.js.map
