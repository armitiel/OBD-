import type { DiagnosisReport, ObdSession, PidStat } from '../types/obd';

interface Props {
  session: ObdSession | null;
  stats: PidStat[];
  report: DiagnosisReport | null;
  busy: boolean;
  exporting: boolean;
  recording: boolean;
  onAnalyze: () => void;
  onExport: () => void;
  onDiscard: () => void;
}

const CONFIDENCE_LABEL: Record<DiagnosisReport['confidence'], string> = {
  low: 'niska',
  medium: 'średnia',
  high: 'wysoka',
};

export function SessionReportPanel({ session, stats, report, busy, exporting, recording, onAnalyze, onExport, onDiscard }: Props) {
  const sampleCount = session?.samples.length ?? 0;
  const durationSeconds = session && session.samples.length > 0
    ? Math.round(session.samples[session.samples.length - 1].t / 1000)
    : 0;

  return (
    <section className="card report-card" aria-labelledby="report-title">
      <div className="card-heading">
        <div><span className="eyebrow">KROK 5 · ANALIZA</span><h2 id="report-title">Raport z pomiaru</h2></div>
        {recording ? <span className="live-indicator online"><i aria-hidden="true" />NAGRYWANIE</span> : null}
      </div>

      {!session ? (
        <p className="empty-state">Uruchom Live Data — aplikacja zapisze sesję i po zakończeniu pomiaru pozwoli ją przeanalizować.</p>
      ) : (
        <>
          <div className="session-stats">
            <span>Próbki <strong>{sampleCount}</strong></span>
            <span>Czas <strong>{durationSeconds} s</strong></span>
            <span>Parametry <strong>{stats.length}</strong></span>
          </div>

          {stats.length > 0 ? (
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr><th>Parametr</th><th>min</th><th>śr.</th><th>max</th><th>n</th></tr>
                </thead>
                <tbody>
                  {stats.map((stat) => (
                    <tr key={stat.pid}>
                      <th scope="row">{stat.label}<small>{stat.pid}{stat.unit ? ` · ${stat.unit}` : ''}</small></th>
                      <td>{stat.min}</td><td>{stat.avg}</td><td>{stat.max}</td><td>{stat.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="report-actions">
            <button className="button button-primary" type="button" onClick={onAnalyze} disabled={busy || recording || sampleCount < 3}>
              {busy ? 'AI analizuje pomiar…' : 'Analizuj przez AI'}
            </button>
            <button className="button button-secondary" type="button" onClick={onExport} disabled={exporting || sampleCount === 0}>
              {exporting ? 'Zapisywanie…' : 'Eksport JSON'}
            </button>
            <button className="button button-ghost" type="button" onClick={onDiscard} disabled={busy || recording}>Odrzuć sesję</button>
          </div>

          {sampleCount > 0 && sampleCount < 3 ? <p className="hint">Za mało próbek do analizy — pomiar musi potrwać przynajmniej kilka sekund.</p> : null}

          {report ? (
            <article className="report" aria-live="polite">
              <p className="report-summary">{report.summary}</p>
              <p className={`confidence confidence-${report.confidence}`}>Pewność analizy: <strong>{CONFIDENCE_LABEL[report.confidence]}</strong></p>

              {report.findings.length > 0 ? (
                <section>
                  <h3>Obserwacje <small>co widać w danych</small></h3>
                  <ul>{report.findings.map((item, index) => <li key={index}>{item}</li>)}</ul>
                </section>
              ) : null}

              {report.likelyCauses.length > 0 ? (
                <section>
                  <h3>Hipotezy <small>możliwe przyczyny, nie pewna diagnoza</small></h3>
                  <ul className="hypotheses">{report.likelyCauses.map((item, index) => <li key={index}>{item}</li>)}</ul>
                </section>
              ) : null}

              {report.nextChecks.length > 0 ? (
                <section>
                  <h3>Następne sprawdzenia</h3>
                  <ol>{report.nextChecks.map((item, index) => <li key={index}>{item}</li>)}</ol>
                </section>
              ) : null}

              {report.safetyNote ? <p className="safety-note">{report.safetyNote}</p> : null}
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
