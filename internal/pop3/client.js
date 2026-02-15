import tls from 'node:tls';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import config from '../../config/index.js';
import logger from '../../pkg/logger.js';
import { Pop3Error } from '../../pkg/errors.js';
import {
  POP3_STATE_DISCONNECTED,
  POP3_STATE_CONNECTED,
  POP3_STATE_AUTHENTICATED,
  POP3_STATE_TRANSACTION,
} from '../../pkg/constants.js';

/**
 * Low-level POP3 client with TLS support, timeout handling, and retry logic.
 * Implements the POP3 protocol (RFC 1939) over TLS (port 995).
 */
export class Pop3Client extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host;
    this.port = options.port || config.pop3.defaultPort;
    this.useTls = options.useTls !== undefined ? options.useTls : config.pop3.tlsEnabled;
    this.username = options.username;
    this.password = options.password;

    this.connectionTimeout = options.connectionTimeout || config.pop3.connectionTimeout;
    this.commandTimeout = options.commandTimeout || config.pop3.commandTimeout;

    this.socket = null;
    this.state = POP3_STATE_DISCONNECTED;
    this._buffer = '';
    this._currentResolve = null;
    this._currentReject = null;
    this._multiline = false;
    this._multilineData = [];
    this._commandTimer = null;
  }

  /**
   * Connect to the POP3 server.
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.socket) this.socket.destroy();
        reject(new Pop3Error(`Connection timeout after ${this.connectionTimeout}ms to ${this.host}:${this.port}`));
      }, this.connectionTimeout);

      const onConnect = () => {
        clearTimeout(timeout);
      };

      const socketOptions = {
        host: this.host,
        port: this.port,
        rejectUnauthorized: false, // Many mail servers use self-signed certs
      };

      if (this.useTls) {
        this.socket = tls.connect(socketOptions, onConnect);
      } else {
        this.socket = net.createConnection(socketOptions, onConnect);
      }

      this.socket.setEncoding('utf8');

      // Wait for the server greeting
      let greeted = false;
      const onData = (data) => {
        if (!greeted) {
          greeted = true;
          clearTimeout(timeout);
          if (data.startsWith('+OK')) {
            this.state = POP3_STATE_CONNECTED;
            this.socket.removeListener('data', onData);
            this._setupDataHandler();
            resolve();
          } else {
            this.socket.destroy();
            reject(new Pop3Error(`POP3 server rejected connection: ${data.trim()}`));
          }
        }
      };

      this.socket.on('data', onData);

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        this.state = POP3_STATE_DISCONNECTED;
        if (!greeted) {
          reject(new Pop3Error(`Connection error: ${err.message}`));
        } else {
          this.emit('error', err);
        }
      });

      this.socket.on('close', () => {
        this.state = POP3_STATE_DISCONNECTED;
        this.emit('close');
      });
    });
  }

  /**
   * Set up the persistent data handler for command/response flow.
   */
  _setupDataHandler() {
    this.socket.on('data', (chunk) => {
      this._buffer += chunk;
      this._processBuffer();
    });
  }

  /**
   * Process buffered data, handling both single-line and multiline responses.
   */
  _processBuffer() {
    if (this._multiline) {
      // Multiline response: collect until we see a line that is just ".\r\n"
      const terminator = '\r\n.\r\n';
      const endIdx = this._buffer.indexOf(terminator);
      if (endIdx !== -1) {
        const data = this._buffer.slice(0, endIdx);
        this._buffer = this._buffer.slice(endIdx + terminator.length);
        this._multiline = false;
        this._clearCommandTimeout();

        // First line is the +OK status, rest is data
        const firstNewline = data.indexOf('\r\n');
        const statusLine = data.slice(0, firstNewline);
        const body = data.slice(firstNewline + 2);

        // Unstuff dot-escaped lines (RFC 1939 section 3)
        const unstuffed = body.replace(/\r\n\.\./g, '\r\n.');

        if (this._currentResolve) {
          this._currentResolve({ status: statusLine, data: unstuffed });
          this._currentResolve = null;
          this._currentReject = null;
        }
      }
    } else {
      // Single-line response
      const newlineIdx = this._buffer.indexOf('\r\n');
      if (newlineIdx !== -1) {
        const line = this._buffer.slice(0, newlineIdx);
        this._buffer = this._buffer.slice(newlineIdx + 2);
        this._clearCommandTimeout();

        if (this._currentResolve) {
          if (line.startsWith('+OK')) {
            this._currentResolve({ status: line, data: null });
          } else if (line.startsWith('-ERR')) {
            const err = new Pop3Error(`POP3 error: ${line}`);
            this._currentReject(err);
          } else {
            this._currentResolve({ status: line, data: null });
          }
          this._currentResolve = null;
          this._currentReject = null;
        }
      }
    }
  }

  /**
   * Send a command to the POP3 server and wait for a response.
   */
  _sendCommand(command, multiline = false) {
    return new Promise((resolve, reject) => {
      if (this.state === POP3_STATE_DISCONNECTED) {
        return reject(new Pop3Error('Not connected to POP3 server'));
      }

      this._currentResolve = resolve;
      this._currentReject = reject;
      this._multiline = multiline;

      this._commandTimer = setTimeout(() => {
        this._currentReject = null;
        this._currentResolve = null;
        reject(new Pop3Error(`Command timeout: ${command.split(' ')[0]}`));
      }, this.commandTimeout);

      this.socket.write(command + '\r\n');
    });
  }

  _clearCommandTimeout() {
    if (this._commandTimer) {
      clearTimeout(this._commandTimer);
      this._commandTimer = null;
    }
  }

  /**
   * Authenticate with USER/PASS.
   */
  async authenticate() {
    const userResp = await this._sendCommand(`USER ${this.username}`);
    if (!userResp.status.startsWith('+OK')) {
      throw new Pop3Error('USER command failed');
    }

    const passResp = await this._sendCommand(`PASS ${this.password}`);
    if (!passResp.status.startsWith('+OK')) {
      throw new Pop3Error('Authentication failed');
    }

    this.state = POP3_STATE_AUTHENTICATED;
    return true;
  }

  /**
   * Get mailbox statistics: { count, size }
   */
  async stat() {
    const resp = await this._sendCommand('STAT');
    const parts = resp.status.split(' ');
    return {
      count: parseInt(parts[1], 10),
      size: parseInt(parts[2], 10),
    };
  }

  /**
   * List all messages: returns array of { num, size }
   */
  async list() {
    const resp = await this._sendCommand('LIST', true);
    if (!resp.data) return [];

    return resp.data
      .split('\r\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [num, size] = line.trim().split(' ');
        return { num: parseInt(num, 10), size: parseInt(size, 10) };
      });
  }

  /**
   * Get UIDL for all messages: returns array of { num, uid }
   */
  async uidl() {
    const resp = await this._sendCommand('UIDL', true);
    if (!resp.data) return [];

    return resp.data
      .split('\r\n')
      .filter((line) => line.trim())
      .map((line) => {
        const spaceIdx = line.trim().indexOf(' ');
        const num = parseInt(line.trim().slice(0, spaceIdx), 10);
        const uid = line.trim().slice(spaceIdx + 1);
        return { num, uid };
      });
  }

  /**
   * Retrieve a single message by its sequence number.
   * Returns the raw RFC 2822 message string.
   */
  async retrieve(msgNum) {
    const resp = await this._sendCommand(`RETR ${msgNum}`, true);
    return resp.data;
  }

  /**
   * Mark a message for deletion.
   */
  async delete(msgNum) {
    await this._sendCommand(`DELE ${msgNum}`);
  }

  /**
   * Reset deletion marks.
   */
  async reset() {
    await this._sendCommand('RSET');
  }

  /**
   * Send NOOP to keep connection alive.
   */
  async noop() {
    await this._sendCommand('NOOP');
  }

  /**
   * Quit and close the connection gracefully.
   */
  async quit() {
    try {
      if (this.state !== POP3_STATE_DISCONNECTED) {
        await this._sendCommand('QUIT');
      }
    } catch {
      // Ignore errors on quit
    } finally {
      this.destroy();
    }
  }

  /**
   * Force-destroy the socket.
   */
  destroy() {
    this._clearCommandTimeout();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.state = POP3_STATE_DISCONNECTED;
  }
}
