import { useEffect, useRef, useState } from 'react';
import type { TerminalLine } from '../types/obd';

interface Props {
  lines: TerminalLine[];
  enabled: boolean;
  busy: boolean;
  exporting: boolean;
  onSend: (command: string) => void;
  onClear: () => void;
  onExport: () => void;
}

export function Terminal({ lines, enabled, busy, exporting, onSend, onClear, onExport }: Props) {
  const [command, setCommand] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!command.trim() || busy || !enabled) return;
    onSend(command);
    setCommand('');
  };

  return (
    <section className="card terminal-card" aria-labelledby="terminal-title">
      <div className="card-heading terminal-heading">
        <div><span className="eyebrow">TERMINAL · READ ONLY</span><h2 id="terminal-title">Surowe odpowiedzi</h2></div>
        <div className="terminal-actions">
          <span className="autosave-label" title="Dziennik pozostaje po zamknięciu aplikacji">● AUTOZAPIS</span>
          <button className="text-button export-button" type="button" onClick={onExport} disabled={lines.length === 0 || exporting}>{exporting ? 'Przygotowuję…' : 'Udostępnij log'}</button>
          <button className="text-button" type="button" onClick={onClear} disabled={lines.length === 0 || exporting}>Wyczyść</button>
        </div>
      </div>
      <div className="terminal-output" ref={outputRef} role="log" aria-live="polite">
        {lines.length === 0 ? <p className="terminal-empty">Połącz ELM327, aby rozpocząć sesję.</p> : lines.map((line) => (
          <div className={`terminal-line terminal-${line.direction}`} key={line.id}>
            <time>{line.timestamp.toLocaleTimeString('pl-PL', { hour12: false })}</time>
            <span>{line.direction === 'tx' ? '›' : line.direction === 'rx' ? '‹' : '•'}</span>
            <pre>{line.text}</pre>
          </div>
        ))}
      </div>
      <form className="command-row" onSubmit={submit}>
        <label className="sr-only" htmlFor="obd-command">Komenda ELM327 lub OBD-II</label>
        <span aria-hidden="true">›</span>
        <input id="obd-command" value={command} onChange={(event) => setCommand(event.target.value)} disabled={!enabled || busy} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder={enabled ? 'np. 010C lub ATDP' : 'Najpierw połącz adapter'} />
        <button type="submit" disabled={!enabled || busy || !command.trim()}>Wyślij</button>
      </form>
    </section>
  );
}
