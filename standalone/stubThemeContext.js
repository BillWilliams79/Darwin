// Standalone stub for ../Theme/ThemeContext (req #2743).
// Aliased in by vite.standalone.js. The BuildVisualizer subtree reads only
// `effectiveMode`; the standalone runs the dark scheme.
import { createContext } from 'react';

const ThemeContext = createContext({
    themeMode: 'dark',
    effectiveMode: 'dark',
    setThemeMode: () => {},
});

export default ThemeContext;
