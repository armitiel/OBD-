import type { ObdSnapshot } from '../types/obd';

interface Props {
  snapshot: ObdSnapshot | null;
  enabled: boolean;
  busy: boolean;
  onScan: () => void;
}

export function EcuStatus({ snapshot, enabled, busy, onScan }: Props) {
  return (
    <section className="card ecu-card" aria-labelledby="ecu-title">
      <div className="card-heading">
        <div><span className="eyebrow">KROK 2</span><h2 id="ecu-title">ECU i podstawowe PID-y</h2></div>
        <span className={`ecu-dot ${snapshot?.ecuConnected ? 'online' : ''}`} aria-label={snapshot?.ecuConnected ? 'ECU odpowiada' : 'Brak potwierdzenia ECU'} />
      </div>
      {snapshot ? (
        <>
          <div className="protocol"><span>Wykryty protokół</span><strong>{snapshot.protocol}</strong></div>
          <div className="readings">
            {snapshot.readings.map((reading) => (
              <div className="reading" key={reading.pid} title={reading.raw}>
                <span>{reading.label}<small>{reading.pid}</small></span>
                <strong>{reading.value}</strong>
              </div>
            ))}
          </div>
        </>
      ) : <p className="empty-state">Po inicjalizacji odpytamy ECU komendą 0100 i odczytamy bezpieczne, standardowe PID-y.</p>}
      <button className="button button-ghost button-full" type="button" onClick={onScan} disabled={!enabled || busy}>{busy ? 'Odczytuję…' : 'Sprawdź ECU i PID-y'}</button>
    </section>
  );
}
