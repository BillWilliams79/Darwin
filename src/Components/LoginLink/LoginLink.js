import varDump from '../../classifier/classifier';

import { useLocation } from "react-router-dom"
import cryptoRandomString from 'crypto-random-string';
import { useCookies } from 'react-cookie';

const LoginLink = () => {

    // Login Link provides a mechanism for AuthenticatedRoute to call the AWS login handler
    // and then return to the original page. While React-Router provides state this state only 
    // works if the app never leaves your domain or is reset (e.g. useState). So have to store
    // the return link in browser storage such as cookie (for now). Cookie data picked up in loggedin

    const [cookies, setCookie] = useCookies(['csrfToken']);
    const location = useLocation();

    // retrieve stored pathname from location state or default to /
    const redirectPath = location?.state?.from.pathname || "/";
    setCookie('redirectPath', redirectPath, {path: '/', maxAge: 600});

    var csrf = cryptoRandomString({length: 64, type: 'alphanumeric'});
    setCookie('csrfToken', csrf, { path: '/', maxAge: 3600 });
    window.location = `https://darwin2.auth.us-west-1.amazoncognito.com/login?response_type=token&state=${csrf}&client_id=4qv8m44mllqllljbenbeou4uis&scope=aws.cognito.signin.user.admin+email+openid&redirect_uri=${process.env.REACT_APP_LOGIN_REDIRECT}`; 
    return null;
}

export default LoginLink;
