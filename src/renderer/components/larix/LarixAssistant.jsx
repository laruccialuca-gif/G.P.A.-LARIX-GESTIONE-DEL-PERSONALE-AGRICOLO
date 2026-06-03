import React, { useCallback, useMemo, useRef, useState } from 'react';
import { resolveLarixCommand } from './larixActions';

const INITIAL_MESSAGES = [
  {
    id: 'welcome',
    role: 'assistant',
    text: 'Ciao, sono Larix. Posso aiutarti a navigare nel gestionale. Prova con "vai a presenze" oppure "apri report Giuseppe Pugliese maggio".',
  },
];

function createMessage(role, text, extra = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
    ...extra,
  };
}

export default function LarixAssistant({
  isOpen,
  onClose,
  navigate,
  selectedYear,
  setSelectedYear,
}) {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const employeeCacheRef = useRef(null);
  const teamCacheRef = useRef(null);

  const quickPrompts = useMemo(
    () => [
      'vai a presenze',
      'apri report Giuseppe Pugliese maggio',
      'preview pagamenti giugno',
      'apri storico Elsa aprile',
    ],
    []
  );

  const loadEmployees = useCallback(async () => {
    if (employeeCacheRef.current) {
      return employeeCacheRef.current;
    }
    const rows = await window.api.employees.listBasic({
      includeDeleted: true,
      includeTeamHistory: true,
      includePeriods: true,
    });
    employeeCacheRef.current = Array.isArray(rows) ? rows : [];
    return employeeCacheRef.current;
  }, []);

  const loadTeams = useCallback(async () => {
    if (teamCacheRef.current) {
      return teamCacheRef.current;
    }
    const rows = await window.api.teams.list({ includeArchived: false });
    teamCacheRef.current = Array.isArray(rows) ? rows : [];
    return teamCacheRef.current;
  }, []);

  const executeNavigateAction = useCallback((action, messageText = '') => {
    if (!action?.to) return;
    if (action.year && typeof setSelectedYear === 'function') {
      setSelectedYear(Number(action.year));
    }
    console.info('[larix] action', action);
    navigate(action.to);
    if (messageText) {
      setMessages((current) => [...current, createMessage('assistant', messageText)]);
    }
  }, [navigate, setSelectedYear]);

  const handleChoiceClick = useCallback((choice) => {
    if (!choice?.action) return;
    executeNavigateAction(choice.action, `Apro ${choice.label}.`);
  }, [executeNavigateAction]);

  const submitCommand = useCallback(async (commandText) => {
    const trimmed = String(commandText || '').trim();
    if (!trimmed || loading) return;

    setMessages((current) => [...current, createMessage('user', trimmed)]);
    setInputValue('');
    setLoading(true);

    try {
      const result = await resolveLarixCommand(trimmed, {
        selectedYear,
        loadEmployees,
        loadTeams,
      });

      if (result?.type === 'navigate' && result.action) {
        setMessages((current) => [...current, createMessage('assistant', result.message || 'Ti porto nella schermata richiesta.')]);
        executeNavigateAction(result.action);
        return;
      }

      if (result?.type === 'choice') {
        setMessages((current) => [
          ...current,
          createMessage('assistant', result.message || 'Ho trovato più risultati.', {
            choices: result.choices || [],
          }),
        ]);
        return;
      }

      setMessages((current) => [
        ...current,
        createMessage('assistant', result?.message || 'Non sono riuscito a interpretare il comando.'),
      ]);
    } catch (error) {
      console.error('[larix] command-error', error);
      setMessages((current) => [
        ...current,
        createMessage('assistant', `C'è stato un problema mentre interpretavo il comando: ${error?.message || error}`),
      ]);
    } finally {
      setLoading(false);
    }
  }, [executeNavigateAction, loadEmployees, loadTeams, loading, selectedYear]);

  function handleSubmit(event) {
    event.preventDefault();
    submitCommand(inputValue);
  }

  function handleClearChat() {
    setMessages(INITIAL_MESSAGES);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <section className="larix-panel no-print" aria-label="Larix assistant">
      <header className="larix-panel__header">
        <div>
          <div className="larix-panel__kicker">Assistente GPA</div>
          <h2 className="larix-panel__title">Larix</h2>
        </div>
        <div className="larix-panel__actions">
          <button type="button" className="button-secondary larix-panel__action" onClick={handleClearChat}>
            Svuota
          </button>
          <button type="button" className="button-secondary larix-panel__action" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </header>

      <div className="larix-panel__messages">
        {messages.map((message) => (
          <article
            key={message.id}
            className={`larix-message larix-message--${message.role}`}
          >
            <div className="larix-message__bubble">{message.text}</div>
            {Array.isArray(message.choices) && message.choices.length ? (
              <div className="larix-message__choices">
                {message.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    className="button-secondary larix-choice"
                    onClick={() => handleChoiceClick(choice)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}

        {loading ? (
          <article className="larix-message larix-message--assistant">
            <div className="larix-message__bubble">Sto interpretando il comando...</div>
          </article>
        ) : null}
      </div>

      <div className="larix-panel__quick-prompts">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="larix-quick-prompt"
            onClick={() => submitCommand(prompt)}
            disabled={loading}
          >
            {prompt}
          </button>
        ))}
      </div>

      <form className="larix-panel__composer" onSubmit={handleSubmit}>
        <input
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder='Scrivi un comando, ad esempio: "vai a presenze"'
          disabled={loading}
        />
        <button type="submit" className="button" disabled={loading || !inputValue.trim()}>
          Invia
        </button>
      </form>
    </section>
  );
}

