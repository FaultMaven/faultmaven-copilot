/**
 * Production-ready logging system for FaultMaven Copilot
 *
 * Replaces console.log calls with conditional logging based on environment.
 * Only debug logs are suppressed in production; errors are always logged.
 */

/* eslint-disable no-console, no-restricted-syntax */

const IS_DEV = import.meta.env.DEV;
const IS_DEBUG = import.meta.env.VITE_DEBUG === 'true';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger utility with environment-aware output
 */
export const logger = {
  /**
   * Debug logging - only in development or when VITE_DEBUG=true
   * Use for verbose debugging information
   */
  debug(component: string, message: string, data?: any) {
    if (!IS_DEBUG && !IS_DEV) return;

    if (data !== undefined) {
      console.debug(`[${component}]`, message, data);
    } else {
      console.debug(`[${component}]`, message);
    }
  },

  /**
   * Info logging - only in development
   * Use for general informational messages
   */
  info(component: string, message: string, data?: any) {
    if (!IS_DEV) return;

    if (data !== undefined) {
      console.log(`[${component}]`, message, data);
    } else {
      console.log(`[${component}]`, message);
    }
  },

  /**
   * Warning logging - always enabled
   * Use for recoverable issues that need attention
   */
  warn(component: string, message: string, data?: any) {
    if (data !== undefined) {
      console.warn(`[${component}]`, message, data);
    } else {
      console.warn(`[${component}]`, message);
    }
  },

  /**
   * Error logging - always enabled
   * Use for errors and exceptions
   */
  error(component: string, message: string, error?: Error | any) {
    if (error !== undefined) {
      console.error(`[${component}]`, message, error);
    } else {
      console.error(`[${component}]`, message);
    }

    // Future: Send to error tracking service in production
    if (!IS_DEV && error instanceof Error) {
      // TODO: Integrate with Sentry, LogRocket, or similar
      // reportError(component, message, error);
    }
  },

  /**
   * Create a scoped logger for a specific component
   * Returns an object with all log methods pre-bound to the component name
   */
  createScoped(componentName: string) {
    return {
      debug: (message: string, data?: any) => logger.debug(componentName, message, data),
      info: (message: string, data?: any) => logger.info(componentName, message, data),
      warn: (message: string, data?: any) => logger.warn(componentName, message, data),
      error: (message: string, error?: Error | any) => logger.error(componentName, message, error),
    };
  }
};

/**
 * Convenience function for creating scoped loggers
 *
 * @example
 * const log = createLogger('MyComponent');
 * log.debug('Initialized', { count: 5 });
 * log.error('Failed to load', error);
 */
export const createLogger = (componentName: string) => {
  return logger.createScoped(componentName);
};

// Export for backward compatibility
export default logger;
