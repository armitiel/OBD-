// Lokalny serwer deweloperski. Na produkcji te same funkcje obsługuje Vercel
// przez katalog api/ — logika żyje w api/_lib/ai.mjs i nie jest duplikowana.
import http from 'node:http';
import {
  AI_CONFIGURED, MAX_BODY_BYTES, MOCK_MODE, MODEL,
  checkAccess, corsHeaders, handleChat, handleDiagnosis, handlePlan, statusForError,
} from '../api/_lib/ai.mjs';

const port = Number(process.env.PORT || 8787);

function sendJson(response, status, value) {
  response.writeHead(status, corsHeaders());
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Żądanie jest zbyt duże.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Akceptujemy zarówno /v1/... jak i /api/v1/..., żeby ten sam adres backendu
// działał lokalnie i na Vercelu.
function normalize(url) {
  return String(url || '').split('?')[0].replace(/^\/api(?=\/)/, '').replace(/\/$/, '') || '/';
}

const routes = {
  '/v1/diagnostic-plan': handlePlan,
  '/v1/diagnosis': handleDiagnosis,
  '/v1/chat': handleChat,
};

const server = http.createServer(async (request, response) => {
  const path = normalize(request.url);
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});

  const denied = checkAccess(request.headers);
  if (denied) return sendJson(response, 401, { error: denied });

  if (request.method === 'GET' && (path === '/health' || path === '/')) {
    return sendJson(response, 200, {
      ok: true, aiConfigured: AI_CONFIGURED, mockMode: MOCK_MODE, model: MODEL,
      endpoints: Object.keys(routes),
    });
  }

  try {
    const route = routes[path];
    if (request.method === 'POST' && route) return sendJson(response, 200, await route(await readJson(request)));
    return sendJson(response, 404, { error: 'Nie znaleziono endpointu.' });
  } catch (error) {
    return sendJson(response, statusForError(error), { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`OBD AI backend: http://0.0.0.0:${port} · model=${MODEL} · mock=${MOCK_MODE} · ai=${AI_CONFIGURED}`);
});
