// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import { useCookies } from 'react-cookie';

const LogoutLink = () => {

    console.count('logout link called');
    // Logout Link provides a mechanism for HomePage to clear all authentication cookies
    // and logout via cognito

    // eslint-disable-next-line no-unused-vars
    const [cookies, setCookie, removeCookie] = useCookies(['profile', 'idToken', 'accessToken']);

    removeCookie('idToken', { path: '/', maxAge: ((24 * 3600) - 300), secure: true });
    removeCookie('accessToken', { path: '/', maxAge: ((24 * 3600) - 300), secure: true });
    removeCookie('profile', { path: '/', maxAge: ((24 * 3600) - 300), secure: true })

    window.location = `https://darwin2.auth.us-west-1.amazoncognito.com/logout?client_id=4qv8m44mllqllljbenbeou4uis&logout_uri=${import.meta.env.VITE_LOGOUT_REDIRECT}`; 
    return null;
}

export default LogoutLink;
