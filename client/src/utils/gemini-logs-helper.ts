/**
 * Helper script para trabajar con logs de Gemini desde la consola del navegador
 * 
 * Uso en DevTools Console:
 *   window.geminiLogs.view()         - Ver últimos 10 logs
 *   window.geminiLogs.viewAll()      - Ver todos los logs
 *   window.geminiLogs.summary()      - Ver resumen
 *   window.geminiLogs.clear()        - Limpiar logs
 *   window.geminiLogs.download()     - Descargar archivo
 *   window.geminiLogs.logsDir()      - Ver carpeta de logs
 *   window.geminiLogs.find('race')   - Buscar logs con texto
 */

// Obtener la instancia de GeminiLiveService desde el componente App
function getGeminiService() {
  // @ts-ignore - Acceso temporal para debugging
  return window.__geminiService__;
}

export function setupGeminiLogsHelper(geminiService: any) {
  // @ts-ignore - Exponer globalmente para debugging
  window.__geminiService__ = geminiService;
  
  // @ts-ignore - API de logs
  window.geminiLogs = {
    /**
     * Ver los últimos N logs
     */
    view: (count = 10) => {
      const service = getGeminiService();
      if (!service) {
        console.error('❌ Gemini service not available');
        return;
      }
      
      const logs = service.getSessionLogs();
      const recent = logs.slice(-count);
      
      console.log(`📊 Últimos ${recent.length} logs:`);
      console.table(recent.map((log: any) => ({
        Hora: new Date(log.timestamp).toLocaleTimeString('es-ES'),
        Categoría: log.category,
        Contenido: log.content.substring(0, 60) + '...',
        Longitud: log.content.length
      })));
      
      return recent;
    },
    
    /**
     * Ver todos los logs
     */
    viewAll: () => {
      const service = getGeminiService();
      if (!service) {
        console.error('❌ Gemini service not available');
        return;
      }
      
      const logs = service.getSessionLogs();
      console.log(`📊 Todos los logs (${logs.length}):`);
      console.log(logs);
      return logs;
    },
    
    /**
     * Ver resumen estadístico
     */
    summary: () => {
      const service = getGeminiService();
      if (!service) {
        console.error('❌ Gemini service not available');
        return;
      }
      
      const summary = service.getLogSummary();
      console.log('📊 Resumen de logs:');
      console.table(summary);
      
      const logs = service.getSessionLogs();
      if (logs.length > 0) {
        const categories = logs.reduce((acc: any, log: any) => {
          acc[log.category] = (acc[log.category] || 0) + 1;
          return acc;
        }, {});
        
        console.log('📊 Por categoría:');
        console.table(categories);
      }
      
      return summary;
    },
    
    /**
     * Limpiar todos los logs
     */
    clear: () => {
      const service = getGeminiService();
      if (!service) {
        console.error('❌ Gemini service not available');
        return;
      }
      
      service.clearSessionLogs();
      console.log('🗑️ Logs eliminados');
    },
    
    /**
     * Descargar logs como archivo
     */
    download: () => {
      const service = getGeminiService();
      if (!service) {
        console.error('❌ Gemini service not available');
        return;
      }
      
      service.downloadLogsAsFile();
      console.log('💾 Descargando logs...');
    },
    
    /**
     * Ver directorio de logs
     */
    logsDir: async () => {
      // @ts-ignore
      if (window.electronAPI?.getLogsDirectory) {
        // @ts-ignore
        const dir = await window.electronAPI.getLogsDirectory();
        console.log('📁 Directorio de logs:', dir);
        return dir;
      } else {
        console.log('⚠️ Electron no disponible (modo web)');
        console.log('💡 Los logs se guardan en localStorage como backup');
        return null;
      }
    },
    
    /**
     * Buscar logs que contengan un texto
     */
    find: (searchText: string) => {
      const service = getGeminiService();
      if (!service) {
        console.error('❌ Gemini service not available');
        return;
      }
      
      const logs = service.getSessionLogs();
      const matches = logs.filter((log: any) => 
        log.content.toLowerCase().includes(searchText.toLowerCase()) ||
        log.category.toLowerCase().includes(searchText.toLowerCase())
      );
      
      console.log(`🔍 Encontrados ${matches.length} logs con "${searchText}":`);
      console.table(matches.map((log: any) => ({
        Hora: new Date(log.timestamp).toLocaleTimeString('es-ES'),
        Categoría: log.category,
        Contenido: log.content.substring(0, 80) + '...'
      })));
      
      return matches;
    },
    
    /**
     * Ver log completo por índice
     */
    get: (index: number) => {
      const service = getGeminiService();
      if (!service) {
        console.error('❌ Gemini service not available');
        return;
      }
      
      const logs = service.getSessionLogs();
      const log = logs[index];
      
      if (!log) {
        console.error(`❌ Log ${index} no existe (total: ${logs.length})`);
        return;
      }
      
      console.log('📄 Log completo:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Timestamp: ${log.timestamp}`);
      console.log(`Categoría: ${log.category}`);
      console.log(`Contenido (${log.content.length} caracteres):`);
      console.log(log.content);
      if (log.metadata) {
        console.log('Metadata:', log.metadata);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      return log;
    },
    
    /**
     * Ver ayuda
     */
    help: () => {
      console.log(`
📝 Comandos disponibles para logs de Gemini:

  window.geminiLogs.view(10)         - Ver últimos 10 logs
  window.geminiLogs.viewAll()        - Ver todos los logs
  window.geminiLogs.summary()        - Ver resumen estadístico
  window.geminiLogs.clear()          - Limpiar logs en memoria
  window.geminiLogs.download()       - Descargar como archivo
  window.geminiLogs.logsDir()        - Ver carpeta de guardado
  window.geminiLogs.find('texto')    - Buscar logs
  window.geminiLogs.get(5)           - Ver log completo por índice
  window.geminiLogs.help()           - Ver esta ayuda

💡 Tip: Los logs se guardan automáticamente cada 30s
      `);
    }
  };
  
  console.log('✅ Gemini logs helper loaded. Type window.geminiLogs.help() for commands');
}
