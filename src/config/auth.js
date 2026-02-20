// Centralized Cognito auth configuration.
// The clientId below is the PUBLIC app client (no secret) created for browser PKCE flow.
// The old client (4qv8m44mllqllljbenbeou4uis) with a secret is retained for E2E tests.

export const AUTH_CONFIG = {
    region: 'us-west-1',
    userPoolId: 'us-west-1_jqN0WLASK',
    clientId: '8s82usrcfe58mllbceiavfcd2', // Replace after creating public app client in Cognito Console
    domain: 'darwin2.auth.us-west-1.amazoncognito.com',
    scopes: ['email', 'openid'],
    redirectSignIn: `${window.location.origin}/loggedin/`,
    redirectSignOut: `${window.location.origin}/`,
};
