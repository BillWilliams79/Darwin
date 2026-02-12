import crypto from 'node:crypto';

const COGNITO_REGION = 'us-west-1';
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
const DARWIN_API = 'https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin';

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

function computeSecretHash(username: string, clientId: string, clientSecret: string): string {
  return crypto.createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
}

export async function getAuthTokens(): Promise<AuthTokens> {
  const username = process.env.E2E_TEST_USERNAME;
  const password = process.env.E2E_TEST_PASSWORD;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const clientSecret = process.env.COGNITO_CLIENT_SECRET;

  if (!username || !password || !clientId || !clientSecret) {
    throw new Error(
      'Missing E2E credentials. Set E2E_TEST_USERNAME, E2E_TEST_PASSWORD, ' +
      'COGNITO_CLIENT_ID, and COGNITO_CLIENT_SECRET environment variables.'
    );
  }

  const secretHash = computeSecretHash(username, clientId, clientSecret);

  const res = await fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
        SECRET_HASH: secretHash,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cognito InitiateAuth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    idToken: data.AuthenticationResult.IdToken,
    accessToken: data.AuthenticationResult.AccessToken,
    refreshToken: data.AuthenticationResult.RefreshToken,
  };
}

/**
 * Build a profile object from the JWT token claims.
 * Avoids calling the profile API (which returns double-encoded JSON).
 * AuthenticatedRoute only needs profile.userName; API calls use profile.userName as creator_fk.
 */
export function buildProfileFromToken(idToken: string): Record<string, unknown> {
  const payload = JSON.parse(
    Buffer.from(idToken.split('.')[1], 'base64url').toString()
  );
  return {
    userName: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}
