// Centralized Cognito auth configuration.
//
// The clientId below is the PUBLIC app client (no secret). It was created for the browser PKCE
// flow, but since 2026-03-14 the browser uses it for USER_SRP_AUTH via the custom /login form
// (`services/cognitoAuth.js`). Its OAuth authorization-code config and `/loggedin/` callback URLs
// survive because the Hosted UI is still reached by the login page's "Forgot password?" link.
//
// The old client (4qv8m44mllqllljbenbeou4uis) with a secret is used by the E2E suite
// (USER_PASSWORD_AUTH) and, since req #3050, by the darwin-mcp daemon.
//
// The user pool lives in us-west-1. Req #3291 dropped three fields that lost their last consumer
// when the Hosted-UI URL builders were deleted: `region` (already unread before that), `scopes`
// (read only by buildLoginUrl/buildSignupUrl) and `redirectSignOut` (read only by buildLogoutUrl).
// The VITE_LOGOUT_REDIRECT env var behind that last one is still exported by the deploy scripts —
// it is simply no longer read by any app code.

export const AUTH_CONFIG = {
    userPoolId: 'us-west-1_jqN0WLASK',
    clientId: '8s82usrcfe58mllbceiavfcd2',
    domain: 'darwin2.auth.us-west-1.amazoncognito.com',
    redirectSignIn: import.meta.env.VITE_LOGIN_REDIRECT,
};
