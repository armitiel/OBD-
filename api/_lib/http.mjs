// Wspólna obsługa żądań dla funkcji serverless Vercela.
import { checkAccess, corsHeaders, MAX_BODY_BYTES, statusForError } from './ai.mjs';

function applyHeaders(res) {
  for (const [key, value] of Object.entries(corsHeaders())) res.setHeader(key, value);
}

export function send(res, status, value) {
  applyHeaders(res);
  res.status(status).send(JSON.stringify(value));
}

// Vercel parsuje JSON sam, ale przy braku nagłówka trzeba przeczytać strumień.
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Żądanie jest zbyt duże.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function withHandler(work, { method = 'POST' } = {}) {
  return async function handler(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method !== method) return send(res, 405, { error: 'Nieobsługiwana metoda.' });
    const denied = checkAccess(req.headers);
    if (denied) return send(res, 401, { error: denied });
    try {
      const body = method === 'POST' ? await readBody(req) : {};
      return send(res, 200, await work(body, req));
    } catch (error) {
      return send(res, statusForError(error), { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
