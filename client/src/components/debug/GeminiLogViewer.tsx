import { useState, useEffect } from 'react';

interface GeminiLogEntry {
  timestamp: string;
  type: 'sent' | 'received' | 'error' | 'tool' | 'event';
  category: string;
  content: string;
  metadata?: Record<string, any>;
}

interface Props {
  geminiService: any;
  isOpen: boolean;
  onClose: () => void;
}

export function GeminiLogViewer({ geminiService, isOpen, onClose }: Props) {
  const [logs, setLogs] = useState<GeminiLogEntry[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState(true);

  // Actualizar logs cada segundo
  useEffect(() => {
    if (!isOpen || !geminiService) return;

    const interval = setInterval(() => {
      const currentLogs = geminiService.getSessionLogs();
      setLogs(currentLogs);
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, geminiService]);

  // ESC key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-scroll al final
  useEffect(() => {
    if (autoScroll && logs.length > 0) {
      const element = document.getElementById('log-list-end');
      element?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, autoScroll]);

  if (!isOpen) return null;

  const filteredLogs = logs.filter(log => {
    if (filter !== 'all' && log.type !== filter) return false;
    if (search && !log.content.toLowerCase().includes(search.toLowerCase()) 
        && !log.category.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const summary = geminiService?.getLogSummary() || { total: 0, sent: 0, received: 0, errors: 0, tools: 0, events: 0 };

  const typeColors = {
    sent: 'bg-blue-500',
    received: 'bg-green-500',
    error: 'bg-red-500',
    tool: 'bg-yellow-500',
    event: 'bg-purple-500',
  };

  const typeEmoji = {
    sent: '📤',
    received: '📥',
    error: '❌',
    tool: '🔧',
    event: '🎯',
  };

  const handleExport = () => {
    const json = geminiService?.exportLogsAsJson();
    if (json) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gemini-logs-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleClear = () => {
    if (confirm('¿Borrar todos los logs de la sesión?')) {
      geminiService?.clearSessionLogs();
      setLogs([]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-lg w-full max-w-7xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-white">📝 Gemini Debug Logs</h2>
            <div className="flex gap-2 text-sm">
              <span className="px-2 py-1 bg-gray-800 rounded text-white">
                Total: {summary.total}
              </span>
              <span className="px-2 py-1 bg-blue-900 rounded text-white">
                📤 {summary.sent}
              </span>
              <span className="px-2 py-1 bg-green-900 rounded text-white">
                📥 {summary.received}
              </span>
              <span className="px-2 py-1 bg-yellow-900 rounded text-white">
                🔧 {summary.tools}
              </span>
              <span className="px-2 py-1 bg-red-900 rounded text-white">
                ❌ {summary.errors}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
          >
            ✕ Cerrar
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 p-4 border-b border-gray-700">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-600"
          >
            <option value="all">Todos los tipos</option>
            <option value="sent">📤 Enviados</option>
            <option value="received">📥 Recibidos</option>
            <option value="tool">🔧 Tools</option>
            <option value="event">🎯 Eventos</option>
            <option value="error">❌ Errores</option>
          </select>

          <input
            type="text"
            placeholder="Buscar en contenido o categoría..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-800 text-white rounded border border-gray-600"
          />

          <label className="flex items-center gap-2 text-white">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="w-4 h-4"
            />
            Auto-scroll
          </label>

          <button
            onClick={handleExport}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white"
          >
            💾 Exportar JSON
          </button>

          <button
            onClick={handleClear}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-white"
          >
            🗑️ Limpiar
          </button>
        </div>

        {/* Logs List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredLogs.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {logs.length === 0 ? 'No hay logs aún. Espera a que comience la sesión.' : 'No se encontraron logs con los filtros actuales.'}
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              const time = new Date(log.timestamp).toLocaleTimeString('es-ES', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit',
                fractionalSecondDigits: 3 
              });

              return (
                <div
                  key={index}
                  className="bg-gray-800 rounded p-3 border-l-4"
                  style={{ borderLeftColor: typeColors[log.type] }}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{typeEmoji[log.type]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-400 font-mono">{time}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${typeColors[log.type]}`}>
                          {log.type.toUpperCase()}
                        </span>
                        <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-white">
                          {log.category}
                        </span>
                      </div>
                      <div className="text-sm text-white whitespace-pre-wrap break-words">
                        {log.content}
                      </div>
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                            Metadata ({Object.keys(log.metadata).length} campos)
                          </summary>
                          <pre className="mt-1 text-xs text-gray-400 bg-gray-900 p-2 rounded overflow-x-auto">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div id="log-list-end"></div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 text-sm text-gray-400">
          Mostrando {filteredLogs.length} de {logs.length} logs
          {search && ` (filtrado por "${search}")`}
        </div>
      </div>
    </div>
  );
}
