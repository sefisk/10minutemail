import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createHash, randomUUID } from 'node:crypto';
import { query } from '../../db/connection.js';
import * as messageRepo from '../../db/repositories/messages.js';
import config from '../../config/index.js';
import logger from '../../pkg/logger.js';

// Cache of local domains (refreshed periodically)
let localDomains = new Map();
let domainRefreshTimer = null;

/**
 * Refresh the in-memory cache of local domains from the database.
 */
export async function refreshLocalDomains() {
  try {
    const result = await query(
      `SELECT domain FROM domains WHERE is_local = true AND is_active = true`
    );
    const newMap = new Map();
    for (const row of result.rows) {
      newMap.set(row.domain.toLowerCase(), true);
    }
    localDomains = newMap;
    logger.debug({ count: newMap.size }, 'Refreshed local domain cache');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh local domain cache');
  }
}

/**
 * Check if a domain is managed locally.
 */
export function isLocalDomain(domain) {
  return localDomains.has(domain.toLowerCase());
}

/**
 * Look up an active inbox by email address.
 * Returns the inbox row or null.
 */
async function findInboxByEmail(emailAddress) {
  const result = await query(
    `SELECT i.id, i.email_address, i.domain_id
     FROM inboxes i
     JOIN domains d ON i.domain_id = d.id
     WHERE LOWER(i.email_address) = LOWER($1)
       AND i.status = 'active'
       AND d.is_local = true
       AND d.is_active = true
     LIMIT 1`,
    [emailAddress]
  );
  return result.rows[0] || null;
}

/**
 * Store a received email into the database for the matching inbox.
 */
async function storeIncomingMessage(inbox, parsed, rawSize) {
  const uid = `smtp-${randomUUID()}`;

  const maxAttachmentBytes = config.inbox.maxAttachmentSizeMb * 1024 * 1024;

  // Extract sender
  const sender = parsed.from?.text || parsed.from?.value?.[0]?.address || '';

  // Extract recipients
  const recipients = [];
  if (parsed.to?.value) {
    for (const addr of parsed.to.value) {
      recipients.push({ address: addr.address, name: addr.name || '' });
    }
  }

  // Extract selected headers
  const headers = {};
  const interestingHeaders = [
    'message-id', 'date', 'from', 'to', 'cc', 'bcc',
    'reply-to', 'content-type', 'x-mailer', 'x-spam-status',
  ];
  for (const key of interestingHeaders) {
    const val = parsed.headers.get(key);
    if (val) {
      headers[key] = typeof val === 'object' && val.text ? val.text : String(val);
    }
  }

  // Process attachments
  const attachments = (parsed.attachments || [])
    .filter((att) => att.size <= maxAttachmentBytes)
    .map((att) => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      sizeBytes: att.size,
      contentId: att.contentId || null,
      checksumSha256: createHash('sha256').update(att.content).digest('hex'),
      content: att.content,
    }));

  const parsedMsg = {
    uid,
    messageId: parsed.messageId || null,
    sender,
    recipients,
    subject: parsed.subject || '',
    textBody: parsed.text || '',
    htmlBody: parsed.html || '',
    headers,
    sizeBytes: rawSize,
    receivedAt: parsed.date || new Date(),
    attachments,
  };

  const stored = await messageRepo.storeMessages(inbox.id, [parsedMsg]);
  return stored;
}

let smtpServer = null;

/**
 * Create and start the built-in SMTP server.
 */
export async function startSmtpServer() {
  if (!config.smtp.enabled) {
    logger.info('Built-in SMTP server is disabled');
    return;
  }

  // Load local domains into cache
  await refreshLocalDomains();

  // Refresh domain cache every 60 seconds
  domainRefreshTimer = setInterval(refreshLocalDomains, 60_000);

  smtpServer = new SMTPServer({
    name: config.smtp.banner,
    banner: config.smtp.banner,
    size: config.smtp.maxMessageSize,
    disabledCommands: ['AUTH', 'STARTTLS'],
    allowInsecureAuth: false,
    authOptional: true,

    // Validate RCPT TO — only accept mail for known local addresses
    async onRcptTo(address, session, callback) {
      const email = address.address;
      const domain = email.split('@')[1];

      if (!domain || !isLocalDomain(domain)) {
        return callback(new Error(`Relay access denied for domain: ${domain}`));
      }

      const inbox = await findInboxByEmail(email);
      if (!inbox) {
        return callback(new Error(`Unknown recipient: ${email}`));
      }

      // Store inbox reference on session for later use
      if (!session.inboxMap) session.inboxMap = new Map();
      session.inboxMap.set(email.toLowerCase(), inbox);

      callback();
    },

    // Process the incoming message data
    onData(stream, session, callback) {
      const chunks = [];
      let totalSize = 0;

      stream.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize <= config.smtp.maxMessageSize) {
          chunks.push(chunk);
        }
      });

      stream.on('end', async () => {
        if (totalSize > config.smtp.maxMessageSize) {
          return callback(new Error('Message exceeds maximum size'));
        }

        const rawBuffer = Buffer.concat(chunks);

        try {
          const parsed = await simpleParser(rawBuffer, {
            maxHtmlLengthToParse: 5 * 1024 * 1024,
          });

          // Deliver to each recipient inbox
          const recipients = session.envelope.rcptTo || [];
          let delivered = 0;

          for (const rcpt of recipients) {
            const email = rcpt.address.toLowerCase();
            const inbox = session.inboxMap?.get(email);
            if (!inbox) continue;

            try {
              await storeIncomingMessage(inbox, parsed, totalSize);
              delivered++;
              logger.info(
                { from: session.envelope.mailFrom?.address, to: email, inboxId: inbox.id },
                'SMTP message delivered'
              );
            } catch (err) {
              logger.error({ err, to: email }, 'Failed to store SMTP message');
            }
          }

          if (delivered === 0) {
            return callback(new Error('Failed to deliver to any recipient'));
          }

          callback();
        } catch (err) {
          logger.error({ err }, 'Failed to parse incoming SMTP message');
          callback(new Error('Message processing failed'));
        }
      });
    },

    // Log connection events
    onConnect(session, callback) {
      logger.debug({ remoteAddress: session.remoteAddress }, 'SMTP connection');
      callback();
    },
  });

  smtpServer.on('error', (err) => {
    logger.error({ err }, 'SMTP server error');
  });

  await new Promise((resolve, reject) => {
    smtpServer.listen(config.smtp.port, config.smtp.host, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  logger.info(
    { port: config.smtp.port, host: config.smtp.host },
    'Built-in SMTP server started'
  );
}

/**
 * Gracefully stop the SMTP server.
 */
export async function stopSmtpServer() {
  if (domainRefreshTimer) {
    clearInterval(domainRefreshTimer);
    domainRefreshTimer = null;
  }
  if (smtpServer) {
    await new Promise((resolve) => smtpServer.close(resolve));
    smtpServer = null;
    logger.info('SMTP server stopped');
  }
}
