import {
  require_react
} from "./chunk-UVNPGZG7.js";
import {
  __toESM
} from "./chunk-OL46QLBJ.js";

// node_modules/@mui/utils/esm/usePreviousProps/usePreviousProps.js
var React = __toESM(require_react(), 1);
function usePreviousProps(value) {
  const ref = React.useRef({});
  React.useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}
var usePreviousProps_default = usePreviousProps;

export {
  usePreviousProps_default
};
//# sourceMappingURL=chunk-SRUI2SZG.js.map
