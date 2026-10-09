import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { buildRouter } from '../api/routes';
import { awsContext } from './aws-context';
import { userFromClaims } from './auth';

const router = buildRouter();

function json(status: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

/** HTTP API (payload v2) -> router. CORS is handled by API Gateway itself. */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const ctx = awsContext();
  let body: unknown;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'bad_json', message: 'Request body must be JSON' });
    }
  }
  const res = await router.handle(
    {
      method: event.requestContext.http.method,
      path: event.rawPath,
      query: event.queryStringParameters ?? {},
      body,
      user: userFromClaims(event.requestContext.authorizer?.jwt?.claims),
    },
    ctx,
  );
  return json(res.status, res.body);
}
