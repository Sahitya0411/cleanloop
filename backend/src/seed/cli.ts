// Shared helpers for the command-line scripts that talk to a deployed stack.
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import { randomBytes } from 'node:crypto';
import type { Role } from '@cleanloop/shared';
import { DynamoKv } from '../data/dynamo-kv';
import { Repo } from '../data/repo';
import { AwsNotifier } from '../services/aws-notifier';
import { AmazonLocationPlanner } from '../services/location-planner';
import { MockAi } from '../services/mock-ai';
import { jsonLogger, memoryMetrics } from '../services/observability';
import { OpenMeteoWeather } from '../services/open-meteo';
import { S3Storage } from '../services/s3-storage';
import type { AppContext } from '../services/types';

export interface StackOutputs {
  Region: string;
  ApiUrl: string;
  AppUrl: string;
  AmplifyAppId: string;
  UserPoolId: string;
  UserPoolClientId: string;
  TableName: string;
  PhotosBucketName: string;
  LaneTopicArn: string;
  MapsApiKeyName: string;
  OfficerEmail: string;
  DashboardUrl: string;
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

export async function stackOutputs(stackName: string): Promise<StackOutputs> {
  const cfn = new CloudFormationClient({});
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = res.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(
    outputs.map((o) => [o.OutputKey, o.OutputValue ?? '']),
  ) as unknown as StackOutputs;
}

/** A context wired to the deployed resources (no AI needed for seeding). */
export function scriptContext(out: StackOutputs, senderEmail?: string): AppContext {
  const log = jsonLogger({ stage: 'script' });
  return {
    repo: new Repo(new DynamoKv(out.TableName)),
    storage: new S3Storage(new S3Client({}), out.PhotosBucketName),
    ai: new MockAi(),
    notifier: new AwsNotifier(
      new SNSClient({}),
      new SESv2Client({}),
      out.LaneTopicArn,
      senderEmail,
      log,
    ),
    planner: new AmazonLocationPlanner(new GeoRoutesClient({}), log),
    weather: new OpenMeteoWeather(log),
    metrics: memoryMetrics(),
    log,
    config: {
      stage: 'script',
      appUrl: out.AppUrl,
      region: out.Region,
      kmPerLitre: 3,
      demoTools: true,
    },
    now: () => new Date(),
  };
}

/** Meets the pool policy (8+ chars, lowercase, number) with plenty of entropy. */
export function generatePassword(): string {
  return `Loop-${randomBytes(9).toString('base64url')}-7k`;
}

/** Creates (or updates) a confirmed user with a permanent password, in one group. */
export async function ensureUser(
  userPoolId: string,
  input: { email: string; name: string; role: Role; password: string },
): Promise<string> {
  const cognito = new CognitoIdentityProviderClient({});
  const email = input.email.toLowerCase();
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: input.name },
          { Name: 'custom:role', Value: input.role },
        ],
      }),
    );
  } catch (err) {
    if (!(err instanceof UsernameExistsException)) throw err;
  }
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: input.password,
      Permanent: true,
    }),
  );
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: input.role,
    }),
  );
  const user = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
  );
  const sub = user.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) throw new Error(`No sub for ${email}`);
  return sub;
}
