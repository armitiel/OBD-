import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { AiPlannerPanel } from './components/AiPlannerPanel';
import { EcuStatus } from './components/EcuStatus';
import { LiveDataPanel } from './components/LiveDataPanel';
import { SessionReportPanel } from './components/SessionReportPanel';
import { DataChatPanel } from './components/DataChatPanel';
import { Terminal } from './components/Terminal';
import { obdBluetooth } from './services/obdBluetooth';
import {
  ALLOWED_LIVE_PIDS, BASELINE_DIAGNOSTIC_PLAN, DEFAULT_BACKEND_URL,
  checkBackend, requestChat, requestDiagnosis, requestDiagnosticPlan,
} from './services/diagnosticPlanner';
import type { BackendHealth } from './services/diagnosticPlanner';
import {
  DEFAULT_CONDITIONS, REFERENCE_VEHICLE, appendBatch, appendEvent, buildAiPayload,
  computeStats, createSession, finishSession, loadSession, persistSession, shareSessionJson,
} from './services/sessionRecorder';
import { loadSavedLog, persistLog, shareTestLog } from './services/testLog';
import type {
  BluetoothDevice, ChatMessage, ConnectionState, DiagnosisReport, DiagnosticPlan,
  LiveDataBatch, ObdSession, ObdSnapshot, TerminalLine, TestConditions,
} from './types/obd';

const LAST_DEVICE_KEY = 'obd-ai-last-device';
const ENDPOINT_KEY = 'obd-ai-backend-url';
const LEGACY_BACKEND_URL = 'http://127.0.0.1:8787';
const TOKEN_KEY = 'obd-ai-backend-token';
const SYMPTOMS_KEY = 'obd-ai-symptoms';
/** Co ile paczek zapisujemy sesję na dysk — kompromis między bezpieczeństwem a kosztem. */
const PERSIST_EVERY = 20;

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

  const [symptoms, setSymptoms] = useState(() => window.localStorage.getItem(SYMPTOMS_KEY) || '');
  const [conditions, setConditions] = useState<TestConditions>(DEFAULT_CONDITIONS);
  const [endpoint, setEndpoint] = useState(() => {
    const stored = window.localStorage.getItem(ENDPOINT_KEY);
    // Migracja z 0.4.0: tam domyślnym adresem był lokalny backend przez adb reverse,
    // który po aktualizacji zostawał w localStorage i cicho psuł każde wywołanie AI.
    if (!stored || stored === LEGACY_BACKEND_URL) return DEFAULT_BACKEND_URL;
    return stored;
  });
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) || '');
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState('');

  const [session, setSession] = useState<ObdSession | null>(loadSession);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [sessionExporting, setSessionExporting] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatFollowUps, setChatFollowUps] = useState<string[]>([]);
  const [chatBusy, setChatBusy] = useState(false);

  const nextLineId = useRef(lines.reduce((highest, line) => Math.max(highest, line.id), 0) + 1);
  const liveRunId = useRef(0);
  const sessionRef = useRef<ObdSession | null>(session);
  const labelsRef = useRef(new Map<string, { label: string; unit: string }>());

  const addLine = useCallback((direction: TerminalLine['direction'], text: string) => {
    setLines((current) => [...current.slice(-1999), { id: nextLineId.current++, direction, text, timestamp: new Date() }]);
  }, []);

  useEffect(() => { persistLog(lines); }, [lines]);
  useEffect(() => { window.localStorage.setItem(ENDPOINT_KEY, endpoint); }, [endpoint]);
  useEffect(() => { window.localStorage.setItem(TOKEN_KEY, token); }, [token]);
  useEffect(() => { window.localStorage.setItem(SYMPTOMS_KEY, symptoms); }, [symptoms]);

  const stats = useMemo(() => (session ? computeStats(session, labelsRef.current) : []), [session]);

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
  useEffect(() => () => { liveRunId.current += 1; void obdBluetooth.setKeepAwake(false); }, []);

  const stopLiveData = useCallback((reason = '') => {
    const wasRunning = liveRunId.current > 0;
    liveRunId.current += 1;
    setLiveRunning(false);
    void obdBluetooth.setKeepAwake(false);
    if (sessionRef.current && !sessionRef.current.endedAt) {
      sessionRef.current = finishSession(sessionRef.current);
      persistSession(sessionRef.current);
      setSession(sessionRef.current);
    }
    if (reason && wasRunning) addLine('info', reason);
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
    stopLiveData();
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

    void obdBluetooth.setKeepAwake(true);
    const startedAtMs = Date.now();
    const limitMs = diagnosticPlan.durationSeconds * 1000;
    sessionRef.current = createSession(diagnosticPlan, symptoms.trim(), conditions);
    setSession(sessionRef.current);
    setReport(null);
    setChatMessages([]);
    setChatFollowUps([]);
    persistSession(sessionRef.current);
    addLine('info', `Live Data uruchomione · plan „${diagnosticPlan.title}" · ekran nie zgaśnie · automatyczny koniec po ${diagnosticPlan.durationSeconds} s.`);

    let batchCount = 0;

    while (liveRunId.current === runId) {
      try {
        const batch = await obdBluetooth.readLiveData(diagnosticPlan.pids);
        if (liveRunId.current !== runId) break;

        setLiveBatch(batch);
        for (const reading of batch.readings) {
          if (!labelsRef.current.has(reading.pid)) labelsRef.current.set(reading.pid, { label: reading.label, unit: reading.unit });
        }
        if (sessionRef.current) {
          sessionRef.current = appendBatch(sessionRef.current, batch, startedAtMs);
          setSession(sessionRef.current);
          batchCount += 1;
          if (batchCount % PERSIST_EVERY === 0) persistSession(sessionRef.current);
        }

        const speed = batch.durationMs > 0 ? (batch.readings.length * 1000 / batch.durationMs).toFixed(1) : '—';
        const values = batch.readings.map((reading) => `${reading.pid}=${reading.formatted}`).join(' | ');
        addLine('rx', `LIVE · ${values || 'brak danych'} · ${speed} PID/s`);

        if (Date.now() - startedAtMs >= limitMs) {
          stopLiveData(`Pomiar zakończony automatycznie po ${diagnosticPlan.durationSeconds} s · ${sessionRef.current?.samples.length ?? 0} próbek.`);
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      } catch (error) {
        if (liveRunId.current === runId) {
          if (sessionRef.current) sessionRef.current = appendEvent(sessionRef.current, 'error', formatError(error), startedAtMs);
          stopLiveData(`Live Data przerwane: ${formatError(error)}`);
        }
        break;
      }
    }
  };

  const createDiagnosticPlan = async () => {
    setPlannerBusy(true);
    const description = symptoms.trim();
    addLine('info', `AI: przygotowanie planu dla objawu „${description}".`);
    try {
      const plan = await requestDiagnosticPlan(endpoint, {
        vehicle: REFERENCE_VEHICLE,
        symptoms: description,
        availablePids: [...ALLOWED_LIVE_PIDS],
      }, token);
      setDiagnosticPlan(plan);
      addLine('info', `AI wybrało plan „${plan.title}": ${plan.pids.join(', ')} · ${plan.durationSeconds} s.`);
    } catch (error) {
      addLine('error', `Plan AI: ${formatError(error)}`);
    } finally {
      setPlannerBusy(false);
    }
  };

  const verifyBackend = async () => {
    setHealthError('');
    setHealth(null);
    try {
      setHealth(await checkBackend(endpoint, token));
    } catch (error) {
      setHealthError(formatError(error));
    }
  };

  const analyzeSession = async () => {
    if (!session) return;
    setAnalysisBusy(true);
    addLine('info', 'AI: analiza zakończonego pomiaru.');
    try {
      const result = await requestDiagnosis(endpoint, buildAiPayload(finishSession(session), stats), token);
      setReport(result);
      addLine('info', `AI: raport gotowy · pewność ${result.confidence}.`);
    } catch (error) {
      addLine('error', `Analiza AI: ${formatError(error)}`);
    } finally {
      setAnalysisBusy(false);
    }
  };

  const askAboutData = async (question: string) => {
    if (!session) return;
    const history = [...chatMessages, { role: 'user' as const, content: question }];
    setChatMessages(history);
    setChatFollowUps([]);
    setChatBusy(true);
    try {
      const answer = await requestChat(endpoint, buildAiPayload(session, stats), report, chatMessages, question, token);
      setChatMessages([...history, { role: 'assistant', content: answer.answer, basedOnData: answer.basedOnData }]);
      setChatFollowUps(answer.followUps);
    } catch (error) {
      setChatMessages([...history, { role: 'assistant', content: `Nie udało się uzyskać odpowiedzi: ${formatError(error)}` }]);
    } finally {
      setChatBusy(false);
    }
  };

  const exportSession = async () => {
    if (!session) return;
    setSessionExporting(true);
    try {
      const fileName = await shareSessionJson(session, stats);
      addLine('info', `Zapisano sesję: ${fileName}`);
    } catch (error) {
      addLine('error', `Eksport sesji: ${formatError(error)}`);
    } finally {
      setSessionExporting(false);
    }
  };

  const discardSession = () => {
    sessionRef.current = null;
    setSession(null);
    setReport(null);
    setChatMessages([]);
    setChatFollowUps([]);
    persistSession(null);
    addLine('info', 'Sesja pomiarowa odrzucona.');
  };

  const connected = connectionState === 'connected' || connectionState === 'ready';
  const selectedDevice = devices.find((device) => device.address === selectedAddress);
  const sessionFinished = Boolean(session && session.endedAt && session.samples.length > 0);

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
          <AiPlannerPanel
            plan={diagnosticPlan}
            busy={plannerBusy || liveRunning}
            symptoms={symptoms}
            conditions={conditions}
            endpoint={endpoint}
            token={token}
            health={health}
            healthError={healthError}
            onSymptomsChange={setSymptoms}
            onConditionsChange={setConditions}
            onEndpointChange={setEndpoint}
            onTokenChange={setToken}
            onCheckBackend={() => void verifyBackend()}
            onRequest={() => void createDiagnosticPlan()}
          />
          <LiveDataPanel batch={liveBatch} enabled={connectionState === 'ready' && !busy} running={liveRunning} onToggle={() => { if (liveRunning) stopLiveData('Live Data zatrzymane ręcznie.'); else void startLiveData(); }} />
          <SessionReportPanel
            session={session}
            stats={stats}
            report={report}
            busy={analysisBusy}
            exporting={sessionExporting}
            recording={liveRunning}
            onAnalyze={() => void analyzeSession()}
            onExport={() => void exportSession()}
            onDiscard={discardSession}
          />
          <DataChatPanel
            messages={chatMessages}
            followUps={chatFollowUps}
            enabled={sessionFinished}
            busy={chatBusy}
            onAsk={(question) => void askAboutData(question)}
            onClear={() => { setChatMessages([]); setChatFollowUps([]); }}
          />
        </div>
        <Terminal lines={lines} enabled={connected && !liveRunning} busy={busy || liveRunning} exporting={exporting} onSend={(command) => void sendCommand(command)} onClear={() => setLines([])} onExport={() => void exportLog()} />
      </div>

      <footer><span aria-hidden="true">◈</span> Brak funkcji zapisu, kodowania i flashowania ECU w tym wydaniu.</footer>
    </main>
  );
}
