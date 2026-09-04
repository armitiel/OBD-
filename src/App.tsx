import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { AiPlannerPanel } from './components/AiPlannerPanel';
import { EcuStatus } from './components/EcuStatus';
import { LiveDataPanel } from './components/LiveDataPanel';
import { Terminal } from './components/Terminal';
import { obdBluetooth } from './services/obdBluetooth';
import { ALLOWED_LIVE_PIDS, BASELINE_DIAGNOSTIC_PLAN, requestDiagnosticPlan } from './services/diagnosticPlanner';
import { loadSavedLog, persistLog, shareTestLog } from './services/testLog';
import type { BluetoothDevice, ConnectionState, DiagnosticPlan, LiveDataBatch, ObdSnapshot, TerminalLine } from './types/obd';

const LAST_DEVICE_KEY = 'obd-ai-last-device';

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>(loadSavedLog);
  const [snapshot, setSnapshot] = useState<ObdSnapshot | null>(null);
  const [liveBatch, setLiveBatch] = useState<LiveDataBatch | null>(null);
  const [liveRunning, setLiveRunning] = useState(false);
  const [diagnosticPlan, setDiagnosticPlan] = useState<DiagnosticPlan>(BASELINE_DIAGNOSTIC_PLAN);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const nextLineId = useRef(lines.reduce((highest, line) => Math.max(highest, line.id), 0) + 1);
  const liveRunId = useRef(0);

  const addLine = useCallback((direction: TerminalLine['direction'], text: string) => {
    setLines((current) => [...current.slice(-1999), { id: nextLineId.current++, direction, text, timestamp: new Date() }]);
  }, []);

  useEffect(() => { persistLog(lines); }, [lines]);

  const refreshDevices = useCallback(async () => {
    try {
      const permission = await obdBluetooth.requestPermissions();
      if (!permission.granted) throw new Error('Brak uprawnienia do pobliskich urządzeń Bluetooth.');
      const paired = await obdBluetooth.getPairedDevices();
      setDevices(paired);
      setSelectedAddress((current) => {
        if (paired.some((device) => device.address === current)) return current;
        const remembered = window.localStorage.getItem(LAST_DEVICE_KEY);
        const likelyElm = paired.find((device) => /OBD|ELM/i.test(device.name));
        return paired.find((device) => device.address === remembered)?.address || likelyElm?.address || paired[0]?.address || '';
      });
      if (paired.length === 0) addLine('info', 'Nie znaleziono sparowanych urządzeń. Sparuj ELM327 w ustawieniach Androida.');
    } catch (error) {
      setConnectionState('error');
      addLine('error', formatError(error));
    }
  }, [addLine]);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);
  useEffect(() => () => { liveRunId.current += 1; }, []);

  const stopLiveData = useCallback((writeLog = true) => {
    const wasRunning = liveRunId.current > 0;
    liveRunId.current += 1;
    setLiveRunning(false);
    if (writeLog && wasRunning) addLine('info', 'Live Data zatrzymane.');
  }, [addLine]);

  const connect = async () => {
    if (!selectedAddress) return;
    setBusy(true);
    setSnapshot(null);
    setLiveBatch(null);
    setConnectionState('connecting');
    addLine('info', `──── NOWA SESJA TESTOWA · ${new Date().toLocaleString('pl-PL', { hour12: false })} ────`);
    addLine('info', `Łączenie z ${selectedAddress}…`);
    try {
      await obdBluetooth.connect(selectedAddress);
      window.localStorage.setItem(LAST_DEVICE_KEY, selectedAddress);
      setConnectionState('connected');
      addLine('info', 'Połączenie Bluetooth SPP aktywne.');
      const initialization = await obdBluetooth.initializeElm();
      for (const item of initialization) {
        addLine('tx', item.command);
        addLine('rx', item.response || '(pusta odpowiedź)');
      }
      addLine('info', 'ELM327 zainicjalizowany. Możesz wysyłać komendy lub sprawdzić ECU.');
    } catch (error) {
      setConnectionState('error');
      addLine('error', formatError(error));
      await obdBluetooth.disconnect().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    stopLiveData(false);
    setBusy(true);
    try {
      await obdBluetooth.disconnect();
      setConnectionState('disconnected');
      setSnapshot(null);
      setLiveBatch(null);
      addLine('info', 'Rozłączono adapter.');
    } catch (error) {
      addLine('error', formatError(error));
    } finally {
      setBusy(false);
    }
  };

  const sendCommand = async (command: string) => {
    setBusy(true);
    addLine('tx', command.trim().toUpperCase());
    try {
      addLine('rx', await obdBluetooth.sendCommand(command));
    } catch (error) {
      addLine('error', formatError(error));
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    addLine('tx', '0100');
    try {
      const result = await obdBluetooth.scanBasicPids();
      setSnapshot(result);
      setConnectionState(result.ecuConnected ? 'ready' : 'connected');
      addLine(result.ecuConnected ? 'info' : 'error', result.ecuConnected ? `ECU odpowiada · ${result.protocol}` : 'Brak odpowiedzi ECU. Włącz zapłon i spróbuj ponownie.');
      for (const reading of result.readings) addLine('rx', `${reading.pid}: ${reading.raw}`);
    } catch (error) {
      addLine('error', formatError(error));
    } finally {
      setBusy(false);
    }
  };

  const startLiveData = async () => {
    if (connectionState !== 'ready' || busy || liveRunning) return;
    const runId = liveRunId.current + 1;
    liveRunId.current = runId;
    setLiveRunning(true);
    addLine('info', 'Live Data uruchomione · odczyt wyłącznie bezpiecznych PID-ów trybu 01.');

    while (liveRunId.current === runId) {
      try {
        const batch = await obdBluetooth.readLiveData(diagnosticPlan.pids);
        if (liveRunId.current !== runId) break;
        setLiveBatch(batch);
        const speed = batch.durationMs > 0 ? (batch.readings.length * 1000 / batch.durationMs).toFixed(1) : '—';
        const values = batch.readings.map((reading) => `${reading.pid}=${reading.formatted}`).join(' | ');
        addLine('rx', `LIVE · ${values || 'brak danych'} · ${speed} PID/s`);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      } catch (error) {
        if (liveRunId.current === runId) {
          liveRunId.current += 1;
          setLiveRunning(false);
          addLine('error', `Live Data: ${formatError(error)}`);
        }
        break;
      }
    }
  };

  const createDiagnosticPlan = async (endpoint: string, symptoms: string) => {
    setPlannerBusy(true);
    addLine('info', `AI: przygotowanie planu dla objawu „${symptoms}”.`);
    try {
      const plan = await requestDiagnosticPlan(endpoint, {
        vehicle: { make: 'Saab', model: '9-3', engine: 'B284 2.8T' },
        symptoms,
        availablePids: [...ALLOWED_LIVE_PIDS],
      });
      setDiagnosticPlan(plan);
      addLine('info', `AI wybrało plan „${plan.title}”: ${plan.pids.join(', ')} · ${plan.durationSeconds} s.`);
    } catch (error) {
      addLine('error', `Plan AI: ${formatError(error)}`);
    } finally {
      setPlannerBusy(false);
    }
  };

  const connected = connectionState === 'connected' || connectionState === 'ready';
  const selectedDevice = devices.find((device) => device.address === selectedAddress);

  const exportLog = async () => {
    setExporting(true);
    try {
      const fileName = await shareTestLog(lines, { device: selectedDevice, snapshot });
      addLine('info', `Utworzono dziennik: ${fileName}`);
    } catch (error) {
      addLine('error', `Nie udało się udostępnić dziennika: ${formatError(error)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <main>
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div><p>SAAB 9-3 · B284</p><h1>OBD <em>AI</em> Scanner</h1></div>
        <span className="read-only-badge">TYLKO ODCZYT</span>
      </header>

      {!obdBluetooth.isNativeAndroid ? <div className="demo-banner">Tryb demonstracyjny przeglądarki — prawdziwy Bluetooth działa w aplikacji Android.</div> : null}

      <div className="layout">
        <div className="primary-column">
          <ConnectionPanel devices={devices} selectedAddress={selectedAddress} state={connectionState} busy={busy} onSelect={(address) => { setSelectedAddress(address); window.localStorage.setItem(LAST_DEVICE_KEY, address); }} onRefresh={() => void refreshDevices()} onConnect={() => void connect()} onDisconnect={() => void disconnect()} />
          <EcuStatus snapshot={snapshot} enabled={connected && !liveRunning} busy={busy || liveRunning} onScan={() => void scan()} />
          <AiPlannerPanel plan={diagnosticPlan} busy={plannerBusy || liveRunning} onRequest={createDiagnosticPlan} />
          <LiveDataPanel batch={liveBatch} enabled={connectionState === 'ready' && !busy} running={liveRunning} onToggle={() => { if (liveRunning) stopLiveData(); else void startLiveData(); }} />
        </div>
        <Terminal lines={lines} enabled={connected && !liveRunning} busy={busy || liveRunning} exporting={exporting} onSend={(command) => void sendCommand(command)} onClear={() => setLines([])} onExport={() => void exportLog()} />
      </div>

      <footer><span aria-hidden="true">◈</span> Brak funkcji zapisu, kodowania i flashowania ECU w tym wydaniu.</footer>
    </main>
  );
}
