import type { BluetoothDevice, ConnectionState } from '../types/obd';

interface Props {
  devices: BluetoothDevice[];
  selectedAddress: string;
  state: ConnectionState;
  busy: boolean;
  onSelect: (address: string) => void;
  onRefresh: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectionPanel({ devices, selectedAddress, state, busy, onSelect, onRefresh, onConnect, onDisconnect }: Props) {
  const connected = state === 'connected' || state === 'ready';
  const label = state === 'ready' ? 'ECU gotowe' : connected ? 'Adapter połączony' : state === 'connecting' ? 'Łączenie…' : state === 'error' ? 'Błąd połączenia' : 'Rozłączono';

  return (
    <section className="card connection-card" aria-labelledby="connection-title">
      <div className="card-heading">
        <div>
          <span className="eyebrow">KROK 1</span>
          <h2 id="connection-title">Adapter Bluetooth</h2>
        </div>
        <span className={`status-pill status-${state}`}><i aria-hidden="true" />{label}</span>
      </div>

      <label className="field-label" htmlFor="device-select">Sparowane urządzenie</label>
      <div className="device-row">
        <select id="device-select" value={selectedAddress} disabled={busy || connected} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Wybierz ELM327…</option>
          {devices.map((device) => <option key={device.address} value={device.address}>{device.name} · {device.address}</option>)}
        </select>
        <button className="icon-button" type="button" onClick={onRefresh} disabled={busy || connected} aria-label="Odśwież listę sparowanych urządzeń">↻</button>
      </div>

      <p className="hint">Adapter musi być wcześniej sparowany w ustawieniach Bluetooth telefonu.</p>
      {connected ? (
        <button className="button button-secondary button-full" type="button" onClick={onDisconnect} disabled={busy}>Rozłącz</button>
      ) : (
        <button className="button button-primary button-full" type="button" onClick={onConnect} disabled={busy || !selectedAddress}>{busy ? 'Łączenie i inicjalizacja…' : 'Połącz i uruchom ELM'}</button>
      )}
    </section>
  );
}
