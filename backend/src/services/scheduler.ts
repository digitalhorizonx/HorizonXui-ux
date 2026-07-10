import cron from 'node-cron';
import { runOverviewSync, runClientContextSync } from './syncService';
import { runNightlyProfileUpdates } from './profileService';
import { exportAllProfiles } from './exportService';

/**
 * In-process scheduler (spec §3): node-cron, no external queue.
 * - Overview sync daily at 07:30 Asia/Amman
 * - Per-client context sync nightly at 02:00 Asia/Amman
 * - AI profile updates nightly at 03:00 (after fresh context)
 * - Profile auto-export nightly at 03:30 (after profile updates)
 */
export function startScheduler(): void {
  cron.schedule('30 7 * * *', () => void runOverviewSync(), { timezone: 'Asia/Amman' });
  cron.schedule('0 2 * * *', () => void runClientContextSync(), { timezone: 'Asia/Amman' });
  cron.schedule('0 3 * * *', () => void runNightlyProfileUpdates(), { timezone: 'Asia/Amman' });
  cron.schedule('30 3 * * *', () => void exportAllProfiles(), { timezone: 'Asia/Amman' });
  console.log(
    'Scheduler started (Asia/Amman): overview 07:30, context 02:00, profiles 03:00, export 03:30'
  );
}
