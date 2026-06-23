import { verifiedSourceId } from './auth.js';
import { getScannedFilesSelection } from './scanner.js';

// --- DOM ELEMENTS ---
const listerIdInput = document.getElementById('lister-id-input');
const btnStartListerScan = document.getElementById('btn-start-lister-scan');
const listerProgressCard = document.getElementById('lister-progress-card');
const listerProgressStatus = document.getElementById('lister-progress-status');
const listerProgressDetail = document.getElementById('lister-progress-detail');
const btnCancelListerScan = document.getElementById('btn-cancel-lister-scan');
const listerOverallBar = document.getElementById('lister-overall-bar');
const listerFilesCount = document.getElementById('lister-files-count');
const listerStatusText = document.getElementById('lister-status-text');

// New selector components
const listerTabToggleCustom = document.getElementById('lister-tab-toggle-custom');
const listerTabToggleList = document.getElementById('lister-tab-toggle-list');
const listerFormCustomId = document.getElementById('lister-form-custom-id');
const listerFormListSelect = document.getElementById('lister-form-list-select');
const listerDriveListSelect = document.getElementById('lister-drive-list-select');
const btnStartListerScanList = document.getElementById('btn-start-lister-scan-list');

// Completed actions elements
const listerCompletedActions = document.getElementById('lister-completed-actions');
const btnRevealFile = document.getElementById('btn-reveal-file');
const btnRevealFileText = document.getElementById('btn-reveal-file-text');
const btnOpenFile = document.getElementById('btn-open-file');

// Nav tabs control access
const navConnect = document.querySelector('[data-tab="connect"]');
const navScan = document.querySelector('[data-tab="scan"]');
const navTransfer = document.querySelector('[data-tab="transfer"]');
const navSettings = document.querySelector('[data-tab="settings"]');
const navLister = document.querySelector('[data-tab="lister"]');

let lastExportedFilePath = null;
let isNavLocked = false;

// --- EXPORTED FUNCTIONS ---

export function initListerController() {
  // Adjust reveal button text based on platform
  try {
    const platform = window.api.getPlatform();
    if (platform === 'win32') {
      btnRevealFileText.innerText = 'Reveal in File Explorer';
    } else {
      btnRevealFileText.innerText = 'Reveal in Finder';
    }
  } catch (err) {
    console.error('Failed to get platform:', err);
    if (navigator.userAgent.toLowerCase().includes('win')) {
      btnRevealFileText.innerText = 'Reveal in File Explorer';
    } else {
      btnRevealFileText.innerText = 'Reveal in Finder';
    }
  }

  // Bind click events for reveal/open completed buttons
  btnRevealFile.addEventListener('click', async () => {
    if (lastExportedFilePath) {
      await window.api.showItemInFolder(lastExportedFilePath);
    }
  });

  btnOpenFile.addEventListener('click', async () => {
    if (lastExportedFilePath) {
      try {
        await window.api.openPath(lastExportedFilePath);
      } catch (err) {
        alert('Failed to open file: ' + err.message);
      }
    }
  });

  // Setup tab toggles for selector form
  listerTabToggleCustom.addEventListener('click', () => {
    listerTabToggleCustom.classList.add('active');
    listerTabToggleCustom.setAttribute('aria-selected', 'true');
    listerTabToggleList.classList.remove('active');
    listerTabToggleList.setAttribute('aria-selected', 'false');
    listerFormCustomId.classList.remove('hidden');
    listerFormListSelect.classList.add('hidden');
  });

  listerTabToggleList.addEventListener('click', () => {
    listerTabToggleList.classList.add('active');
    listerTabToggleList.setAttribute('aria-selected', 'true');
    listerTabToggleCustom.classList.remove('active');
    listerTabToggleCustom.setAttribute('aria-selected', 'false');
    listerFormCustomId.classList.add('hidden');
    listerFormListSelect.classList.remove('hidden');
    loadListerSharedDrivesDropdown();
  });

  // Start scan (custom ID input) click handler
  btnStartListerScan.addEventListener('click', async () => {
    const value = listerIdInput.value.trim();
    // Default empty to 'root' (My Drive)
    const targetId = value === '' ? 'root' : value;
    
    btnStartListerScan.disabled = true;
    btnStartListerScanList.disabled = true;
    
    try {
      await window.api.startListerScan(targetId);
    } catch (err) {
      console.error('Scan trigger failed:', err);
      alert('Failed to start scan: ' + err.message);
      resetListerUI();
    }
  });

  // Start scan (dropdown selection) click handler
  btnStartListerScanList.addEventListener('click', async () => {
    const targetId = listerDriveListSelect.value;
    if (!targetId) return;

    btnStartListerScan.disabled = true;
    btnStartListerScanList.disabled = true;

    try {
      await window.api.startListerScan(targetId);
    } catch (err) {
      console.error('Scan trigger failed:', err);
      alert('Failed to start scan: ' + err.message);
      resetListerUI();
    }
  });

  // Cancel click handler
  btnCancelListerScan.addEventListener('click', async () => {
    if (confirm('Are you sure you want to cancel the active metadata scan?')) {
      btnCancelListerScan.disabled = true;
      btnCancelListerScan.innerText = 'Cancelling...';
      await window.api.cancelListerScan();
    }
  });

  // 1. Scan Started
  window.api.onListerStarted(() => {
    listerProgressCard.classList.remove('hidden');
    listerProgressStatus.innerText = 'Initializing scan...';
    listerProgressDetail.innerText = 'Connecting to Google Drive API';
    
    listerOverallBar.style.width = '0%';
    listerFilesCount.innerText = '0 items found';
    listerStatusText.innerText = 'Scanning...';
    
    listerCompletedActions.classList.add('hidden');
    btnCancelListerScan.classList.remove('hidden');
    btnCancelListerScan.disabled = false;
    btnCancelListerScan.innerText = 'Cancel Scan';
    
    setNavigationLocked(true);
  });

  // 2. Scan Progress
  window.api.onListerProgress((stats) => {
    listerFilesCount.innerText = `${stats.itemsCount} item${stats.itemsCount !== 1 ? 's' : ''} found`;
    listerProgressStatus.innerText = 'Scanning Metadata...';
    listerProgressDetail.innerText = `Crawled ${stats.foldersScanned} folder${stats.foldersScanned !== 1 ? 's' : ''}`;
    
    // Animate/pulse the progress bar to show activity (e.g. 50% width during run)
    listerOverallBar.style.width = '50%';
    listerStatusText.innerText = 'Scanning...';
  });

  // 3. Saving CSV
  window.api.onListerSaving(() => {
    listerProgressStatus.innerText = 'Saving CSV...';
    listerProgressDetail.innerText = 'Waiting for user to select file path';
    listerOverallBar.style.width = '90%';
    listerStatusText.innerText = 'Saving CSV...';
  });

  // 4. Scan Success
  window.api.onListerSuccess((filePath) => {
    listerProgressStatus.innerHTML = `<span style="color: var(--color-success)">Export Completed Successfully!</span>`;
    listerProgressDetail.innerText = `Saved to: ${filePath}`;
    listerOverallBar.style.width = '100%';
    listerStatusText.innerText = 'Completed';
    
    btnCancelListerScan.classList.add('hidden');
    lastExportedFilePath = filePath;
    listerCompletedActions.classList.remove('hidden');
    
    setNavigationLocked(false);
    btnStartListerScan.disabled = false;
    btnStartListerScanList.disabled = false;
  });

  // 5. Scan Cancelled
  window.api.onListerCancelled(() => {
    listerProgressStatus.innerHTML = `<span style="color: var(--color-error)">Scan Cancelled</span>`;
    listerProgressDetail.innerText = 'The metadata scan was aborted.';
    listerOverallBar.style.width = '0%';
    listerStatusText.innerText = 'Cancelled';
    
    btnCancelListerScan.disabled = true;
    listerCompletedActions.classList.add('hidden');
    btnCancelListerScan.classList.remove('hidden');
    
    setNavigationLocked(false);
    btnStartListerScan.disabled = false;
    btnStartListerScanList.disabled = false;
  });

  // 6. Save Cancelled (User dismissed the file save dialog)
  window.api.onListerCancelledSave(() => {
    listerProgressStatus.innerHTML = `<span style="color: var(--color-warning)">Export Cancelled</span>`;
    listerProgressDetail.innerText = 'CSV save was cancelled by the user. Collected metadata was discarded.';
    listerOverallBar.style.width = '0%';
    listerStatusText.innerText = 'Save Cancelled';
    
    btnCancelListerScan.disabled = true;
    listerCompletedActions.classList.add('hidden');
    btnCancelListerScan.classList.remove('hidden');
    
    setNavigationLocked(false);
    btnStartListerScan.disabled = false;
    btnStartListerScanList.disabled = false;
  });

  // 7. Scan Empty (Nothing found)
  window.api.onListerEmpty(() => {
    listerProgressStatus.innerHTML = `<span style="color: var(--color-warning)">Scan Empty</span>`;
    listerProgressDetail.innerText = 'The target folder has no files or folders.';
    listerOverallBar.style.width = '0%';
    listerStatusText.innerText = 'Empty';
    
    btnCancelListerScan.disabled = true;
    listerCompletedActions.classList.add('hidden');
    btnCancelListerScan.classList.remove('hidden');
    
    setNavigationLocked(false);
    btnStartListerScan.disabled = false;
    btnStartListerScanList.disabled = false;
  });

  // 8. Scan Error
  window.api.onListerError((message) => {
    listerProgressStatus.innerHTML = `<span style="color: var(--color-error)">Scan Error</span>`;
    listerProgressDetail.innerText = `An error occurred: ${message}`;
    listerOverallBar.style.width = '0%';
    listerStatusText.innerText = 'Error';
    
    btnCancelListerScan.disabled = true;
    listerCompletedActions.classList.add('hidden');
    btnCancelListerScan.classList.remove('hidden');
    
    setNavigationLocked(false);
    btnStartListerScan.disabled = false;
    btnStartListerScanList.disabled = false;
    alert('Scan failed: ' + message);
  });
}

async function loadListerSharedDrivesDropdown() {
  listerDriveListSelect.innerHTML = `<option value="" disabled selected>Loading Shared Drives...</option>`;
  btnStartListerScanList.setAttribute('disabled', 'true');
  
  try {
    const sharedDrives = await window.api.listSharedDrives();
    
    if (sharedDrives.length === 0) {
      listerDriveListSelect.innerHTML = `<option value="" disabled>No Shared Drives found</option>`;
      btnStartListerScanList.setAttribute('disabled', 'true');
    } else {
      const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      listerDriveListSelect.innerHTML = sharedDrives.map(drive => 
        `<option value="${drive.id}">${escapeHtml(drive.name)}</option>`
      ).join('');
      btnStartListerScanList.removeAttribute('disabled');
    }
  } catch (err) {
    console.error('Failed to load shared drives in lister:', err);
    listerDriveListSelect.innerHTML = `<option value="" disabled>Failed to load Shared Drives</option>`;
    btnStartListerScanList.setAttribute('disabled', 'true');
  }
}

function resetListerUI() {
  btnStartListerScan.disabled = false;
  btnStartListerScanList.disabled = false;
  btnCancelListerScan.disabled = true;
  setNavigationLocked(false);
}

function setNavigationLocked(isLocked) {
  if (isLocked) {
    if (isNavLocked) return;
    isNavLocked = true;

    navConnect.setAttribute('disabled', 'true');
    navScan.setAttribute('disabled', 'true');
    navTransfer.setAttribute('disabled', 'true');
    navSettings.setAttribute('disabled', 'true');
    navLister.setAttribute('disabled', 'true');
    listerTabToggleCustom.setAttribute('disabled', 'true');
    listerTabToggleList.setAttribute('disabled', 'true');
    listerDriveListSelect.setAttribute('disabled', 'true');
  } else {
    isNavLocked = false;
    
    // Always enable Connect, Settings, and Lister when unlocked
    navConnect.removeAttribute('disabled');
    navSettings.removeAttribute('disabled');
    navLister.removeAttribute('disabled');
    
    // Enable Scan if path is verified
    if (verifiedSourceId) {
      navScan.removeAttribute('disabled');
    } else {
      navScan.setAttribute('disabled', 'true');
    }
    
    // Enable Transfer only if scanned files exist
    try {
      const selection = getScannedFilesSelection();
      if (selection && selection.filesList && selection.filesList.length > 0) {
        navTransfer.removeAttribute('disabled');
      } else {
        navTransfer.setAttribute('disabled', 'true');
      }
    } catch (_) {
      navTransfer.setAttribute('disabled', 'true');
    }
    
    listerTabToggleCustom.removeAttribute('disabled');
    listerTabToggleList.removeAttribute('disabled');
    listerDriveListSelect.removeAttribute('disabled');
  }
}
