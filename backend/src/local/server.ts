import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildRouter } from '../api/routes';
import { MAX_UPLOAD_BYTES } from '../services/s3-storage';
import { jsonLogger } from '../services/observability';
import { userFromLocalToken } from './auth';
import { createLocalRuntime, localAi, localWeather, seedLocal } from './context';

const PORT = Number(process.env.PORT ?? 8787);
const BASE_URL = process.env.LOCAL_BASE_URL ?? `http://localhost:${PORT}`;

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body?: unknown, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  if (body === undefined) res.end();
  else if (Buffer.isBuffer(body) || body instanceof Uint8Array) res.end(body);
  else res.end(JSON.stringify(body));
}

async function main() {
  const log = jsonLogger({ stage: 'local' });
  const runtime = createLocalRuntime({
    baseUrl: BASE_URL,
    ai: localAi(log),
    weather: localWeather(log),
    log,
  });
  await seedLocal(runtime);
  const router = buildRouter();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', BASE_URL);
    try {
      if (req.method === 'OPTIONS') return send(res, 204);

      // Stand-in for the S3 presigned POST.
      if (req.method === 'POST' && url.pathname === '/local-upload') {
        const body = await readBody(req, MAX_UPLOAD_BYTES + 64 * 1024);
        const form = await new Request(url, {
          method: 'POST',
          headers: { 'content-type': req.headers['content-type'] ?? '' },
          body,
        }).formData();
        const key = String(form.get('key') ?? '');
        const file = form.get('file');
        if (!key.startsWith('uploads/') || !(file instanceof Blob)) {
          return send(res, 400, { error: 'bad_upload', message: 'key and file are required' });
        }
        const type = String(form.get('Content-Type') ?? file.type ?? 'image/jpeg');
        await runtime.storage.write(key, new Uint8Array(await file.arrayBuffer()), type);
        return send(res, 204);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/local-files/')) {
        const key = decodeURIComponent(url.pathname.slice('/local-files/'.length));
        const file = runtime.storage.files.get(key);
        if (!file) return send(res, 404, { error: 'not_found', message: 'No such file' });
        return send(res, 200, file.bytes, file.contentType);
      }
      if (req.method === 'GET' && url.pathname === '/local/outbox') {
        return send(res, 200, runtime.notifier.outbox.slice(-100).reverse());
      }

      const raw = await readBody(req, 1024 * 1024);
      let body: unknown;
      if (raw.length) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          return send(res, 400, { error: 'bad_json', message: 'Request body must be JSON' });
        }
      }
      const result = await router.handle(
        {
          method: req.method ?? 'GET',
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body,
          user: userFromLocalToken(req.headers.authorization),
        },
        runtime.ctx,
      );
      return send(res, result.status, result.body);
    } catch (err) {
      log.error('local server error', { error: String(err) });
      return send(res, 500, { error: 'internal', message: String(err) });
    }
  });

  server.listen(PORT, () => {
    log.info(`CleanLoop local API on ${BASE_URL} (AI: ${process.env.LOCAL_AI ?? 'mock'})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
