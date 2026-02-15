import config from '../../config/index.js';
import logger from '../../pkg/logger.js';
import { Pop3Client } from './client.js';
import { Pop3Error } from '../../pkg/errors.js';

/**
 * Manages POP3 connections with concurrency limits, retry logic,
 * and provider throttling protection.
 */
export class Pop3Pool {
  constructor() {
    this.maxConcurrent = config.pop3.maxConcurrentConnections;
    this.maxRetries = config.pop3.maxRetries;
    this.retryDelay = config.pop3.retryDelayMs;
    this._active = 0;
    this._queue = [];
    this._providerThrottles = new Map(); // host -> { until: Date }
  }

  /**
   * Acquire a connection slot (respects concurrency limit).
   * Returns a release function.
   */
  async _acquireSlot() {
    if (this._active < this.maxConcurrent) {
      this._active++;
      return () => {
        this._active--;
        this._drainQueue();
      };
    }

    // Wait for a slot
    return new Promise((resolve) => {
      this._queue.push(() => {
        this._active++;
        resolve(() => {
          this._active--;
          this._drainQueue();
        });
      });
    });
  }

  _drainQueue() {
    if (this._queue.length > 0 && this._active < this.maxConcurrent) {
      const next = this._queue.shift();
      next();
    }
  }

  /**
   * Check if a provider is throttled.
   */
  _isThrottled(host) {
    const throttle = this._providerThrottles.get(host);
    if (throttle && throttle.until > Date.now()) {
      return true;
    }
    this._providerThrottles.delete(host);
    return false;
  }

  /**
   * Mark a provider as throttled for a duration.
   */
  _throttleProvider(host, durationMs = 30000) {
    this._providerThrottles.set(host, { until: Date.now() + durationMs });
    logger.warn({ host, durationMs }, 'Provider throttled');
  }

  /**
   * Execute a POP3 operation with retry logic, concurrency control,
   * and provider throttling.
   *
   * @param {object} credentials - { host, port, useTls, username, password }
   * @param {function} operation - async (client) => result
   * @returns {Promise<any>}
   */
  async execute(credentials, operation) {
    const { host } = credentials;

    if (this._isThrottled(host)) {
      throw new Pop3Error(`Provider ${host} is temporarily throttled, try again later`);
    }

    const releaseSlot = await this._acquireSlot();
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const client = new Pop3Client(credentials);
      try {
        await client.connect();
        await client.authenticate();
        const result = await operation(client);
        await client.quit();
        releaseSlot();
        return result;
      } catch (err) {
        lastError = err;
        client.destroy();

        logger.warn(
          { host, attempt, maxRetries: this.maxRetries, error: err.message },
          'POP3 operation failed, retrying'
        );

        // Detect throttling indicators
        if (
          err.message.includes('too many connections') ||
          err.message.includes('login rate') ||
          err.message.includes('try again later')
        ) {
          this._throttleProvider(host);
          break;
        }

        if (attempt < this.maxRetries) {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    releaseSlot();
    throw new Pop3Error(
      `POP3 operation failed after ${this.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Get pool stats for monitoring.
   */
  stats() {
    return {
      activeConnections: this._active,
      maxConcurrent: this.maxConcurrent,
      queuedRequests: this._queue.length,
      throttledProviders: Array.from(this._providerThrottles.entries()).map(([host, t]) => ({
        host,
        until: new Date(t.until).toISOString(),
      })),
    };
  }
}

// Singleton pool instance
export const pop3Pool = new Pop3Pool();
