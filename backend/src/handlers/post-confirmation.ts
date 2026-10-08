import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';

const client = new CognitoIdentityProviderClient({});

/** Residents and recyclers sign themselves up; drivers and officers are created by an admin. */
export const SELF_SERVICE_ROLES = ['resident', 'recycler'] as const;

export function groupFor(requested: string | undefined): string {
  return (SELF_SERVICE_ROLES as readonly string[]).includes(requested ?? '')
    ? requested!
    : 'resident';
}

export async function handler(event: PostConfirmationTriggerEvent) {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;
  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: event.userPoolId,
      Username: event.userName,
      GroupName: groupFor(event.request.userAttributes['custom:role']),
    }),
  );
  return event;
}
