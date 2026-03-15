import { createContext } from 'react';

const ThemeContext = createContext({
    themeMode: 'light',
    effectiveMode: 'light',
    setThemeMode: () => {},
});

export default ThemeContext;
