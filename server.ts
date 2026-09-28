import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_UPLOAD_BYTES, isPayload } from './public/drop-crypto.js';
import { loadKeyPair } from './keys.ts';

export interface ServerOptions {
  keysDir?: string;
  port?: number;
  uploadsDir?: string;
}

export async function createServer(opts: ServerOptions = {}) {
  // Both halves are required, not just the public one: serving a page whose
  // uploads nobody can decrypt is worse than not serving at all.
  const { publicJwk } = await loadKeyPair(opts.keysDir);
  const uploadsDir = opts.uploadsDir ?? 'uploads';
  mkdirSync(uploadsDir, { recursive: true });

  const [template, cryptoModule] = await Promise.all([
    Bun.file(new URL('./public/index.html', import.meta.url)).text(),
    Bun.file(new URL('./public/drop-crypto.js', import.meta.url)).text(),
  ]);
  const page = template
    // Function replacer: the module source must land verbatim ($ is special in
    // string replacements). Its `export` keywords are legal as-is in an inline
    // module script, so no rewriting is needed.
    .replace('// __DROP_CRYPTO_INLINE__', () => cryptoModule)
    .replace('__PUBLIC_KEY_JWK__', () => JSON.stringify(publicJwk));

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
        let payload: unknown;
        try {
          payload = JSON.parse(await req.text());
        } catch {}
        if (!isPayload(payload)) {
          return json(400, { error: 'Could not read the upload. Please try again.' });
        }
        const now = new Date().toISOString();
        const dest = join(uploadsDir, `upload-${now.replaceAll(':', '-')}.enc`);
        const body = JSON.stringify(payload);
        await Bun.write(dest, body);
        console.log(`[${now}] saved ${dest} (${body.length} bytes)`);
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
  const server = await createServer().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
  console.log(`secret-drop listening on http://${server.hostname}:${server.port}`);
}
