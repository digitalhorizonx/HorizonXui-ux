import cron from 'node-cron';
import { runOverviewSync, runClientContextSync } from './syncService';

/**
 * In-process scheduler (spec §3): node-cron, no external queue.
 * - Overview sync daily at 07:30 Asia/Amman
 * - Per-client context sync nightly at 02:00 Asia/Amman
 */
export function startScheduler(): void {
  cron.schedule('30 7 * * *', () => void runOverviewSync(), { timezone: 'Asia/Amman' });
  cron.schedule('0 2 * * *', () => void runClientContextSync(), { timezone: 'Asia/Amman' });
  console.log('Scheduler started: overview 07:30, client context 02:00 (Asia/Amman)');
}
