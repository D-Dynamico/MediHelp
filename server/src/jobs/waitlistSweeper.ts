import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../config/logger.js';
import { sweepWaitlist } from '../modules/waitlist/waitlist.offers.js';

/**
 * Once a minute: lapse offers nobody claimed, and pass each slot on.
 *
 * The sweeper is not what makes an expired offer unclaimable — `claim` checks
 * the clock itself, so an offer is dead the moment its window closes whether
 * or not this has run. What this does is move the slot along. Without it, a
 * freed slot offered to someone who never looked would sit held until the next
 * cancellation happened to nudge the list.
 *
 * On a host that sleeps when idle (Render's free tier) the minute can stretch
 * to however long the host was asleep. The claim-time check is what keeps that
 * safe; the cost is only that the next person hears later.
 */

let task: ScheduledTask | null = null;
let running = false;

export function startWaitlistSweeper(): void {
  if (task) return;

  task = cron.schedule('* * * * *', async () => {
    // A slow sweep must not overlap the next one. Two sweeps working the same
    // lapsed offer are safe — every step is a conditional update — but they
    // double the database work for nothing.
    if (running) return;
    running = true;
    try {
      const { expired, offered } = await sweepWaitlist();
      if (expired > 0 || offered > 0) {
        logger.info('Waitlist sweep', { expired, offered });
      }
    } catch (error) {
      logger.error('Waitlist sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  });

  logger.info('Waitlist sweeper running every minute');
}

export function stopWaitlistSweeper(): void {
  void task?.stop();
  task = null;
}
