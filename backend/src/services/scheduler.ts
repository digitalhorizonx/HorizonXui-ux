import cron from 'node-cron';
import { runOverviewSync, runClientContextSync } from './syncService';
import { runNightlyProfileUpdates } from './profileService';
import { exportAllProfiles, exportManagerProfile } from './exportService';
import { runProposalEngine } from './proposalEngine';
import { updateManagerProfileWithAi } from './managerProfileService';
import { runSelfImprovementEngine } from './selfImprovementEngine';

/**
 * In-process scheduler (spec §3): node-cron, no external queue.
 * - Overview sync daily at 07:30 Asia/Amman
 * - Per-client context sync nightly at 02:00 Asia/Amman
 * - AI profile updates nightly at 03:00 (after fresh context)
 * - Manager (Abdulla) profile update nightly at 03:10, from the day's decisions
 * - Profile auto-export nightly at 03:30 (after profile updates)
 * - Proposal engine at 07:45, after the morning sync (spec Phase 3.1)
 * - Self-improvement analysis weekly, Monday 08:00 (after the morning proposal run)
 */
export function startScheduler(): void {
  cron.schedule('30 7 * * *', () => void runOverviewSync(), { timezone: 'Asia/Amman' });
  cron.schedule('0 2 * * *', () => void runClientContextSync(), { timezone: 'Asia/Amman' });
  cron.schedule('0 3 * * *', () => void runNightlyProfileUpdates(), { timezone: 'Asia/Amman' });
  cron.schedule('10 3 * * *', () => void updateManagerProfileWithAi(), { timezone: 'Asia/Amman' });
  cron.schedule(
    '30 3 * * *',
    () => void exportAllProfiles().then(() => exportManagerProfile()),
    { timezone: 'Asia/Amman' }
  );
  cron.schedule('45 7 * * *', () => void runProposalEngine(), { timezone: 'Asia/Amman' });
  cron.schedule('0 8 * * 1', () => void runSelfImprovementEngine(), { timezone: 'Asia/Amman' });
  console.log(
    'Scheduler started (Asia/Amman): overview 07:30, context 02:00, profiles 03:00, manager profile 03:10, export 03:30, proposals 07:45, self-improvement Mon 08:00'
  );
}
