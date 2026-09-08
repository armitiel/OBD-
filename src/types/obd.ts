export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'ready' | 'error';

export interface BluetoothDevice {
  name: string;
  address: string;
}

export interface TerminalLine {
  id: number;
  direction: 'tx' | 'rx' | 'info' | 'error';
  text: string;
  timestamp: Date;
}

export interface PidReading {
  pid: string;
  label: string;
  value: string;
  raw: string;
}

export interface ObdSnapshot {
  protocol: string;
  ecuConnected: boolean;
  readings: PidReading[];
}

export interface LiveReading {
  pid: string;
  label: string;
  value: number;
  unit: string;
  formatted: string;
  raw: string;
}

export interface LiveDataBatch {
  timestamp: number;
  durationMs: number;
  supportedCount: number;
  readings: LiveReading[];
  requestedCount?: number;
  /** true, gdy bitmapa auta nie pokryła planu i odpytano go mimo to. */
  ignoredSupportBitmap?: boolean;
}

export interface DiagnosticPlan {
  id: string;
  title: string;
  reason: string;
  pids: string[];
  durationSeconds: number;
}

// ─── Recorder sesji pomiarowej ──────────────────────────────────────────────

export interface VehicleProfile {
  make: string;
  model: string;
  engine: string;
}

export type TestType = 'stationary' | 'road';

export interface TestConditions {
  engineWarm: boolean;
  testType: TestType;
  notes: string;
}

/** Jedna próbka: czas od startu sesji w ms i wartości liczbowe per PID. */
export interface ObdSample {
  t: number;
  values: Record<string, number>;
}

export interface PidStat {
  pid: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface ObdSession {
  schemaVersion: 1;
  sessionId: string;
  vehicle: VehicleProfile;
  symptoms: string;
  conditions: TestConditions;
  plan: DiagnosticPlan;
  startedAt: string;
  endedAt: string | null;
  samples: ObdSample[];
  /** Powody zakończenia, utraty PID-ów, błędy — bez surowego tekstu terminala. */
  events: { t: number; kind: 'info' | 'error'; text: string }[];
}

export interface DiagnosisReport {
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  findings: string[];
  likelyCauses: string[];
  nextChecks: string[];
  safetyNote: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  basedOnData?: boolean;
}

export interface ChatAnswer {
  answer: string;
  basedOnData: boolean;
  followUps: string[];
}

/** Stan natywnego rejestratora pomiaru (pętla żyje poza WebView). */
export interface RecordingStatus {
  recording: boolean;
  sampleCount: number;
  elapsedMs: number;
  plannedMs: number;
  error?: string;
  stopReason?: string;
  /** Surowe odpowiedzi na zapytania o bitmapy obsługiwanych PID-ów. */
  detection?: { command: string; response: string }[];
  detectionError?: string;
  supportedCount?: number;
}
