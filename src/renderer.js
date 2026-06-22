import { initAuthAndSettings } from './auth.js';
import { initScannerController, getScannedFilesSelection } from './scanner.js';
import { initTransferController, loadLastResults } from './transfer.js';

// --- TAB NAVIGATION SYSTEM ---
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

export function switchTab(tabId) {
  // Deactivate all nav buttons and views
  navItems.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.classList.remove('active');
      btn.removeAttribute('aria-current');
    }
  });

  tabContents.forEach(section => {
    if (section.id === `tab-${tabId}`) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });
}

function initNavigation() {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (item.hasAttribute('disabled')) return;
      const tabId = item.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
}

async function checkForCheckpoint() {
  const checkpointBanner = document.getElementById('checkpoint-banner');
  const checkpointBannerText = document.getElementById('checkpoint-banner-text');
  const btnResumeCheckpoint = document.getElementById('btn-resume-checkpoint');
  const btnDiscardCheckpoint = document.getElementById('btn-discard-checkpoint');

  try {
    const checkpoint = await window.api.getResumeCheckpoint();
    if (checkpoint.exists) {
      checkpointBannerText.innerHTML = `Interrupted transfer detected: <strong>${checkpoint.completedCount} of ${checkpoint.totalFiles}</strong> files completed.`;
      checkpointBanner.classList.remove('hidden');

      btnResumeCheckpoint.onclick = async () => {
        checkpointBanner.classList.add('hidden');
        try {
          // Trigger actual transfer using resume flag
          await window.api.startTransfer(checkpoint.sourceId, checkpoint.destId, {}, [], true);
        } catch (err) {
          console.error('Failed to resume transfer:', err);
          alert('Resume failed: ' + err.message);
        }
      };

      btnDiscardCheckpoint.onclick = async () => {
        if (confirm('Are you sure you want to discard the interrupted transfer state? You will have to scan again.')) {
          await window.api.clearResumeCheckpoint();
          checkpointBanner.classList.add('hidden');
        }
      };
    }
  } catch (err) {
    console.error('Error checking for resume checkpoint:', err);
  }
}

// --- INITIALIZE APPLICATION ---
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize tabs navigation
  initNavigation();

  // 2. Initialize Auth & Settings
  // Define callback when verification paths complete
  const onPathsVerified = () => {
    // Enable Scan Tab
    const navScan = document.getElementById('nav-scan');
    navScan.removeAttribute('disabled');
    switchTab('scan');
  };

  await initAuthAndSettings(onPathsVerified);

  // Check for interrupted transfer checkpoints
  await checkForCheckpoint();

  // 3. Initialize Scanner Controller
  // Define callback when scanning starts, switches navigation, etc.
  initScannerController();

  initTransferController(() => {
    const navTransfer = document.getElementById('nav-transfer');
    navTransfer.removeAttribute('disabled');
    switchTab('transfer');
  });

  // Load last results snapshot if present
  await loadLastResults();

  // 5. Bind Transfer Launch and Confirm actions
  const btnStartTransfer = document.getElementById('btn-start-transfer');
  const btnStartDryRun = document.getElementById('btn-start-dry-run');
  const btnConfirmMigration = document.getElementById('btn-confirm-migration');

  async function executeMigration() {
    btnStartTransfer.disabled = true;
    btnConfirmMigration.classList.add('hidden');
    
    try {
      const { sourceId, destId, selectionMap, filesList } = getScannedFilesSelection();
      
      // Trigger IPC call to start migration queue
      await window.api.startTransfer(sourceId, destId, selectionMap, filesList);
    } catch (err) {
      console.error('Migration start failed:', err);
      alert('Failed to start migration: ' + err.message);
    } finally {
      btnStartTransfer.disabled = false;
    }
  }

  btnStartTransfer.addEventListener('click', executeMigration);
  btnConfirmMigration.addEventListener('click', executeMigration);

  btnStartDryRun.addEventListener('click', async () => {
    btnStartDryRun.disabled = true;
    
    try {
      const { sourceId, destId, selectionMap, filesList } = getScannedFilesSelection();
      
      // Trigger IPC call to start dry-run queue
      await window.api.startDryRun(sourceId, destId, selectionMap, filesList);
    } catch (err) {
      console.error('Dry-run start failed:', err);
      alert('Failed to start dry-run: ' + err.message);
    } finally {
      btnStartDryRun.disabled = false;
    }
  });
});
