import http from 'node:http';
import OpenAI from 'openai';

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const mockMode = process.env.AI_MOCK === 'true';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const pidCatalog = {
  '0104': 'calculated engine load', '0105': 'coolant temperature',
  '0106': 'short-term fuel trim bank 1', '0107': 'long-term fuel trim bank 1',
  '0108': 'short-term fuel trim bank 2', '0109': 'long-term fuel trim bank 2',
  '010B': 'intake manifold absolute pressure', '010C': 'engine RPM',
  '010D': 'vehicle speed', '010E': 'ignition timing advance',
  '010F': 'intake air temperature', '0110': 'mass air flow',
  '0111': 'throttle position', '0133': 'barometric pressure',
  '0142': 'control module voltage',
};
const allowedPids = new Set(Object.keys(pidCatalog));

const planSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, reason: { type: 'string' },
    pids: { type: 'array', minItems: 2, maxItems: 15, items: { type: 'string', enum: [...allowedPids] } },
    durationSeconds: { type: 'integer', minimum: 15, maximum: 300 },
  },
  required: ['id', 'title', 'reason', 'pids', 'durationSeconds'],
};

const diagnosisSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    findings: { type: 'array', items: { type: 'string' } },
    likelyCauses: { type: 'array', items: { type: 'string' } },
    nextChecks: { type: 'array', items: { type: 'string' } },
    safetyNote: { type: 'string' },
  },
  required: ['summary', 'confidence', 'findings', 'likelyCauses', 'nextChecks', 'safetyNote'],
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512_000) throw new Error('Żądanie jest zbyt duże.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function mockPlan(symptoms = '') {
  const text = symptoms.toLowerCase();
  if (/turbo|doładow|moc|obciąż|przyspiesz/.test(text)) {
    return { id: 'mock-boost', title: 'Test pod obciążeniem', reason: 'Porównanie przepływu powietrza, ciśnienia w kolektorze i korekt paliwowych.', pids: ['010C', '0104', '010B', '0133', '0110', '0106', '0107', '0108', '0109', '0111'], durationSeconds: 90 };
  }
  if (/jałow|woln|nierówn|drga|szarp/.test(text)) {
    return { id: 'mock-idle', title: 'Test biegu jałowego', reason: 'Kontrola stabilności obrotów, dawki powietrza i różnicy korekt między bankami.', pids: ['010C', '010B', '0110', '0106', '0107', '0108', '0109', '0105', '010F'], durationSeconds: 60 };
  }
  return { id: 'mock-baseline', title: 'Pomiar bazowy', reason: 'Szeroki bezpieczny pomiar przed zawężeniem diagnostyki.', pids: [...allowedPids], durationSeconds: 60 };
}

function validatePlan(plan, availablePids) {
  const available = new Set(Array.isArray(availablePids) ? availablePids : [...allowedPids]);
  const pids = [...new Set((Array.isArray(plan.pids) ? plan.pids : []).filter((pid) => allowedPids.has(pid) && available.has(pid)))];
  if (pids.length < 2) throw new Error('AI nie wybrało wystarczającej liczby bezpiecznych PID-ów.');
  return { ...plan, pids, durationSeconds: Math.min(300, Math.max(15, Number(plan.durationSeconds) || 60)) };
}

async function structuredResponse({ name, schema, instructions, input }) {
  if (!client) throw new Error('Brak OPENAI_API_KEY na backendzie.');
  const response = await client.responses.create({
    model,
    store: false,
    instructions,
    input: JSON.stringify(input),
    text: { format: { type: 'json_schema', name, strict: true, schema } },
  });
  if (!response.output_text) throw new Error('AI nie zwróciło odpowiedzi tekstowej.');
  return JSON.parse(response.output_text);
}

async function handlePlan(body) {
  if (mockMode) return mockPlan(body.symptoms);
  const plan = await structuredResponse({
    name: 'diagnostic_plan', schema: planSchema,
    instructions: `You plan read-only OBD-II data collection for a Saab 9-3 B284 2.8T. Select only PIDs from the provided catalog. Never propose write, clear-DTC, actuator, coding, security-access, CAN injection, or ECU flashing commands. Pick the smallest useful PID set. The reason and title must be concise Polish. This is a measurement plan, not a definitive diagnosis. Catalog: ${JSON.stringify(pidCatalog)}`,
    input: body,
  });
  return validatePlan(plan, body.availablePids);
}

async function handleDiagnosis(body) {
  if (mockMode) return { summary: 'Tryb demonstracyjny — zebrane dane wymagają analizy przez właściwy model AI.', confidence: 'low', findings: [], likelyCauses: [], nextChecks: ['Uruchom backend z kluczem OpenAI API.'], safetyNote: 'Nie wykonuj testów drogowych, patrząc na ekran telefonu.' };
  return structuredResponse({
    name: 'obd_diagnosis', schema: diagnosisSchema,
    instructions: 'You are an automotive diagnostic assistant. Analyze only the supplied vehicle context and OBD measurements. Answer in Polish. Clearly separate observations from hypotheses, never claim certainty without evidence, and recommend safe read-only follow-up checks. Never recommend ECU writing, coding, DTC clearing, actuator control, security access, CAN injection, or flashing. Tell the user to stop driving if the data indicates an immediate safety risk.',
    input: body,
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { ok: true, aiConfigured: Boolean(client), mockMode, model });
  try {
    if (request.method === 'POST' && request.url === '/v1/diagnostic-plan') return sendJson(response, 200, await handlePlan(await readJson(request)));
    if (request.method === 'POST' && request.url === '/v1/diagnosis') return sendJson(response, 200, await handleDiagnosis(await readJson(request)));
    return sendJson(response, 404, { error: 'Nie znaleziono endpointu.' });
  } catch (error) {
    const configurationError = String(error?.message || error).includes('OPENAI_API_KEY');
    return sendJson(response, configurationError ? 503 : 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`OBD AI backend: http://0.0.0.0:${port} · model=${model} · mock=${mockMode}`);
});
