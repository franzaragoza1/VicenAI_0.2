import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface HttpResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export const httpClient = {
  async get<T = any>(endpoint: string): Promise<HttpResponse<T>> {
    const url = `${config.serverBaseUrl}${endpoint}`;

    try {
      logger.debug(`HTTP GET ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        const error = `HTTP ${response.status} ${response.statusText}`;
        logger.warn(`Request failed: ${error}`);
        return { success: false, error };
      }

      const data = await response.json();
      logger.debug(`Request successful: ${url}`);
      return { success: true, data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Request error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }
};
