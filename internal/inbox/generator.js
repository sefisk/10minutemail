import { randomBytes, randomInt } from 'node:crypto';
import config from '../../config/index.js';

const PASSWORD_LENGTH = 15;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Word pools for generating realistic-looking email local parts.
 * Combined randomly to produce addresses like: sarah.mitchell42, jthompson.dev, mark_riley88
 */
const FIRST_NAMES = [
  'james', 'mary', 'john', 'sarah', 'robert', 'emma', 'michael', 'olivia',
  'david', 'sophia', 'daniel', 'isabella', 'matthew', 'mia', 'joseph', 'charlotte',
  'andrew', 'amelia', 'ryan', 'harper', 'brandon', 'evelyn', 'tyler', 'abigail',
  'kevin', 'emily', 'jason', 'elizabeth', 'mark', 'avery', 'brian', 'ella',
  'chris', 'scarlett', 'alex', 'grace', 'nick', 'chloe', 'jake', 'victoria',
  'luke', 'riley', 'adam', 'aria', 'eric', 'lily', 'sean', 'zoey', 'tom', 'nora',
  'peter', 'hannah', 'kyle', 'leah', 'sam', 'stella', 'ben', 'natalie',
  'carl', 'lucy', 'derek', 'maya', 'frank', 'ruby', 'george', 'iris',
];

const LAST_NAMES = [
  'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis',
  'rodriguez', 'martinez', 'hernandez', 'lopez', 'wilson', 'anderson', 'thomas',
  'taylor', 'moore', 'jackson', 'martin', 'lee', 'perez', 'thompson', 'white',
  'harris', 'clark', 'lewis', 'robinson', 'walker', 'young', 'allen', 'king',
  'wright', 'scott', 'torres', 'nguyen', 'hill', 'flores', 'green', 'adams',
  'nelson', 'baker', 'hall', 'rivera', 'campbell', 'mitchell', 'carter', 'roberts',
  'turner', 'phillips', 'evans', 'parker', 'collins', 'edwards', 'stewart', 'reed',
  'cook', 'morgan', 'bell', 'murphy', 'bailey', 'cooper', 'richardson', 'cox',
];

const WORDS = [
  'pixel', 'nova', 'echo', 'drift', 'pulse', 'byte', 'cloud', 'spark',
  'wave', 'flux', 'core', 'node', 'data', 'sync', 'link', 'code',
  'grid', 'hub', 'net', 'dev', 'lab', 'sys', 'ops', 'arc',
  'zen', 'pro', 'ace', 'max', 'neo', 'blue', 'red', 'sky',
];

/**
 * Separators used between name parts.
 */
const SEPARATORS = ['.', '_', ''];

function pick(arr) {
  return arr[randomInt(arr.length)];
}

function randomDigits(min, max) {
  return String(randomInt(min, max + 1));
}

/**
 * Generate a realistic-looking random email local part.
 * Produces varied patterns like:
 *   sarah.mitchell42
 *   jthompson_dev
 *   alex.rivera
 *   mark88
 *   emma.cloud99
 *   klewis.pro
 */
function generateLocalPart() {
  const pattern = randomInt(8);

  switch (pattern) {
    case 0: {
      // firstname.lastname + optional digits: sarah.mitchell42
      const sep = pick(SEPARATORS);
      const digits = randomInt(2) === 0 ? randomDigits(1, 99) : '';
      return `${pick(FIRST_NAMES)}${sep}${pick(LAST_NAMES)}${digits}`;
    }
    case 1: {
      // first-initial + lastname: jthompson, mgarcia
      const first = pick(FIRST_NAMES);
      const digits = randomInt(3) === 0 ? randomDigits(1, 999) : '';
      return `${first[0]}${pick(LAST_NAMES)}${digits}`;
    }
    case 2: {
      // firstname + digits: emma88, alex2024
      const year = randomInt(2) === 0 ? randomDigits(80, 99) : randomDigits(2000, 2026);
      return `${pick(FIRST_NAMES)}${year}`;
    }
    case 3: {
      // firstname.word: mark.dev, sarah.cloud
      const sep = pick(SEPARATORS);
      const digits = randomInt(3) === 0 ? randomDigits(1, 99) : '';
      return `${pick(FIRST_NAMES)}${sep}${pick(WORDS)}${digits}`;
    }
    case 4: {
      // lastname.firstname: thompson.james
      const sep = pick(SEPARATORS);
      return `${pick(LAST_NAMES)}${sep}${pick(FIRST_NAMES)}${randomInt(2) === 0 ? randomDigits(1, 99) : ''}`;
    }
    case 5: {
      // word + lastname: pixel.smith, nova_jones
      const sep = pick(SEPARATORS);
      const digits = randomInt(3) === 0 ? randomDigits(1, 99) : '';
      return `${pick(WORDS)}${sep}${pick(LAST_NAMES)}${digits}`;
    }
    case 6: {
      // firstname + lastname initial + digits: sarahm42
      const last = pick(LAST_NAMES);
      return `${pick(FIRST_NAMES)}${last[0]}${randomDigits(1, 999)}`;
    }
    case 7: {
      // two words + digits: echo.pulse77
      const sep = pick(SEPARATORS);
      return `${pick(WORDS)}${sep}${pick(WORDS)}${randomDigits(1, 99)}`;
    }
    default: {
      return `${pick(FIRST_NAMES)}${pick(SEPARATORS)}${pick(LAST_NAMES)}${randomDigits(1, 99)}`;
    }
  }
}

/**
 * Generate a unique inbox email address and local credentials
 * for Mode B (system-generated) inboxes.
 *
 * @param {string} [domain] - Override domain (for admin bulk generation with specific domain)
 * @param {object} [domainConfig] - Override POP3 settings from a domain record
 */
export function generateInboxAddress(domain, domainConfig) {
  const localPart = generateLocalPart();
  const targetDomain = domain || config.generatedInbox.domain;
  const emailAddress = `${localPart}@${targetDomain}`;

  // Generate a 15-char alphanumeric password
  const bytes = randomBytes(PASSWORD_LENGTH);
  let password = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    password += CHARSET[bytes[i] % CHARSET.length];
  }

  return {
    emailAddress,
    username: localPart,
    password,
    pop3Host: domainConfig?.pop3_host || domainConfig?.pop3Host || config.generatedInbox.pop3Host,
    pop3Port: domainConfig?.pop3_port || domainConfig?.pop3Port || config.generatedInbox.pop3Port,
    useTls: domainConfig?.pop3_tls !== undefined ? domainConfig.pop3_tls : config.generatedInbox.useTls,
  };
}

/**
 * Generate multiple inbox addresses at once (for admin bulk generation).
 * Distributes across provided domains round-robin style.
 *
 * @param {number} count - Number of inboxes to generate
 * @param {Array} domains - Array of domain records from DB
 * @returns {Array<{emailAddress, username, password, pop3Host, pop3Port, useTls, domainId}>}
 */
export function generateBulkInboxAddresses(count, domains) {
  const results = [];
  for (let i = 0; i < count; i++) {
    // Round-robin across provided domains
    const domainRecord = domains[i % domains.length];
    const generated = generateInboxAddress(domainRecord.domain, domainRecord);
    results.push({
      ...generated,
      domainId: domainRecord.id,
    });
  }
  return results;
}

/**
 * Validate an external POP3 configuration.
 */
export function validateExternalPop3(params) {
  const errors = [];

  if (!params.email_address || !params.email_address.includes('@')) {
    errors.push('Valid email_address is required');
  }
  if (params.email_address && params.email_address.length > 320) {
    errors.push('email_address must be 320 characters or fewer');
  }

  if (!params.pop3_host || typeof params.pop3_host !== 'string') {
    errors.push('pop3_host is required');
  }
  if (params.pop3_host && params.pop3_host.length > 255) {
    errors.push('pop3_host must be 255 characters or fewer');
  }
  // Prevent SSRF: block private/reserved IPs in production
  if (params.pop3_host) {
    const host = params.pop3_host.toLowerCase();
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.'];
    if (config.env === 'production' && blocked.some((b) => host.startsWith(b))) {
      errors.push('pop3_host cannot be a private/loopback address');
    }
  }

  if (params.pop3_port !== undefined) {
    const port = parseInt(params.pop3_port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push('pop3_port must be between 1 and 65535');
    }
  }

  if (!params.pop3_username || typeof params.pop3_username !== 'string') {
    errors.push('pop3_username is required');
  }

  if (!params.pop3_password || typeof params.pop3_password !== 'string') {
    errors.push('pop3_password is required');
  }

  return errors;
}
