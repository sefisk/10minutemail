import fastq from 'fastq';
import { pop3Pool } from '../pop3/pool.js';
import { parseMessages } from './parser.js';
import * as inboxRepo from '../../db/repositories/inboxes.js';
import * as messageRepo from '../../db/repositories/messages.js';
import logger from '../../pkg/logger.js';
import config from '../../config/index.js';

/**
 * Worker queue for concurrent POP3 message fetching.
 * Uses fastq for bounded async concurrency.
 */

const WORKER_CONCURRENCY = config.pop3.maxConcurrentConnections;

/**
 * Process a single fetch-mail job.
 * @param {{ inboxId: string, sinceUid?: string, limit?: number }} job
 */
async function fetchMailWorker(job) {
  const { inboxId, sinceUid, limit } = job;

  logger.info({ inboxId, sinceUid }, 'Fetching new mail from POP3');

  // Get decrypted credentials
  const credentials = await inboxRepo.getInboxCredentials(inboxId);

  // Connect and retrieve new messages
  const rawMessages = await pop3Pool.execute(credentials, async (client) => {
    // Get UIDs
    const uidList = await client.uidl();
    if (uidList.length === 0) return [];

    // Filter: only UIDs after sinceUid
    let newEntries = uidList;
    if (sinceUid) {
      const sinceIdx = uidList.findIndex((e) => e.uid === sinceUid);
      if (sinceIdx !== -1) {
        newEntries = uidList.slice(sinceIdx + 1);
      }
      // If sinceUid not found, fetch all (first time or UID reset)
    }

    // Apply limit
    const fetchLimit = Math.min(limit || config.inbox.maxMessageFetch, config.inbox.maxMessageFetch);
    const toFetch = newEntries.slice(0, fetchLimit);

    if (toFetch.length === 0) return [];

    // Retrieve raw messages
    const results = [];
    for (const entry of toFetch) {
      try {
        const raw = await client.retrieve(entry.num);
        results.push({ raw, uid: entry.uid });
      } catch (err) {
        logger.error({ err, inboxId, uid: entry.uid, msgNum: entry.num }, 'Failed to retrieve message');
        // Skip failed messages, continue with others
      }
    }

    return results;
  });

  if (rawMessages.length === 0) {
    logger.info({ inboxId }, 'No new messages found');
    return [];
  }

  // Parse messages
  const parsed = await parseMessages(rawMessages);

  // Store in database
  const stored = await messageRepo.storeMessages(inboxId, parsed);

  // Update last_seen_uid to the latest fetched UID
  if (rawMessages.length > 0) {
    const lastUid = rawMessages[rawMessages.length - 1].uid;
    await inboxRepo.updateLastSeenUid(inboxId, lastUid);
  }

  logger.info({ inboxId, fetched: rawMessages.length, stored: stored.length }, 'Mail fetch complete');

  return stored;
}

// Create the bounded worker queue
const mailQueue = fastq.promise(fetchMailWorker, WORKER_CONCURRENCY);

/**
 * Enqueue a mail fetch job. Returns a promise that resolves with stored messages.
 */
export function enqueueFetch({ inboxId, sinceUid, limit }) {
  return mailQueue.push({ inboxId, sinceUid, limit });
}

/**
 * Get queue statistics.
 */
export function queueStats() {
  return {
    concurrency: mailQueue.concurrency,
    running: mailQueue.running(),
    idle: mailQueue.idle(),
    length: mailQueue.length(),
  };
}
