import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type {
  DiagnosticPlan, LiveDataBatch, ObdSample, ObdSession, PidStat, TestConditions, VehicleProfile,
} from '../types/obd';

const STORAGE_KEY = 'obd-ai-session-v1';
/** Przy 5 PID/s i 300 s planu to ponad dwukrotny zapas. */
const MAX_SAMPLES = 4000;
/** Ile punktów szeregu czasowego wysyłamy do AI. Reszta idzie w statystyki. */
const SERIES_POINTS = 120;

export const REFERENCE_VEHICLE: VehicleProfile = { make: 'Saab', model: '9-3', engine: 'B284 2.8T' };

export const DEFAULT_CONDITIONS: TestConditions = { engineWarm: true, testType: 'stationary', notes: '' };

function newId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && 'randomUUID' in cryptoApi) return cryptoApi.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createSession(plan: DiagnosticPlan, symptoms: string, conditions: TestConditions): ObdSession {
  return {
    schemaVersion: 1,
    sessionId: newId(),
    vehicle: REFERENCE_VEHICLE,
    symptoms,
    conditions,
    plan,
    startedAt: new Date().toISOString(),
    endedAt: null,
    samples: [],
    events: [],
  };
}

/** Zamienia paczkę Live Data na jedną próbkę odniesioną do startu sesji. */
export function appendBatch(session: ObdSession, batch: LiveDataBatch, startedAtMs: number): ObdSession {
  const values: Record<string, number> = {};
  for (const reading of batch.readings) {
    if (Number.isFinite(reading.value)) values[reading.pid] = reading.value;
  }
  if (Object.keys(values).length === 0) return session;
  const sample: ObdSample = { t: Math.max(0, Math.round(batch.timestamp - startedAtMs)), values };
  return { ...session, samples: [...session.samples.slice(-(MAX_SAMPLES - 1)), sample] };
}

export function appendEvent(session: ObdSession, kind: 'info' | 'error', text: string, startedAtMs: number): ObdSession {
  return { ...session, events: [...session.events.slice(-49), { t: Math.max(0, Math.round(Date.now() - startedAtMs)), kind, text }] };
}

export function finishSession(session: ObdSession): ObdSession {
  return { ...session, endedAt: session.endedAt ?? new Date().toISOString() };
}

export function sessionDurationSeconds(session: ObdSession): number {
  const last = session.samples[session.samples.length - 1];
  return last ? Math.round(last.t / 1000) : 0;
}

// ─── Statystyki i ładunek dla AI ────────────────────────────────────────────

export function computeStats(session: ObdSession, labels: Map<string, { label: string; unit: string }>): PidStat[] {
  const accumulator = new Map<string, { min: number; max: number; sum: number; count: number }>();
  for (const sample of session.samples) {
    for (const [pid, value] of Object.entries(sample.values)) {
      const current = accumulator.get(pid);
      if (!current) accumulator.set(pid, { min: value, max: value, sum: value, count: 1 });
      else {
        current.min = Math.min(current.min, value);
        current.max = Math.max(current.max, value);
        current.sum += value;
        current.count += 1;
      }
    }
  }
  return [...accumulator.entries()].map(([pid, item]) => ({
    pid,
    label: labels.get(pid)?.label ?? pid,
    unit: labels.get(pid)?.unit ?? '',
    min: Number(item.min.toFixed(2)),
    max: Number(item.max.toFixed(2)),
    avg: Number((item.sum / item.count).toFixed(2)),
    count: item.count,
  })).sort((a, b) => a.pid.localeCompare(b.pid));
}

/** Równomierne przerzedzenie szeregu, żeby ładunek do AI pozostał mały. */
function downsample(samples: ObdSample[], target = SERIES_POINTS): ObdSample[] {
  if (samples.length <= target) return samples;
  const step = samples.length / target;
  const result: ObdSample[] = [];
  for (let index = 0; index < target; index += 1) result.push(samples[Math.floor(index * step)]);
  return result;
}

export interface AiSessionPayload {
  schemaVersion: 1;
  sessionId: string;
  vehicle: VehicleProfile;
  symptoms: string;
  conditions: TestConditions;
  plan: { id: string; title: string; pids: string[]; durationSeconds: number };
  durationSeconds: number;
  sampleCount: number;
  summary: Record<string, Omit<PidStat, 'pid'>>;
  series: ObdSample[];
  events: ObdSession['events'];
}

export function buildAiPayload(session: ObdSession, stats: PidStat[]): AiSessionPayload {
  const summary: Record<string, Omit<PidStat, 'pid'>> = {};
  for (const { pid, ...rest } of stats) summary[pid] = rest;
  return {
    schemaVersion: 1,
    sessionId: session.sessionId,
    vehicle: session.vehicle,
    symptoms: session.symptoms,
    conditions: session.conditions,
    plan: { id: session.plan.id, title: session.plan.title, pids: session.plan.pids, durationSeconds: session.plan.durationSeconds },
    durationSeconds: sessionDurationSeconds(session),
    sampleCount: session.samples.length,
    summary,
    series: downsample(session.samples),
    events: session.events.slice(-20),
  };
}

// ─── Trwałość ───────────────────────────────────────────────────────────────

export function persistSession(session: ObdSession | null) {
  try {
    if (!session) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // brak miejsca w localStorage nie może przerwać pomiaru
  }
}

export function loadSession(): ObdSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ObdSession;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.samples)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Eksport ────────────────────────────────────────────────────────────────

export async function shareSessionJson(session: ObdSession, stats: PidStat[]): Promise<string> {
  const fileName = `obd-sesja-${session.startedAt.slice(0, 19).replace(/[:T]/g, '')}.json`;
  const content = JSON.stringify({ ...session, stats }, null, 2);

  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return fileName;
  }

  const written = await Filesystem.writeFile({ path: fileName, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: 'Sesja pomiarowa OBD', url: written.uri, dialogTitle: 'Udostępnij sesję' });
  return fileName;
}
