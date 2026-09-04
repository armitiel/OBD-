import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { BluetoothDevice, ObdSnapshot, TerminalLine } from '../types/obd';

const STORAGE_KEY = 'obd-ai-test-log-v1';
const MAX_SAVED_LINES = 2000;

interface StoredLine extends Omit<TerminalLine, 'timestamp'> {
  timestamp: string;
}

interface ExportContext {
  device?: BluetoothDevice;
  snapshot: ObdSnapshot | null;
}

export function loadSavedLog(): TerminalLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredLine[];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((line) => {
      const timestamp = new Date(line.timestamp);
      if (!Number.isFinite(line.id) || Number.isNaN(timestamp.getTime()) || typeof line.text !== 'string') return [];
      return [{ ...line, timestamp }];
    }).slice(-MAX_SAVED_LINES);
  } catch {
    return [];
  }
}

export function persistLog(lines: TerminalLine[]) {
  try {
    if (lines.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const stored: StoredLine[] = lines.slice(-MAX_SAVED_LINES).map((line) => ({
      ...line,
      timestamp: line.timestamp.toISOString(),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Brak miejsca na zapis nie może przerwać komunikacji z ECU.
  }
}

function createFileName(now: Date) {
  const stamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');
  return `obd-ai-test-${stamp}.txt`;
}

function createLogText(lines: TerminalLine[], context: ExportContext, now: Date) {
  const device = context.device ? `${context.device.name} (${context.device.address})` : 'nie wybrano';
  const protocol = context.snapshot?.protocol ?? 'nie wykryto';
  const direction = { tx: 'TX', rx: 'RX', info: 'INFO', error: 'ERROR' } as const;
  const body = lines.map((line) => {
    const time = line.timestamp.toLocaleString('pl-PL', { hour12: false });
    return `[${time}] [${direction[line.direction]}] ${line.text}`;
  }).join('\n');

  return [
    'OBD AI Scanner — dziennik testu',
    `Eksport: ${now.toLocaleString('pl-PL', { hour12: false })}`,
    `Urządzenie: ${device}`,
    `Protokół: ${protocol}`,
    `ECU: ${context.snapshot?.ecuConnected ? 'połączone' : 'niepotwierdzone'}`,
    'Tryb aplikacji: tylko odczyt',
    '',
    body || '(brak wpisów)',
    '',
  ].join('\n');
}

export async function shareTestLog(lines: TerminalLine[], context: ExportContext) {
  const now = new Date();
  const fileName = createFileName(now);
  const text = createLogText(lines, context, now);

  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return fileName;
  }

  const saved = await Filesystem.writeFile({
    path: fileName,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  await Share.share({
    title: 'Dziennik testu OBD AI Scanner',
    text: 'Dziennik komunikacji ELM327 i ECU.',
    url: saved.uri,
    dialogTitle: 'Udostępnij dziennik testu',
  });
  return fileName;
}
