// Wspólna warstwa AI. Używana zarówno przez funkcje serverless w api/,
// jak i przez lokalny serwer deweloperski server/index.mjs.
import OpenAI from 'openai';

export const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
export const MOCK_MODE = process.env.AI_MOCK === 'true';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export const AI_CONFIGURED = Boolean(client);

export const PID_CATALOG = {
  '0104': 'calculated engine load', '0105': 'coolant temperature',
  '0106': 'short-term fuel trim bank 1', '0107': 'long-term fuel trim bank 1',
  '0108': 'short-term fuel trim bank 2', '0109': 'long-term fuel trim bank 2',
  '010B': 'intake manifold absolute pressure', '010C': 'engine RPM',
  '010D': 'vehicle speed', '010E': 'ignition timing advance',
  '010F': 'intake air temperature', '0110': 'mass air flow',
  '0111': 'throttle position', '0133': 'barometric pressure',
  '0142': 'control module voltage',
};
const allowedPids = new Set(Object.keys(PID_CATALOG));

// ─── Wspólne zasady dla każdego wywołania modelu ────────────────────────────
const SAFETY_RULES = [
  'Never recommend or describe ECU writing, coding, DTC clearing, actuator control,',
  'security access, raw CAN injection or flashing. This tool is read-only by design.',
  'Separate observations (what the data shows) from hypotheses (what may cause it).',
  'Never claim certainty without evidence in the supplied samples.',
  'If the data suggests an immediate safety risk, tell the user to stop driving.',
  'Answer in Polish, concisely, without marketing language.',
].join(' ');

// ─── Schematy odpowiedzi ────────────────────────────────────────────────────
export const planSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, reason: { type: 'string' },
    pids: { type: 'array', minItems: 2, maxItems: 15, items: { type: 'string', enum: [...allowedPids] } },
    durationSeconds: { type: 'integer', minimum: 15, maximum: 300 },
  },
  required: ['id', 'title', 'reason', 'pids', 'durationSeconds'],
};

export const diagnosisSchema = {
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

export const chatSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    answer: { type: 'string' },
    basedOnData: { type: 'boolean' },
    followUps: { type: 'array', maxItems: 3, items: { type: 'string' } },
  },
  required: ['answer', 'basedOnData', 'followUps'],
};

// ─── Wywołanie modelu ───────────────────────────────────────────────────────
async function structuredResponse({ name, schema, instructions, input }) {
  if (!client) throw new Error('Brak OPENAI_API_KEY na backendzie.');
  const response = await client.responses.create({
    model: MODEL,
    store: false,
    instructions,
    input: JSON.stringify(input),
    text: { format: { type: 'json_schema', name, strict: true, schema } },
  });
  if (!response.output_text) throw new Error('AI nie zwróciło odpowiedzi tekstowej.');
  return JSON.parse(response.output_text);
}

// ─── Plan pomiaru ───────────────────────────────────────────────────────────
function mockPlan(symptoms = '') {
  const text = String(symptoms).toLowerCase();
  if (/turbo|doładow|dolad|moc|obciąż|obciaz|przyspiesz/.test(text)) {
    return { id: 'mock-boost', title: 'Test pod obciążeniem', reason: 'Porównanie przepływu powietrza, ciśnienia w kolektorze i korekt paliwowych.', pids: ['010C', '0104', '010B', '0133', '0110', '0106', '0107', '0108', '0109', '0111'], durationSeconds: 90 };
  }
  if (/jałow|jalow|woln|nierówn|nierown|drga|szarp/.test(text)) {
    return { id: 'mock-idle', title: 'Test biegu jałowego', reason: 'Kontrola stabilności obrotów, dawki powietrza i różnicy korekt między bankami.', pids: ['010C', '010B', '0110', '0106', '0107', '0108', '0109', '0105', '010F'], durationSeconds: 60 };
  }
  return { id: 'mock-baseline', title: 'Pomiar bazowy', reason: 'Szeroki bezpieczny pomiar przed zawężeniem diagnostyki.', pids: [...allowedPids], durationSeconds: 60 };
}

function validatePlan(plan, availablePids) {
  const available = new Set(Array.isArray(availablePids) && availablePids.length > 0 ? availablePids : [...allowedPids]);
  const pids = [...new Set((Array.isArray(plan.pids) ? plan.pids : []).filter((pid) => allowedPids.has(pid) && available.has(pid)))];
  if (pids.length < 2) throw new Error('AI nie wybrało wystarczającej liczby bezpiecznych PID-ów.');
  return { ...plan, pids, durationSeconds: Math.min(300, Math.max(15, Number(plan.durationSeconds) || 60)) };
}

export async function handlePlan(body) {
  if (MOCK_MODE) return mockPlan(body?.symptoms);
  const plan = await structuredResponse({
    name: 'diagnostic_plan', schema: planSchema,
    instructions: `You plan read-only OBD-II data collection for the described vehicle. Select only PIDs from the provided catalog. Pick the smallest useful PID set for the reported symptom. Title and reason must be concise Polish. This is a measurement plan, not a diagnosis. ${SAFETY_RULES} Catalog: ${JSON.stringify(PID_CATALOG)}`,
    input: body,
  });
  return validatePlan(plan, body?.availablePids);
}

// ─── Analiza pomiaru ────────────────────────────────────────────────────────
function describeCoverage(body) {
  const stats = body?.summary && typeof body.summary === 'object' ? Object.keys(body.summary) : [];
  return { pids: stats.length, samples: Array.isArray(body?.series) ? body.series.length : 0 };
}

export async function handleDiagnosis(body) {
  if (MOCK_MODE) {
    const coverage = describeCoverage(body);
    return {
      summary: `Tryb demonstracyjny. Odebrano ${coverage.samples} próbek dla ${coverage.pids} parametrów — dane wyglądają na kompletne, ale bez klucza API nie ma prawdziwej analizy.`,
      confidence: 'low',
      findings: [`Sesja zawiera ${coverage.samples} próbek z ${coverage.pids} parametrów.`],
      likelyCauses: [],
      nextChecks: ['Ustaw OPENAI_API_KEY na backendzie, aby otrzymać rzeczywistą analizę.'],
      safetyNote: 'Nie wykonuj testów drogowych, patrząc na ekran telefonu.',
    };
  }
  return structuredResponse({
    name: 'obd_diagnosis', schema: diagnosisSchema,
    instructions: `You are an automotive diagnostic assistant analysing a completed read-only OBD-II measurement. The payload contains the vehicle profile, the reported symptom, test conditions, per-PID statistics (min, max, average, sample count) and a downsampled time series. Base every statement on those numbers and quote them. Prefer "brak danych" over speculation when a parameter is missing. ${SAFETY_RULES}`,
    input: body,
  });
}

// ─── Rozmowa o zebranych danych ─────────────────────────────────────────────
export async function handleChat(body) {
  const question = String(body?.question || '').slice(0, 2000);
  if (!question.trim()) throw new Error('Pytanie jest puste.');
  if (MOCK_MODE) {
    const coverage = describeCoverage(body);
    return {
      answer: `Tryb demonstracyjny — nie mam dostępu do modelu. Twoje pytanie: „${question}". W sesji jest ${coverage.samples} próbek dla ${coverage.pids} parametrów, więc backend z kluczem API miałby na czym pracować.`,
      basedOnData: false,
      followUps: ['Ustaw OPENAI_API_KEY na backendzie i zapytaj ponownie.'],
    };
  }
  return structuredResponse({
    name: 'obd_chat', schema: chatSchema,
    instructions: `You are discussing one completed read-only OBD-II measurement session with its owner. The payload has the vehicle, the symptom, per-PID statistics, a downsampled series, an earlier AI report if one exists, and the conversation so far. Answer the latest question using those numbers; cite concrete values and units. Set basedOnData to false when you answer from general automotive knowledge rather than from the session data, and say so in the answer. Suggest at most three short follow-up questions the user could ask. ${SAFETY_RULES}`,
    input: body,
  });
}

// ─── Wspólna obsługa HTTP dla funkcji serverless ────────────────────────────
export const MAX_BODY_BYTES = 512_000;

export function corsHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.OBD_ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Obd-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}

// Token jest wymagany tylko wtedy, gdy został skonfigurowany na serwerze.
// Dzięki temu tryb mock działa bez żadnej konfiguracji.
export function checkAccess(headers) {
  const expected = process.env.OBD_ACCESS_TOKEN;
  if (!expected) return null;
  const provided = headers?.['x-obd-token'] || headers?.['X-Obd-Token']
    || String(headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided !== expected) return 'Brak lub nieprawidłowy token dostępu.';
  return null;
}

export function statusForError(error) {
  const message = String(error?.message || error);
  if (message.includes('OPENAI_API_KEY')) return 503;
  if (message.includes('zbyt duże')) return 413;
  return 400;
}
