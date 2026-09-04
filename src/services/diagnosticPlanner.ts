import type { DiagnosticPlan } from '../types/obd';

export const ALLOWED_LIVE_PIDS = [
  '0104', '0105', '0106', '0107', '0108', '0109', '010B', '010C',
  '010D', '010E', '010F', '0110', '0111', '0133', '0142',
] as const;

const allowedPidSet = new Set<string>(ALLOWED_LIVE_PIDS);

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

export async function requestDiagnosticPlan(endpoint: string, request: PlanRequest): Promise<DiagnosticPlan> {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/v1/diagnostic-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Backend AI nie odpowiedział poprawnie (${response.status}).`);
  return sanitizePlan(await response.json());
}
