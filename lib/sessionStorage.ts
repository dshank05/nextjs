/**
 * Common sessionStorage service for caching view data across edit operations
 */

export class SessionStorageService {
  private static getKey(module: string, id: string | number): string {
    return `${module}-view-${id}`;
  }

  /**
   * Get cached data for a specific module and ID
   */
  static get<T = any>(module: string, id: string | number): T | null {
    try {
      if (typeof window === 'undefined') return null;

      const key = this.getKey(module, id);
      const data = sessionStorage.getItem(key);

      if (!data) return null;

      return JSON.parse(data) as T;
    } catch (error) {
      console.error('Error reading from sessionStorage:', error);
      return null;
    }
  }

  /**
   * Store data in sessionStorage for a specific module and ID
   */
  static set<T = any>(module: string, id: string | number, data: T): void {
    try {
      if (typeof window === 'undefined') return;

      const key = this.getKey(module, id);
      sessionStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('Error writing to sessionStorage:', error);
    }
  }

  /**
   * Remove cached data for a specific module and ID
   */
  static remove(module: string, id: string | number): void {
    try {
      if (typeof window === 'undefined') return;

      const key = this.getKey(module, id);
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing from sessionStorage:', error);
    }
  }

  /**
   * Check if data exists for a specific module and ID
   */
  static exists(module: string, id: string | number): boolean {
    try {
      if (typeof window === 'undefined') return false;

      const key = this.getKey(module, id);
      return sessionStorage.getItem(key) !== null;
    } catch (error) {
      console.error('Error checking sessionStorage:', error);
      return false;
    }
  }

  /**
   * Clear all cached data for a specific module
   */
  static clearModule(module: string): void {
    try {
      if (typeof window === 'undefined') return;

      const prefix = `${module}-view-`;
      const keysToRemove: string[] = [];

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => sessionStorage.removeItem(key));
    } catch (error) {
      console.error('Error clearing module from sessionStorage:', error);
    }
  }
}

// Export default instance for convenience
export default SessionStorageService;
