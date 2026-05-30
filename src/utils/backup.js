'use strict';

async function runBackupSnapshot() {
  return null;
}

function startBackupScheduler(strapi) {
  strapi.log.info('[backup] Scheduler disabled');
}

module.exports = {
  runBackupSnapshot,
  startBackupScheduler,
};