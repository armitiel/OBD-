import { useState } from 'react';
import type { ChatMessage } from '../types/obd';

interface Props {
  messages: ChatMessage[];
  followUps: string[];
  enabled: boolean;
  busy: boolean;
  onAsk: (question: string) => void;
  onClear: () => void;
}

export function DataChatPanel({ messages, followUps, enabled, busy, onAsk, onClear }: Props) {
  const [question, setQuestion] = useState('');

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || !enabled) return;
    setQuestion('');
    onAsk(trimmed);
  };

  return (
    <section className="card chat-card" aria-labelledby="chat-title">
      <div className="card-heading">
        <div><span className="eyebrow">KROK 6 · ROZMOWA</span><h2 id="chat-title">Zapytaj o te dane</h2></div>
        {messages.length > 0 ? <button className="button button-ghost button-small" type="button" onClick={onClear} disabled={busy}>Wyczyść</button> : null}
      </div>

      {!enabled ? (
        <p className="empty-state">Najpierw zakończ pomiar. Rozmowa dotyczy konkretnej sesji — AI odpowiada na podstawie zapisanych próbek.</p>
      ) : (
        <>
          <div className="chat-thread" aria-live="polite">
            {messages.length === 0 ? (
              <p className="empty-state">Zapytaj o cokolwiek z tego pomiaru: czy korekty paliwowe są w normie, dlaczego MAP rośnie wolniej niż obroty, co sprawdzić dalej.</p>
            ) : messages.map((message, index) => (
              <div key={index} className={`chat-message chat-${message.role}`}>
                <span className="chat-author">{message.role === 'user' ? 'Ty' : 'AI'}</span>
                <p>{message.content}</p>
                {message.role === 'assistant' && message.basedOnData === false ? (
                  <small className="chat-flag">Odpowiedź z wiedzy ogólnej, nie z Twoich pomiarów.</small>
                ) : null}
              </div>
            ))}
            {busy ? <div className="chat-message chat-assistant pending"><span className="chat-author">AI</span><p>Analizuję…</p></div> : null}
          </div>

          {followUps.length > 0 && !busy ? (
            <div className="chat-suggestions">
              {followUps.map((item, index) => (
                <button key={index} type="button" className="chip" onClick={() => send(item)}>{item}</button>
              ))}
            </div>
          ) : null}

          <div className="chat-input">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') send(question); }}
              placeholder="Zadaj pytanie o pomiar…"
              disabled={busy}
              aria-label="Pytanie o zebrane dane"
            />
            <button className="button button-primary" type="button" onClick={() => send(question)} disabled={busy || question.trim().length === 0}>Wyślij</button>
          </div>
        </>
      )}
    </section>
  );
}
