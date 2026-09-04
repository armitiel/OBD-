import type { DiagnosticPlan, TestConditions } from '../types/obd';
import type { BackendHealth } from '../services/diagnosticPlanner';

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
}

export function AiPlannerPanel({
  plan, busy, symptoms, conditions, endpoint, token, health, healthError,
  onSymptomsChange, onConditionsChange, onEndpointChange, onTokenChange, onCheckBackend, onRequest,
}: Props) {
  return (
    <section className="card ai-card" aria-labelledby="ai-plan-title">
      <div className="card-heading">
        <div><span className="eyebrow">KROK 3 · PLAN AI</span><h2 id="ai-plan-title">Co dzieje się z autem?</h2></div>
        <span className="ai-badge">AI</span>
      </div>

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

      <button className="button button-full button-primary" type="button" onClick={onRequest} disabled={busy || symptoms.trim().length < 5 || !endpoint.trim()}>
        {busy ? 'AI układa plan…' : 'Dobierz dane przez AI'}
      </button>

      <div className="plan-result" aria-live="polite">
        <strong>{plan.title}</strong>
        <p>{plan.reason}</p>
        <div>{plan.pids.map((pid) => <code key={pid}>{pid}</code>)}</div>
        <small>Planowany pomiar: {plan.durationSeconds} s · wyłącznie odczyt</small>
      </div>
    </section>
  );
}
