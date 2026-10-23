'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface MonitoredItem {
  id: string;
  title: string;
  url: string;
  source: string;
  description: string | null;
  published_at: string;
  discovered_at: string;
  content_kind: string;
  is_reviewed: boolean;
}

interface MonitorState {
  ticker: string;
  items: MonitoredItem[];
  unreviewed: number;
  total: number;
  state: {
    last_checked_at: string;
    last_successful_check_at: string | null;
  } | null;
}

interface MonitoredResearchProps {
  ticker?: string;
}

export function MonitoredResearch({ ticker }: MonitoredResearchProps) {
  const [state, setState] = useState<MonitorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const initializedRef = useRef(false);

  const fetchMonitored = useCallback(async () => {
    if (!ticker) return;

    try {
      setIsLoading(true);
      const response = await fetch(
        `/api/research/monitor?ticker=${encodeURIComponent(ticker)}&kind=news&limit=20`
      );

      if (!response.ok) {
        throw new Error('Błąd pobierania artykułów');
      }

      const data = await response.json();
      setState(data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [ticker]);

  const runMonitor = useCallback(async () => {
    if (!ticker) return;

    try {
      setIsMonitoring(true);
      setError(null);

      const response = await fetch('/api/research/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Błąd monitorowania');
      }

      const result = await response.json();
      console.log('Monitoring result:', result);

      // Odśwież listę artykułów
      await fetchMonitored();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsMonitoring(false);
    }
  }, [ticker, fetchMonitored]);

  useEffect(() => {
    if (ticker && !initializedRef.current) {
      initializedRef.current = true;
      fetchMonitored();
    }
  }, [ticker, fetchMonitored]);

  if (!ticker) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Monitorowane artykuły</h3>
        <button
          onClick={runMonitor}
          disabled={isMonitoring || isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm"
        >
          {isMonitoring ? 'Monitorowanie...' : 'Sprawdź teraz'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-100 border border-red-300 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="p-4 text-center text-gray-500">Ładowanie...</div>
      )}

      {state && !isLoading && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>
              Znaleziono: <strong>{state.total}</strong>
            </span>
            {state.unreviewed > 0 && (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded">
                {state.unreviewed} nowych
              </span>
            )}
            {state.state?.last_checked_at && (
              <span className="text-xs">
                Ostatnie sprawdzenie:{' '}
                {new Date(state.state.last_checked_at).toLocaleString('pl-PL')}
              </span>
            )}
          </div>

          {state.items.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              Brak znalezionych artykułów. Kliknij &quot;Sprawdź teraz&quot; aby uruchomić monitorowanie.
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto border rounded p-2">
              {state.items.map(item => (
                <article
                  key={item.id}
                  className={`p-3 rounded border ${
                    item.is_reviewed
                      ? 'border-gray-200 bg-white'
                      : 'border-yellow-300 bg-yellow-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-medium text-sm break-words"
                      >
                        {item.title}
                      </a>
                      {item.description && (
                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                          {item.source}
                        </span>
                        <span>
                          {new Date(item.published_at).toLocaleDateString('pl-PL')}
                        </span>
                      </div>
                    </div>
                    {!item.is_reviewed && (
                      <span className="px-2 py-1 bg-yellow-200 text-yellow-900 rounded text-xs font-medium flex-shrink-0">
                        Nowe
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
