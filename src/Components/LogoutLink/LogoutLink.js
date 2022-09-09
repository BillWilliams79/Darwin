import varDump from '../../classifier/classifier';

import { useLocation } from "react-router-dom"
import cryptoRandomString from 'crypto-random-string';
import { useCookies } from 'react-cookie';

const LogoutLink = () => {

    console.count('logout link called');
    // Logout Link provides a mechanism for HomePage to clear all authentication cookies
    // and logout via cognito

    const [cookies, setCookie, removeCookie] = useCookies(['profile', 'idToken', 'accessToken']);

    removeCookie('idToken', { path: '/', maxAge: ((24 * 3600) - 300), secure: true });
    removeCookie('accessToken', { path: '/', maxAge: ((24 * 3600) - 300), secure: true });
    removeCookie('profile', { path: '/', maxAge: ((24 * 3600) - 300), secure: true })

    window.location = `https://darwin2.auth.us-west-1.amazoncognito.com/logout?client_id=4qv8m44mllqllljbenbeou4uis&logout_uri=${process.env.REACT_APP_LOGOUT_REDIRECT}`; 
    return null;
}

export default LogoutLink;
