import { useState } from 'react';
import type { DiagnosticPlan } from '../types/obd';

const ENDPOINT_KEY = 'obd-ai-backend-url';

interface Props {
  plan: DiagnosticPlan;
  busy: boolean;
  onRequest: (endpoint: string, symptoms: string) => Promise<void>;
}

export function AiPlannerPanel({ plan, busy, onRequest }: Props) {
  const [symptoms, setSymptoms] = useState('');
  const [endpoint, setEndpoint] = useState(() => window.localStorage.getItem(ENDPOINT_KEY) || 'http://127.0.0.1:8787');

  const submit = async () => {
    const normalizedEndpoint = endpoint.trim().replace(/\/$/, '');
    window.localStorage.setItem(ENDPOINT_KEY, normalizedEndpoint);
    await onRequest(normalizedEndpoint, symptoms.trim());
  };

  return (
    <section className="card ai-card" aria-labelledby="ai-plan-title">
      <div className="card-heading">
        <div><span className="eyebrow">KROK 3 · PLAN AI</span><h2 id="ai-plan-title">Co dzieje się z autem?</h2></div>
        <span className="ai-badge">AI</span>
      </div>

      <label className="field-label" htmlFor="symptoms">Opisz objaw</label>
      <textarea id="symptoms" value={symptoms} onChange={(event) => setSymptoms(event.target.value)} placeholder="Np. szarpie pod obciążeniem, brak mocy od 3000 rpm, check engine…" rows={4} disabled={busy} />

      <details className="backend-settings">
        <summary>Połączenie z usługą AI</summary>
        <label className="field-label" htmlFor="backend-url">Adres backendu</label>
        <input id="backend-url" inputMode="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} disabled={busy} />
      </details>

      <button className="button button-full button-primary" type="button" onClick={() => void submit()} disabled={busy || symptoms.trim().length < 5 || !endpoint.trim()}>
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
