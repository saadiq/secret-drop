import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_UPLOAD_BYTES,
  bytesToB64,
  computeVerifier,
  normalizePassphrase,
  randomSalt,
} from './public/drop-crypto.js';

export interface ServerOptions {
  pass: string;
  port?: number;
  uploadsDir?: string;
}

export async function createServer(opts: ServerOptions) {
  const pass = normalizePassphrase(opts.pass);
  const uploadsDir = opts.uploadsDir ?? 'uploads';
  mkdirSync(uploadsDir, { recursive: true });

  const verifierSalt = bytesToB64(randomSalt());
  const verifierHash = await computeVerifier(pass, verifierSalt);
  const template = await Bun.file(new URL('./public/index.html', import.meta.url)).text();
  const page = template
    .replace('__VERIFIER_SALT__', verifierSalt)
    .replace('__VERIFIER_HASH__', verifierHash);

  return Bun.serve({
    hostname: '127.0.0.1',
    port: opts.port ?? 8787,
    // Content-Length check returns 413 first; body is drained before responding to preserve keep-alive.
    // This is the hard backstop (2× cap) if Content-Length is absent or invalid.
    maxRequestBodySize: MAX_UPLOAD_BYTES * 2,
    async fetch(req) {
      const path = new URL(req.url).pathname;

      if (req.method === 'GET' && path === '/') {
        return new Response(page, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
      }

      if (req.method === 'GET' && path === '/drop-crypto.js') {
        return new Response(Bun.file(new URL('./public/drop-crypto.js', import.meta.url)), {
          headers: { 'cache-control': 'no-store' },
        });
      }

      if (req.method === 'POST' && path === '/upload') {
        const length = Number(req.headers.get('content-length') ?? '0');
        if (length > MAX_UPLOAD_BYTES) {
          // Drain the request body to prevent connection issues
          try {
            await req.text();
          } catch {
            // Ignore body read errors
          }
          return json(413, { error: 'That file is too large (limit 2 MB).' });
        }
        let payload: { salt?: unknown; iv?: unknown; data?: unknown };
        try {
          const text = await req.text();
          payload = JSON.parse(text);
        } catch {
          return json(400, { error: 'Could not read the upload. Please try again.' });
        }
        if (
          payload === null ||
          typeof payload !== 'object' ||
          typeof payload.salt !== 'string' ||
          typeof payload.iv !== 'string' ||
          typeof payload.data !== 'string'
        ) {
          return json(400, { error: 'Could not read the upload. Please try again.' });
        }
        const stamp = new Date().toISOString().replaceAll(':', '-');
        const dest = join(uploadsDir, `upload-${stamp}.enc`);
        const body = JSON.stringify(payload);
        await Bun.write(dest, body);
        console.log(`[${new Date().toISOString()}] saved ${dest} (${body.length} bytes)`);
        return json(200, { ok: true });
      }

      return json(404, { error: 'Not found' });
    },
  });
}

function json(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

if (import.meta.main) {
  const pass = process.env.PASS;
  if (!pass) {
    console.error('PASS is required, e.g.: PASS="plum-otter-band-echo" bun server.ts');
    process.exit(1);
  }
  const server = await createServer({ pass });
  console.log(`secret-drop listening on http://${server.hostname}:${server.port}`);
}
