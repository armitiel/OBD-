import type { ChatAnswer, ChatMessage, DiagnosisReport, DiagnosticPlan } from '../types/obd';
import type { AiSessionPayload } from './sessionRecorder';

export const ALLOWED_LIVE_PIDS = [
  '0104', '0105', '0106', '0107', '0108', '0109', '010B', '010C',
  '010D', '010E', '010F', '0110', '0111', '0133', '0142',
] as const;

const allowedPidSet = new Set<string>(ALLOWED_LIVE_PIDS);

export const DEFAULT_BACKEND_URL = 'https://obd-murex.vercel.app/api';

export const BASELINE_DIAGNOSTIC_PLAN: DiagnosticPlan = {
  id: 'baseline',
  title: 'Pomiar bazowy',
  reason: 'Podstawowy obraz pracy silnika i zasilania.',
  pids: [...ALLOWED_LIVE_PIDS],
  durationSeconds: 60,
};

interface PlanRequest {
  vehicle: { make: string; model: string; engine: string };
  symptoms: string;
  availablePids: string[];
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}

async function postJson<T>(endpoint: string, path: string, body: unknown, token: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Obd-Token'] = token;

  const response = await fetch(`${normalizeEndpoint(endpoint)}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* odpowiedź nie jest JSON-em */ }

  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error;
    throw new Error(message || `Backend AI odpowiedział błędem ${response.status}.`);
  }
  if (!payload) throw new Error('Backend AI zwrócił pustą odpowiedź.');
  return payload as T;
}

// ─── Plan pomiaru ───────────────────────────────────────────────────────────

function sanitizePlan(value: unknown): DiagnosticPlan {
  if (!value || typeof value !== 'object') throw new Error('Backend AI zwrócił nieprawidłowy plan testu.');
  const candidate = value as Partial<DiagnosticPlan>;
  const pids = Array.isArray(candidate.pids)
    ? [...new Set(candidate.pids.filter((pid): pid is string => typeof pid === 'string' && allowedPidSet.has(pid)))]
    : [];
  if (pids.length === 0) throw new Error('Plan AI nie zawiera żadnych dozwolonych PID-ów.');
  return {
    id: typeof candidate.id === 'string' ? candidate.id : `ai-${Date.now()}`,
    title: typeof candidate.title === 'string' ? candidate.title : 'Test dobrany przez AI',
    reason: typeof candidate.reason === 'string' ? candidate.reason : '',
    pids,
    durationSeconds: Math.min(300, Math.max(15, Number(candidate.durationSeconds) || 60)),
  };
}

export async function requestDiagnosticPlan(endpoint: string, request: PlanRequest, token = ''): Promise<DiagnosticPlan> {
  return sanitizePlan(await postJson(endpoint, '/v1/diagnostic-plan', request, token));
}

// ─── Analiza zakończonego pomiaru ───────────────────────────────────────────

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function sanitizeDiagnosis(value: unknown): DiagnosisReport {
  if (!value || typeof value !== 'object') throw new Error('Backend AI zwrócił nieprawidłowy raport.');
  const candidate = value as Partial<DiagnosisReport>;
  if (typeof candidate.summary !== 'string' || candidate.summary.trim().length === 0) {
    throw new Error('Raport AI nie zawiera podsumowania.');
  }
  const confidence = candidate.confidence === 'high' || candidate.confidence === 'medium' ? candidate.confidence : 'low';
  return {
    summary: candidate.summary,
    confidence,
    findings: asStringArray(candidate.findings),
    likelyCauses: asStringArray(candidate.likelyCauses),
    nextChecks: asStringArray(candidate.nextChecks),
    safetyNote: typeof candidate.safetyNote === 'string' ? candidate.safetyNote : '',
  };
}

export async function requestDiagnosis(endpoint: string, payload: AiSessionPayload, token = ''): Promise<DiagnosisReport> {
  return sanitizeDiagnosis(await postJson(endpoint, '/v1/diagnosis', payload, token));
}

// ─── Rozmowa o danych ───────────────────────────────────────────────────────

function sanitizeChat(value: unknown): ChatAnswer {
  if (!value || typeof value !== 'object') throw new Error('Backend AI zwrócił nieprawidłową odpowiedź.');
  const candidate = value as Partial<ChatAnswer>;
  if (typeof candidate.answer !== 'string' || candidate.answer.trim().length === 0) {
    throw new Error('AI nie zwróciło treści odpowiedzi.');
  }
  return {
    answer: candidate.answer,
    basedOnData: candidate.basedOnData === true,
    followUps: asStringArray(candidate.followUps).slice(0, 3),
  };
}

export async function requestChat(
  endpoint: string,
  payload: AiSessionPayload,
  report: DiagnosisReport | null,
  history: ChatMessage[],
  question: string,
  token = '',
): Promise<ChatAnswer> {
  const body = {
    ...payload,
    report,
    history: history.slice(-12).map(({ role, content }) => ({ role, content })),
    question,
  };
  return sanitizeChat(await postJson(endpoint, '/v1/chat', body, token));
}

// ─── Diagnostyka konfiguracji ───────────────────────────────────────────────

export interface BackendHealth {
  ok: boolean;
  aiConfigured: boolean;
  mockMode: boolean;
  model: string;
}

export async function checkBackend(endpoint: string, token = ''): Promise<BackendHealth> {
  const headers: Record<string, string> = {};
  if (token) headers['X-Obd-Token'] = token;
  const response = await fetch(`${normalizeEndpoint(endpoint)}/health`, { headers });
  if (!response.ok) throw new Error(`Backend odpowiedział błędem ${response.status}.`);
  return await response.json() as BackendHealth;
}
