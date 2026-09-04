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
}

export interface DiagnosticPlan {
  id: string;
  title: string;
  reason: string;
  pids: string[];
  durationSeconds: number;
}
