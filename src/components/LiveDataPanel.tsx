import type { LiveDataBatch } from '../types/obd';

interface Props {
  batch: LiveDataBatch | null;
  enabled: boolean;
  running: boolean;
  onToggle: () => void;
}

const DISPLAY_ORDER = ['010C', '010B', '0110', '0106', '0107', '0108', '0109', '0105', '010F', '0104', '0111', '010D', '010E', '0133', '0142'];

export function LiveDataPanel({ batch, enabled, running, onToggle }: Props) {
  const readings = batch ? [...batch.readings].sort((a, b) => DISPLAY_ORDER.indexOf(a.pid) - DISPLAY_ORDER.indexOf(b.pid)) : [];
  const pidsPerSecond = batch && batch.durationMs > 0 ? (batch.readings.length * 1000 / batch.durationMs).toFixed(1) : '—';

  return (
    <section className="card live-card" aria-labelledby="live-title">
      <div className="card-heading">
        <div><span className="eyebrow">KROK 4 · LIVE</span><h2 id="live-title">Dane na żywo</h2></div>
        <span className={`live-indicator ${running ? 'online' : ''}`}><i aria-hidden="true" />{running ? 'ODCZYT' : 'STOP'}</span>
      </div>

      <div className="live-stats">
        <span>Obsługiwane PID-y <strong>{batch?.supportedCount ?? '—'}</strong></span>
        <span>Szybkość adaptera <strong>{pidsPerSecond} PID/s</strong></span>
      </div>

      {readings.length > 0 ? (
        <div className="live-grid">
          {readings.map((reading) => (
            <div className="live-reading" key={reading.pid} title={reading.raw}>
              <span>{reading.label}<small>{reading.pid}</small></span>
              <strong>{reading.formatted}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">Połącz ECU i uruchom odczyt. Aplikacja automatycznie pominie PID-y, których samochód nie obsługuje.</p>
      )}

      {running ? <p className="hint keep-awake">Ekran pozostaje włączony do końca pomiaru. Nie przełączaj się na inną aplikację — zapis próbek zatrzyma się razem z ekranem.</p> : null}

      <button className={`button button-full ${running ? 'button-secondary' : 'button-primary'}`} type="button" onClick={onToggle} disabled={!enabled && !running}>
        {running ? 'Zatrzymaj Live Data' : 'Uruchom Live Data'}
      </button>
    </section>
  );
}
