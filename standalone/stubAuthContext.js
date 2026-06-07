// Standalone stub for ../Context/AuthContext (req #2743).
// Aliased in by vite.standalone.js. No Cognito / login in the standalone
// bundle — a constant idToken + profile.id keep the TanStack Query `enabled`
// predicates true and the cache keys stable.
import { createContext } from 'react';

const AuthContext = createContext({
    idToken: 'standalone',
    profile: { id: 'standalone-user' },
});

export const AuthContextProvider = ({ children }) => children;
export default AuthContext;
