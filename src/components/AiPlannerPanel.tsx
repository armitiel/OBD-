import type { DiagnosticPlan, TestConditions } from '../types/obd';
import type { BackendHealth } from '../services/diagnosticPlanner';
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS } from '../services/diagnosticPlanner';

/** 90 → „1 min 30 s", 300 → „5 min" */
export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

interface Props {
  plan: DiagnosticPlan;
  busy: boolean;
  symptoms: string;
  conditions: TestConditions;
  endpoint: string;
  token: string;
  health: BackendHealth | null;
  healthError: string;
  onSymptomsChange: (value: string) => void;
  onConditionsChange: (value: TestConditions) => void;
  onEndpointChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onCheckBackend: () => void;
  onRequest: () => void;
  onDurationChange: (seconds: number) => void;
  checkingBackend: boolean;
}

export function AiPlannerPanel({
  plan, busy, symptoms, conditions, endpoint, token, health, healthError,
  onSymptomsChange, onConditionsChange, onEndpointChange, onTokenChange, onCheckBackend, onRequest, onDurationChange, checkingBackend,
}: Props) {
  // Dostępność AI musi być widoczna bez rozwijania ustawień — inaczej nie
  // wiadomo, czy plan w ogóle ma szansę powstać.
  const aiState = (() => {
    if (checkingBackend) return { tone: 'checking', title: 'Sprawdzam połączenie z usługą AI…' };
    if (healthError) return { tone: 'error', title: `Usługa AI nieosiągalna: ${healthError}` };
    if (!health) return { tone: 'checking', title: 'Nie sprawdzono jeszcze połączenia z usługą AI.' };
    if (health.mockMode) return { tone: 'warn', title: 'Usługa AI w trybie demonstracyjnym — odpowiedzi są atrapą.' };
    if (!health.aiConfigured) return { tone: 'error', title: 'Usługa AI działa, ale nie ma klucza — analiza się nie powiedzie.' };
    return { tone: 'ok', title: `Usługa AI gotowa · model ${health.model}` };
  })();

  const symptomsText = symptoms.trim();
  const canRequest = !busy && symptomsText.length > 0 && endpoint.trim().length > 0;

  return (
    <section className="card ai-card" aria-labelledby="ai-plan-title">
      <div className="card-heading">
        <div><span className="eyebrow">KROK 3 · PLAN AI</span><h2 id="ai-plan-title">Co dzieje się z autem?</h2></div>
        <span className={`ai-badge ${aiState.tone}`} title={aiState.title}>
          <i aria-hidden="true" />AI
        </span>
      </div>

      <p className={`ai-availability ${aiState.tone}`} aria-live="polite">{aiState.title}</p>

      <label className="field-label" htmlFor="symptoms">Opisz objaw</label>
      <textarea id="symptoms" value={symptoms} onChange={(event) => onSymptomsChange(event.target.value)} placeholder="Np. szarpie pod obciążeniem, brak mocy od 3000 rpm, check engine…" rows={4} disabled={busy} />

      <fieldset className="conditions" disabled={busy}>
        <legend>Warunki testu</legend>
        <label className="checkbox">
          <input type="checkbox" checked={conditions.engineWarm} onChange={(event) => onConditionsChange({ ...conditions, engineWarm: event.target.checked })} />
          Silnik rozgrzany
        </label>
        <div className="segmented" role="group" aria-label="Rodzaj testu">
          <button type="button" className={conditions.testType === 'stationary' ? 'active' : ''} onClick={() => onConditionsChange({ ...conditions, testType: 'stationary' })}>Postój</button>
          <button type="button" className={conditions.testType === 'road' ? 'active' : ''} onClick={() => onConditionsChange({ ...conditions, testType: 'road' })}>Jazda</button>
        </div>
        <input className="conditions-notes" value={conditions.notes} onChange={(event) => onConditionsChange({ ...conditions, notes: event.target.value })} placeholder="Uwagi: bieg, obciążenie, pogoda…" />
      </fieldset>

      <details className="backend-settings">
        <summary>Połączenie z usługą AI</summary>
        <label className="field-label" htmlFor="backend-url">Adres backendu</label>
        <input id="backend-url" inputMode="url" value={endpoint} onChange={(event) => onEndpointChange(event.target.value)} disabled={busy} />
        <label className="field-label" htmlFor="backend-token">Token dostępu (jeśli backend go wymaga)</label>
        <input id="backend-token" type="password" autoComplete="off" value={token} onChange={(event) => onTokenChange(event.target.value)} disabled={busy} />
        <button className="button button-secondary" type="button" onClick={onCheckBackend} disabled={busy}>Sprawdź backend</button>
        {health ? (
          <p className={`backend-health ${health.aiConfigured && !health.mockMode ? 'ok' : 'warn'}`}>
            {health.mockMode
              ? 'Backend działa w trybie demonstracyjnym — odpowiedzi są atrapą.'
              : health.aiConfigured
                ? `Backend gotowy · model ${health.model}`
                : 'Backend działa, ale nie ma klucza API — analiza AI się nie powiedzie.'}
          </p>
        ) : null}
        {healthError ? <p className="backend-health error">{healthError}</p> : null}
      </details>

      <button className="button button-full button-primary" type="button" onClick={onRequest} disabled={!canRequest}>
        {busy ? 'AI układa plan…' : 'Dobierz dane przez AI'}
      </button>

      {symptomsText.length === 0
        ? <p className="hint">Opisz objaw powyżej, żeby AI mogło dobrać parametry.</p>
        : symptomsText.length < 12
          ? <p className="hint">Możesz wysłać, ale im konkretniej opiszesz objaw, tym trafniejszy plan — np. kiedy występuje i przy jakich obrotach.</p>
          : null}

      <div className="plan-result" aria-live="polite">
        <strong>{plan.title}</strong>
        <p>{plan.reason}</p>
        <div>{plan.pids.map((pid) => <code key={pid}>{pid}</code>)}</div>

        <div className="duration-control">
          <label htmlFor="duration">
            Czas pomiaru <strong>{formatDuration(plan.durationSeconds)}</strong>
          </label>
          <input
            id="duration"
            type="range"
            min={MIN_DURATION_SECONDS}
            max={MAX_DURATION_SECONDS}
            step={15}
            value={plan.durationSeconds}
            disabled={busy}
            onChange={(event) => onDurationChange(Number(event.target.value))}
          />
          <div className="duration-presets">
            {[60, 180, 300, 600].map((seconds) => (
              <button
                key={seconds}
                type="button"
                className={plan.durationSeconds === seconds ? 'chip active' : 'chip'}
                disabled={busy}
                onClick={() => onDurationChange(seconds)}
              >
                {formatDuration(seconds)}
              </button>
            ))}
          </div>
        </div>

        <small>Pomiar zatrzyma się sam po tym czasie · wyłącznie odczyt</small>
      </div>
    </section>
  );
}
