// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import { useCookies } from 'react-cookie';
import { buildLogoutUrl } from '../../services/authService';

const LogoutLink = () => {

    console.count('logout link called');
    // Logout Link clears the refresh token cookie and redirects to Cognito logout.
    // Access/ID tokens are in memory (React state) and will be lost on navigation.

    // eslint-disable-next-line no-unused-vars
    const [cookies, setCookie, removeCookie] = useCookies(['refreshToken', 'idToken', 'accessToken', 'profile']);

    removeCookie('refreshToken', { path: '/', secure: true, sameSite: 'strict' });
    // Clear legacy cookies (E2E tests and transition period)
    removeCookie('idToken', { path: '/' });
    removeCookie('accessToken', { path: '/' });
    removeCookie('profile', { path: '/' });

    window.location = buildLogoutUrl();
    return null;
}

export default LogoutLink;
