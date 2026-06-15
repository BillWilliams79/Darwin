// node_modules/@mui/utils/esm/getActiveElement/getActiveElement.js
function activeElement(doc) {
  var _a;
  let element = doc.activeElement;
  while (((_a = element == null ? void 0 : element.shadowRoot) == null ? void 0 : _a.activeElement) != null) {
    element = element.shadowRoot.activeElement;
  }
  return element;
}

// node_modules/@mui/material/esm/utils/getActiveElement.js
var getActiveElement_default = activeElement;

export {
  getActiveElement_default
};
//# sourceMappingURL=chunk-SLTJ2WYU.js.map
