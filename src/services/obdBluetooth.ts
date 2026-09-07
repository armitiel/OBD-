import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BluetoothDevice, LiveDataBatch, ObdSnapshot, RecordingStatus } from '../types/obd';

interface BluetoothSerialPlugin {
  requestPermissions(): Promise<{ granted: boolean }>;
  getPairedDevices(): Promise<{ devices: BluetoothDevice[] }>;
  connect(options: { address: string }): Promise<{ connected: boolean }>;
  disconnect(): Promise<void>;
  sendCommand(options: { command: string; timeoutMs?: number }): Promise<{ response: string }>;
  initializeElm(): Promise<{ responses: Array<{ command: string; response: string }> }>;
  scanBasicPids(): Promise<ObdSnapshot>;
  readLiveData(options: { pids?: string[] }): Promise<LiveDataBatch>;
  isConnected(): Promise<{ connected: boolean; address?: string }>;
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
  startRecording(options: { pids: string[]; durationSeconds: number; planTitle: string }): Promise<RecordingStatus>;
  stopRecording(options: { reason?: string }): Promise<RecordingStatus>;
  getRecordingStatus(): Promise<RecordingStatus>;
  drainSamples(options: { fromIndex: number }): Promise<{ batches: LiveDataBatch[]; status: RecordingStatus }>;
  resetRecording(): Promise<void>;
}

const NativeBluetooth = registerPlugin<BluetoothSerialPlugin>('BluetoothSerial');

const DEMO_DEVICE: BluetoothDevice = { name: 'ELM327 (tryb demo)', address: '00:00:00:00:00:00' };
const SAFE_AT_COMMANDS = new Set(['ATZ', 'ATE0', 'ATE1', 'ATI', 'ATSP0', 'ATDP', 'ATDPN', 'ATRV', 'AT@1', 'ATL0', 'ATL1', 'ATS0', 'ATS1', 'ATH0', 'ATH1', 'ATAT0', 'ATAT1', 'ATAT2']);

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

class ObdBluetoothService {
  private demoConnected = false;

  get isNativeAndroid() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  async requestPermissions() {
    if (!this.isNativeAndroid) return { granted: true };
    return NativeBluetooth.requestPermissions();
  }

  async getPairedDevices() {
    if (!this.isNativeAndroid) return [DEMO_DEVICE];
    const { devices } = await NativeBluetooth.getPairedDevices();
    return devices;
  }

  async connect(address: string) {
    if (!this.isNativeAndroid) {
      await wait(450);
      this.demoConnected = true;
      return;
    }
    await NativeBluetooth.connect({ address });
  }

  async disconnect() {
    if (!this.isNativeAndroid) {
      this.demoConnected = false;
      return;
    }
    await NativeBluetooth.disconnect();
  }

  /**
   * Blokada wygaszania ekranu na czas pomiaru. Po wygaszeniu ekranu Android
   * wstrzymuje WebView, a wraz z nim pętlę Live Data — sesja urywałaby się
   * w połowie testu drogowego. Błąd tutaj nie może przerwać pomiaru.
   */
  async setKeepAwake(enabled: boolean) {
    if (!this.isNativeAndroid) return;
    try {
      await NativeBluetooth.setKeepAwake({ enabled });
    } catch {
      // starsze wydanie pluginu nie zna tej metody — pomiar leci dalej
    }
  }

  async sendCommand(command: string, timeoutMs = 3500) {
    const normalized = command.replace(/\s/g, '').toUpperCase();
    const readOnlyObd = /^(01|02|03|09|0A)[0-9A-F]*$/.test(normalized);
    if (!SAFE_AT_COMMANDS.has(normalized) && !readOnlyObd) {
      throw new Error('Komenda zablokowana: to wydanie pozwala wyłącznie na bezpieczny odczyt OBD-II.');
    }
    if (!this.isNativeAndroid) {
      if (!this.demoConnected) throw new Error('Najpierw połącz adapter.');
      await wait(180);
      const responses: Record<string, string> = {
        ATZ: 'ELM327 v1.5',
        ATE0: 'OK',
        ATI: 'ELM327 v1.5',
        ATSP0: 'OK',
        ATDP: 'ISO 15765-4 (CAN 11/500)',
        '0100': '7E8 06 41 00 BE 3F A8 13',
        '010C': '7E8 04 41 0C 1A F8',
        '010D': '7E8 03 41 0D 00',
        '0105': '7E8 03 41 05 57',
        '0111': '7E8 03 41 11 00',
      };
      return responses[normalized] ?? 'NO DATA';
    }
    const { response } = await NativeBluetooth.sendCommand({ command: normalized, timeoutMs });
    return response;
  }

  async initializeElm() {
    if (this.isNativeAndroid) {
      const { responses } = await NativeBluetooth.initializeElm();
      return responses;
    }
    const responses = [];
    for (const command of ['ATZ', 'ATE0', 'ATI', 'ATSP0']) {
      responses.push({ command, response: await this.sendCommand(command, command === 'ATZ' ? 5000 : 3000) });
    }
    return responses;
  }

  async scanBasicPids(): Promise<ObdSnapshot> {
    if (this.isNativeAndroid) return NativeBluetooth.scanBasicPids();
    await wait(350);
    return {
      protocol: 'ISO 15765-4 (CAN 11/500)',
      ecuConnected: true,
      readings: [
        { pid: '010C', label: 'Obroty silnika', value: '1726 rpm', raw: '7E8 04 41 0C 1A F8' },
        { pid: '010D', label: 'Prędkość', value: '0 km/h', raw: '7E8 03 41 0D 00' },
        { pid: '0105', label: 'Płyn chłodzący', value: '47 °C', raw: '7E8 03 41 05 57' },
        { pid: '0111', label: 'Przepustnica', value: '0 %', raw: '7E8 03 41 11 00' },
      ],
    };
  }

  // ─── Nagrywanie w tle ────────────────────────────────────────────────────
  // Pętla żyje po stronie natywnej, więc zapis trwa także wtedy, gdy WebView
  // jest uśpiony. Tryb demonstracyjny przeglądarki symuluje ją w JS.

  private demoRecording: { batches: LiveDataBatch[]; startedAt: number; durationMs: number; timer: number } | null = null;

  async startRecording(pids: string[], durationSeconds: number, planTitle: string): Promise<RecordingStatus> {
    if (this.isNativeAndroid) return NativeBluetooth.startRecording({ pids, durationSeconds, planTitle });
    const state = { batches: [] as LiveDataBatch[], startedAt: Date.now(), durationMs: durationSeconds * 1000, timer: 0 };
    state.timer = window.setInterval(async () => {
      if (Date.now() - state.startedAt >= state.durationMs) {
        window.clearInterval(state.timer);
        this.demoRecording = { ...state, timer: 0 };
        return;
      }
      state.batches.push(await this.readLiveData(pids));
    }, 900);
    this.demoRecording = state;
    return this.getRecordingStatus();
  }

  async stopRecording(reason = 'Pomiar zatrzymany ręcznie.'): Promise<RecordingStatus> {
    if (this.isNativeAndroid) return NativeBluetooth.stopRecording({ reason });
    if (this.demoRecording?.timer) window.clearInterval(this.demoRecording.timer);
    if (this.demoRecording) this.demoRecording = { ...this.demoRecording, timer: 0 };
    return this.getRecordingStatus();
  }

  async getRecordingStatus(): Promise<RecordingStatus> {
    if (this.isNativeAndroid) return NativeBluetooth.getRecordingStatus();
    const state = this.demoRecording;
    if (!state) return { recording: false, sampleCount: 0, elapsedMs: 0, plannedMs: 0 };
    return {
      recording: state.timer !== 0,
      sampleCount: state.batches.length,
      elapsedMs: Date.now() - state.startedAt,
      plannedMs: state.durationMs,
    };
  }

  async drainSamples(fromIndex: number): Promise<{ batches: LiveDataBatch[]; status: RecordingStatus }> {
    if (this.isNativeAndroid) return NativeBluetooth.drainSamples({ fromIndex });
    return { batches: (this.demoRecording?.batches ?? []).slice(fromIndex), status: await this.getRecordingStatus() };
  }

  async resetRecording() {
    if (this.isNativeAndroid) return NativeBluetooth.resetRecording();
    this.demoRecording = null;
  }

  async readLiveData(pids?: string[]): Promise<LiveDataBatch> {
    if (this.isNativeAndroid) return NativeBluetooth.readLiveData({ pids });
    if (!this.demoConnected) throw new Error('Najpierw połącz adapter.');
    const startedAt = performance.now();
    await wait(720);
    const phase = Date.now() / 1100;
    const rpm = 780 + Math.round(Math.sin(phase) * 22);
    const makeReading = (pid: string, label: string, value: number, unit: string, digits = 0) => ({
      pid,
      label,
      value,
      unit,
      formatted: `${value.toFixed(digits)} ${unit}`.trim(),
      raw: 'DEMO',
    });
    const allReadings = [
      makeReading('010C', 'Obroty silnika', rpm, 'rpm'),
      makeReading('010B', 'Ciśnienie MAP', 31 + Math.sin(phase / 2), 'kPa', 0),
      makeReading('0110', 'Przepływ MAF', 4.8 + Math.sin(phase) * 0.15, 'g/s', 2),
      makeReading('0106', 'STFT Bank 1', Math.sin(phase) * 2.2, '%', 1),
      makeReading('0107', 'LTFT Bank 1', 1.6, '%', 1),
      makeReading('0108', 'STFT Bank 2', Math.cos(phase) * 2.0, '%', 1),
      makeReading('0109', 'LTFT Bank 2', 0.8, '%', 1),
      makeReading('0105', 'Płyn chłodzący', 89, '°C'),
      makeReading('010F', 'Powietrze dolotowe', 24, '°C'),
      makeReading('0104', 'Obciążenie silnika', 18.4, '%', 1),
      makeReading('0111', 'Przepustnica', 13.3, '%', 1),
      makeReading('010D', 'Prędkość', 0, 'km/h'),
      makeReading('010E', 'Wyprzedzenie zapłonu', 8.5, '°', 1),
      makeReading('0142', 'Napięcie modułu', 14.1, 'V', 2),
    ];
    const readings = pids?.length ? allReadings.filter((reading) => pids.includes(reading.pid)) : allReadings;
    return { timestamp: Date.now(), durationMs: Math.round(performance.now() - startedAt), supportedCount: 18, readings };
  }
}

export const obdBluetooth = new ObdBluetoothService();
