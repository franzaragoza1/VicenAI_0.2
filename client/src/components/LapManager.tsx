/**
 * LapManager Component
 * 
 * Modal UI for managing recorded laps - view, select for comparison, and delete.
 * Only shows laps from the current track and car combination.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { lapApi, LapSummary, LapStats, CurrentSession } from '../services/lap-api';

interface LapManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LapManager: React.FC<LapManagerProps> = ({ isOpen, onClose }) => {
  const [laps, setLaps] = useState<LapSummary[]>([]);
  const [stats, setStats] = useState<LapStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Current session info for filtering
  const [currentSession, setCurrentSession] = useState<CurrentSession | null>(null);
  
  // Selection for comparison
  const [selectedLap1, setSelectedLap1] = useState<string>('session_best');
  const [selectedLap2, setSelectedLap2] = useState<string>('last');
  const [compareResult, setCompareResult] = useState<string | null>(null);

  // Fetch current session and laps
  const fetchLaps = useCallback(async () => {
    if (!isOpen) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // First get current session to know track/car
      const session = await lapApi.getCurrentSession();
      setCurrentSession(session);
      
      // Build track name with config if available
      let trackFilter = session.trackName || undefined;
      if (session.trackName && session.trackConfig) {
        trackFilter = `${session.trackName} - ${session.trackConfig}`;
      }
      
      // Fetch laps filtered by current session
      const response = await lapApi.getAllLaps({
        track: trackFilter,
        car: session.carName || undefined,
      });
      setLaps(response.laps);
      setStats(response.stats);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  // Initial fetch and periodic refresh when open
  useEffect(() => {
    if (isOpen) {
      fetchLaps();
      const interval = setInterval(fetchLaps, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, fetchLaps]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Delete a lap
  const handleDelete = async (lapId: string) => {
    try {
      await lapApi.deleteLap(lapId);
      fetchLaps();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Reset session
  const handleReset = async () => {
    if (!confirm('¿Estás seguro de que quieres borrar todas las vueltas?')) {
      return;
    }
    try {
      await lapApi.resetSession();
      fetchLaps();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Handle comparison info
  const handleShowCompareInfo = () => {
    const lap1 = selectedLap1 === 'session_best' ? 'mejor vuelta' : 
                 selectedLap1 === 'last' ? 'última vuelta' : `vuelta ${selectedLap1}`;
    const lap2 = selectedLap2 === 'session_best' ? 'mejor vuelta' : 
                 selectedLap2 === 'last' ? 'última vuelta' : `vuelta ${selectedLap2}`;
    
    setCompareResult(`Para comparar ${lap1} vs ${lap2}, usa el comando de voz:\n"VICEN, compara mi ${lap1} con la ${lap2}"`);
  };

  // Format lap time
  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return '--:--.---';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
  };

  // Format delta
  const formatDelta = (delta: number): string => {
    if (delta === 0) return '--';
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(3)}`;
  };

  // Get dropdown options
  const getDropdownOptions = () => {
    const options = [
      { value: 'session_best', label: '⭐ Session Best' },
      { value: 'last', label: '🏁 Last Lap' },
    ];
    
    laps.forEach(lap => {
      options.push({
        value: lap.id,
        label: `Lap ${lap.lapNumber} (${formatTime(lap.lapTime)})`
      });
    });
    
    return options;
  };

  if (!isOpen) return null;

  // Build session filter display
  const sessionFilterText = currentSession?.trackName && currentSession?.carName
    ? `${currentSession.trackName}${currentSession.trackConfig ? ` (${currentSession.trackConfig})` : ''} • ${currentSession.carName}`
    : 'Sin sesión activa';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="flex flex-col px-6 py-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏁</span>
              <h2 className="text-white font-bold text-xl">Lap Manager</h2>
              <span className="text-gray-400 text-sm">
                {laps.length} laps
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors text-2xl leading-none"
            >
              ×
            </button>
          </div>
          {/* Current session filter indicator */}
          <div className="text-xs text-gray-500 mt-2 flex items-center gap-2">
            <span className="text-blue-400">📍</span>
            <span>{sessionFilterText}</span>
            {!currentSession?.trackName && (
              <span className="text-yellow-500">(mostrando todas las vueltas)</span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(85vh-140px)]">
          {/* Error */}
          {error && (
            <div className="bg-red-900/50 text-red-200 px-4 py-3 rounded-lg mb-4 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* Session Best Banner */}
          {stats?.sessionBestTime && stats.sessionBestTime > 0 && (
            <div className="bg-gradient-to-r from-yellow-900/30 to-yellow-700/10 border border-yellow-600/30 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">⭐</span>
                  <div>
                    <div className="text-yellow-400 font-bold text-sm uppercase tracking-wide">Session Best</div>
                    <div className="text-white text-2xl font-mono font-bold">
                      {formatTime(stats.sessionBestTime)}
                    </div>
                  </div>
                </div>
                <div className="text-gray-400 text-sm">
                  Lap {stats.sessionBestLapNumber}
                </div>
              </div>
            </div>
          )}

          {/* Comparison Section */}
          <div className="bg-gray-800/50 rounded-lg p-4 mb-6">
            <div className="text-sm text-gray-400 mb-3 font-medium">📊 Compare Laps</div>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={selectedLap1}
                onChange={(e) => setSelectedLap1(e.target.value)}
                className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                {getDropdownOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              
              <span className="text-gray-500 font-bold">vs</span>
              
              <select
                value={selectedLap2}
                onChange={(e) => setSelectedLap2(e.target.value)}
                className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                {getDropdownOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              
              <button
                onClick={handleShowCompareInfo}
                disabled={selectedLap1 === selectedLap2 || laps.length === 0}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                📸 Ver cómo comparar
              </button>
            </div>
            
            {compareResult && (
              <div className="mt-3 p-3 bg-blue-900/30 border border-blue-600/30 rounded-lg text-blue-200 text-sm whitespace-pre-line">
                {compareResult}
              </div>
            )}
          </div>

          {/* Laps Table */}
          <div className="bg-gray-800/30 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700 bg-gray-800/50">
                  <th className="text-left py-3 px-4">#</th>
                  <th className="text-left py-3 px-4">Lap</th>
                  <th className="text-left py-3 px-4">Time</th>
                  <th className="text-left py-3 px-4">Delta</th>
                  <th className="text-left py-3 px-4">Points</th>
                  <th className="text-left py-3 px-4">Track</th>
                  <th className="text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && laps.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      Cargando...
                    </td>
                  </tr>
                ) : laps.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-500">
                      <div className="text-4xl mb-2">🏎️</div>
                      <div className="font-medium">No hay vueltas grabadas</div>
                      <div className="text-xs mt-1">Completa una vuelta en pista para empezar a grabar</div>
                    </td>
                  </tr>
                ) : (
                  laps.map((lap, index) => (
                    <tr 
                      key={lap.id} 
                      className={`border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors ${
                        lap.isSessionBest ? 'bg-yellow-900/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-gray-500">
                        {index + 1}
                      </td>
                      <td className="py-3 px-4 text-white font-medium">
                        {lap.isSessionBest && <span className="mr-1">⭐</span>}
                        Lap {lap.lapNumber}
                      </td>
                      <td className="py-3 px-4 font-mono text-white font-bold">
                        {formatTime(lap.lapTime)}
                      </td>
                      <td className={`py-3 px-4 font-mono ${
                        lap.deltaToSessionBest > 0 ? 'text-red-400' : 
                        lap.deltaToSessionBest < 0 ? 'text-green-400' : 'text-gray-500'
                      }`}>
                        {formatDelta(lap.deltaToSessionBest)}
                      </td>
                      <td className="py-3 px-4 text-gray-400">
                        {lap.pointCount}
                      </td>
                      <td className="py-3 px-4 text-gray-400 truncate max-w-[120px]" title={lap.trackName}>
                        {lap.trackName}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!lap.isSessionBest && (
                          <button
                            onClick={() => handleDelete(lap.id)}
                            className="text-red-400 hover:text-red-300 p-1 hover:bg-red-900/30 rounded transition-colors"
                            title="Borrar vuelta"
                          >
                            🗑️
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Actions */}
          {laps.length > 0 && (
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-700">
              <button
                onClick={fetchLaps}
                disabled={loading}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2"
              >
                <span className={loading ? 'animate-spin' : ''}>🔄</span>
                Refresh
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
              >
                🗑️ Borrar todas las vueltas
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LapManager;
