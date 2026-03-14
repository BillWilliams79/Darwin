// cognitoAuth.js — Thin wrapper around amazon-cognito-identity-js for SRP-based auth.
// Exposes: signIn, signUp, confirmSignUp, resendVerification.
// Tokens are returned to the caller; never stored here.

import {
    CognitoUserPool,
    CognitoUser,
    AuthenticationDetails,
    CognitoUserAttribute,
} from 'amazon-cognito-identity-js';
import { AUTH_CONFIG } from '../config/auth';

const userPool = new CognitoUserPool({
    UserPoolId: AUTH_CONFIG.userPoolId,
    ClientId: AUTH_CONFIG.clientId,
});

/**
 * Sign in with email + password via USER_SRP_AUTH.
 * @returns {{ idToken, accessToken, refreshToken, expiresIn }}
 */
export function signIn(email, password) {
    return new Promise((resolve, reject) => {
        const authDetails = new AuthenticationDetails({
            Username: email,
            Password: password,
        });

        const cognitoUser = new CognitoUser({
            Username: email,
            Pool: userPool,
        });

        cognitoUser.authenticateUser(authDetails, {
            onSuccess: (session) => {
                resolve({
                    idToken: session.getIdToken().getJwtToken(),
                    accessToken: session.getAccessToken().getJwtToken(),
                    refreshToken: session.getRefreshToken().getToken(),
                    expiresIn: session.getIdToken().getExpiration() - Math.floor(Date.now() / 1000),
                });
            },
            onFailure: (err) => {
                reject(err);
            },
        });
    });
}

/**
 * Register a new user with email + password.
 * Triggers the Cognito verification email.
 */
export function signUp(email, password) {
    return new Promise((resolve, reject) => {
        const emailAttr = new CognitoUserAttribute({ Name: 'email', Value: email });
        userPool.signUp(email, password, [emailAttr], null, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

/**
 * Confirm signup with the 6-digit verification code sent to the user's email.
 * PostConfirmation Lambda fires after this succeeds.
 */
export function confirmSignUp(email, code) {
    return new Promise((resolve, reject) => {
        const cognitoUser = new CognitoUser({
            Username: email,
            Pool: userPool,
        });

        cognitoUser.confirmRegistration(code, true, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

/**
 * Resend the verification code to the user's email.
 */
export function resendVerification(email) {
    return new Promise((resolve, reject) => {
        const cognitoUser = new CognitoUser({
            Username: email,
            Pool: userPool,
        });

        cognitoUser.resendConfirmationCode((err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}
