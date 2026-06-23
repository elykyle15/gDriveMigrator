import { escapeHtml, formatBytes, copyTextToClipboard } from './utils.js';

// --- DOM ELEMENTS ---
const transferOverallStatus = document.getElementById('transfer-overall-status');
const transferOverallDetail = document.getElementById('transfer-overall-detail');
const btnCancelTransfer = document.getElementById('btn-cancel-transfer');
const transferOverallBar = document.getElementById('transfer-overall-bar');
const transferStatsCount = document.getElementById('transfer-stats-count');
const transferFailuresCount = document.getElementById('transfer-failures-count');
const transferQueueList = document.getElementById('transfer-queue-list');
const btnConfirmMigration = document.getElementById('btn-confirm-migration');

const navConnect = document.querySelector('[data-tab="connect"]');
const navScan = document.querySelector('[data-tab="scan"]');
const navTransfer = document.querySelector('[data-tab="transfer"]');
const navSettings = document.querySelector('[data-tab="settings"]');
const navLister = document.querySelector('[data-tab="lister"]');
const btnExportCsv = document.getElementById('btn-export-csv');

const btnToggleLiveLog = document.getElementById('btn-toggle-live-log');
const btnToggleLiveLogBtn = document.getElementById('btn-toggle-live-log-btn');
const liveLogContainer = document.getElementById('live-log-container');

let isTransferActive = false;
let activeFiles = [];
let processedOutcomes = {};

// --- EXPORTED FUNCTIONS ---

export function initTransferController(onTransferStartCallback) {
  // Export CSV Report Click handler
  btnExportCsv.addEventListener('click', async () => {
    const rows = activeFiles.map((file, index) => {
      const outcome = processedOutcomes[index];
      let statusText = 'Pending';
      let errorText = '';
      let fileId = file.id || '';
      
      if (outcome) {
        if (outcome.success) {
          if (outcome.skipped) statusText = 'Skipped';
          else if (outcome.copied) {
            statusText = 'Copied';
            if (outcome.newFileId) {
              fileId = outcome.newFileId;
            }
          }
          else statusText = 'Transferred';
        } else {
          statusText = 'Failed';
          errorText = outcome.error || '';
        }
      }

      const driveLink = fileId ? `https://drive.google.com/open?id=${fileId}` : '';

      return {
        filename: file.name,
        sourcePath: file.relativePath || '/',
        destinationPath: file.relativePath || '/',
        status: statusText,
        owner: file.ownerEmail || '',
        errorMessage: errorText,
        documentId: fileId,
        driveLink: driveLink
      };
    });

    btnExportCsv.disabled = true;
    try {
      const res = await window.api.exportCsv(rows);
      if (res.success) {
        alert('CSV Report successfully downloaded to: ' + res.filePath);
      }
    } catch (err) {
      alert('Failed to export CSV: ' + err.message);
    } finally {
      btnExportCsv.disabled = false;
    }
  });

  // Toggle live log section
  btnToggleLiveLog.addEventListener('click', () => {
    const isHidden = liveLogContainer.classList.toggle('hidden');
    if (isHidden) {
      btnToggleLiveLogBtn.innerText = 'Show Log';
    } else {
      btnToggleLiveLogBtn.innerText = 'Hide Log';
      liveLogContainer.scrollTop = liveLogContainer.scrollHeight;
    }
  });

  // Cancel transfer trigger
  btnCancelTransfer.addEventListener('click', async () => {
    if (confirm('Are you sure you want to cancel the active migration queue? This will leave some files untransferred.')) {
      btnCancelTransfer.disabled = true;
      btnCancelTransfer.innerText = 'Cancelling...';
      await window.api.cancelTransfer();
    }
  });

  // Copy button event delegation for transfer queue list
  transferQueueList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-btn');
    if (btn) {
      const name = btn.getAttribute('data-name');
      if (name) {
        const success = await copyTextToClipboard(name);
        if (success) {
          const textSpan = btn.querySelector('span');
          const originalText = textSpan.innerText;
          textSpan.innerText = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            textSpan.innerText = originalText;
            btn.classList.remove('copied');
          }, 1200);
        }
      }
    }
  });

  // Bind IPC listeners
  
  // 1. Transfer Queue Initiated
  window.api.onTransferStarted((data) => {
    isTransferActive = true;
    onTransferStartCallback(); // Switches tab to Transfer Queue
    
    // Hide last results banner if active
    const banner = document.getElementById('last-results-banner');
    if (banner) banner.classList.add('hidden');
    
    btnExportCsv.classList.add('hidden');

    const selectionMap = data.selectionMap || {};
    const filesList = data.filesList || [];
    
    activeFiles = filesList.filter((_, idx) => selectionMap[idx] === true);
    processedOutcomes = data.processedMap || {};

    transferOverallStatus.innerText = 'Initializing Transfer...';
    transferOverallDetail.innerText = 'Creating mirrored directory trees inside destination Shared Drive...';
    transferOverallBar.style.width = '0%';
    transferStatsCount.innerText = '0 / 0 files completed';
    transferFailuresCount.innerText = '0 failures';
    transferQueueList.innerHTML = '';
    
    btnCancelTransfer.disabled = false;
    btnCancelTransfer.innerText = 'Cancel Transfer';
    btnCancelTransfer.classList.remove('hidden');
    btnConfirmMigration.classList.add('hidden');

    // Restore UI rows if resuming
    if (data.isResume) {
      const fragment = document.createDocumentFragment();
      activeFiles.forEach((file, index) => {
        let row = document.createElement('div');
        row.className = 'queue-row';
        row.id = `transfer-row-${index}`;
        
        let statusBadge = `<span class="status-badge pending">Pending</span>`;
        const outcome = processedOutcomes[index];
        if (outcome) {
          if (outcome.success) {
            if (outcome.skipped) {
              statusBadge = `<span class="status-badge skipped">Skipped</span>`;
            } else if (outcome.copied) {
              statusBadge = `<span class="status-badge completed" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.4);">Copied</span>`;
            } else {
              statusBadge = `<span class="status-badge completed">Transferred</span>`;
            }
          } else {
            statusBadge = `
              <span class="status-badge failed">Failed</span>
              <span class="status-error-msg" title="${escapeHtml(outcome.error)}">${escapeHtml(outcome.error)}</span>
            `;
          }
        }
        
        const displayFileId = (outcome && outcome.newFileId) || file.id;

        row.innerHTML = `
          <div class="queue-name-col">
            <span class="queue-filename">${escapeHtml(file.name)}</span>
            <span class="queue-relpath">Destination: ${escapeHtml(file.relativePath || '/')}</span>
            <div class="file-actions">
              <button class="action-link copy-btn" data-name="${escapeHtml(file.name)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy Name</span>
              </button>
              ${displayFileId ? `
              <a href="https://drive.google.com/open?id=${displayFileId}" target="_blank" class="action-link open-btn" id="open-drive-${index}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                <span>Open in Drive</span>
              </a>
              ` : ''}
            </div>
          </div>
          <div class="queue-size">${formatBytes(file.size)}</div>
          <div class="queue-status-col" id="status-col-${index}">
            ${statusBadge}
          </div>
        `;
        fragment.appendChild(row);
      });
      transferQueueList.appendChild(fragment);
    }

    setNavigationLocked(true);
  });

  // 2. Main Process reports overall metrics updates
  window.api.onTransferProgress((stats) => {
    const total = stats.totalFiles;
    const completed = stats.completedCount;
    const failed = stats.failedCount;
    const skipped = stats.skippedCount;
    const processed = completed + failed + skipped;

    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    transferOverallBar.style.width = `${percent}%`;

    transferOverallStatus.innerText = percent === 100 ? 'Migration Complete!' : 'Transferring Files...';
    transferOverallDetail.innerText = `Processed ${processed} of ${total} files.`;
    transferStatsCount.innerText = `${completed} completed, ${skipped} skipped`;
    
    if (failed > 0) {
      transferFailuresCount.innerText = `${failed} failure${failed !== 1 ? 's' : ''}`;
      transferFailuresCount.style.color = 'var(--color-error)';
    } else {
      transferFailuresCount.innerText = '0 failures';
      transferFailuresCount.style.color = 'var(--text-muted)';
    }
  });

  // 3. File starts processing
  window.api.onTransferFileStart((file) => {
    // Check if row already exists
    let row = document.getElementById(`transfer-row-${file.index}`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'queue-row';
      row.id = `transfer-row-${file.index}`;
      const origFile = activeFiles[file.index];
      const displayFileId = origFile ? origFile.id : '';

      row.innerHTML = `
        <div class="queue-name-col">
          <span class="queue-filename">${escapeHtml(file.name)}</span>
          <span class="queue-relpath">Destination: ${escapeHtml(file.relativePath || '/')}</span>
          <div class="file-actions">
            <button class="action-link copy-btn" data-name="${escapeHtml(file.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy Name</span>
            </button>
            ${displayFileId ? `
            <a href="https://drive.google.com/open?id=${displayFileId}" target="_blank" class="action-link open-btn" id="open-drive-${file.index}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>Open in Drive</span>
            </a>
            ` : ''}
          </div>
        </div>
        <div class="queue-size">${formatBytes(file.size)}</div>
        <div class="queue-status-col" id="status-col-${file.index}">
          <span class="status-badge working">Moving</span>
        </div>
      `;
      transferQueueList.appendChild(row);
      // Auto scroll to latest row
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  window.api.onTransferFileComplete((result) => {
    const statusCol = document.getElementById(`status-col-${result.index}`);
    if (!statusCol) return;

    processedOutcomes[result.index] = {
      success: result.success,
      skipped: result.skipped,
      copied: result.copied,
      error: result.error,
      newFileId: result.newFileId
    };

    // Update Open in Drive link if a new file ID was generated (e.g. copied fallback)
    const openLink = document.getElementById(`open-drive-${result.index}`);
    if (openLink && result.success && result.copied && result.newFileId) {
      openLink.href = `https://drive.google.com/open?id=${result.newFileId}`;
    }

    if (result.success) {
      if (result.skipped) {
        statusCol.innerHTML = `<span class="status-badge skipped">Skipped</span>`;
      } else if (result.copied) {
        statusCol.innerHTML = `<span class="status-badge completed" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.4);">Copied</span>`;
      } else {
        statusCol.innerHTML = `<span class="status-badge completed">Transferred</span>`;
      }
    } else {
      statusCol.innerHTML = `
        <span class="status-badge failed">Failed</span>
        <span class="status-error-msg" title="${escapeHtml(result.error)}">${escapeHtml(result.error)}</span>
      `;
    }
  });

  // 5. Transfer Success (All files processed)
  window.api.onTransferSuccess(() => {
    isTransferActive = false;
    transferOverallStatus.innerHTML = `<span style="color: var(--color-success)">Migration Completed Successfully!</span>`;
    transferOverallDetail.innerText = 'All eligible files have been transferred to the destination Shared Drive.';
    transferOverallBar.style.width = '100%';
    btnCancelTransfer.classList.add('hidden');
    btnExportCsv.classList.remove('hidden');
    setNavigationLocked(false);
  });

  // 6. Transfer Cancelled
  window.api.onTransferCancelled(() => {
    isTransferActive = false;
    transferOverallStatus.innerHTML = `<span style="color: var(--color-error)">Transfer Cancelled</span>`;
    transferOverallDetail.innerText = 'The transfer operation was aborted by the user. Some files were not moved.';
    btnCancelTransfer.disabled = true;
    btnExportCsv.classList.remove('hidden');
    setNavigationLocked(false);
  });

  // 7. Global Transfer Error
  window.api.onTransferError((message) => {
    isTransferActive = false;
    transferOverallStatus.innerHTML = `<span style="color: var(--color-error)">Transfer Error</span>`;
    transferOverallDetail.innerText = `A migration queue error occurred: ${message}`;
    btnCancelTransfer.disabled = true;
    btnExportCsv.classList.remove('hidden');
    setNavigationLocked(false);
    alert('Global transfer migration failed: ' + message);
  });

  // --- DRY RUN LISTENERS ---
  window.api.onDryRunStarted(() => {
    isTransferActive = true;
    onTransferStartCallback(); // Switch to Transfer Queue Tab
    
    // Hide last results banner if active
    const banner = document.getElementById('last-results-banner');
    if (banner) banner.classList.add('hidden');

    transferOverallStatus.innerText = 'Initializing Dry Run...';
    transferOverallDetail.innerText = 'Analyzing folder structure and simulating transfer actions...';
    transferOverallBar.style.width = '0%';
    transferStatsCount.innerText = '0 / 0 simulated files';
    transferFailuresCount.innerText = '0 errors';
    transferQueueList.innerHTML = '';
    
    btnCancelTransfer.disabled = false;
    btnCancelTransfer.innerText = 'Cancel Dry Run';
    btnCancelTransfer.classList.remove('hidden');
    btnConfirmMigration.classList.add('hidden');

    setNavigationLocked(true);
  });

  window.api.onDryRunProgress((stats) => {
    const total = stats.totalFiles;
    const completed = stats.completedCount;
    const failed = stats.failedCount;
    const skipped = stats.skippedCount;
    const processed = completed + failed + skipped;

    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    transferOverallBar.style.width = `${percent}%`;

    transferOverallStatus.innerText = percent === 100 ? 'Simulation Complete!' : 'Simulating Transfer...';
    transferOverallDetail.innerText = `Simulated ${processed} of ${total} files.`;
    transferStatsCount.innerText = `${completed} eligible, ${skipped} skipped`;
    
    if (failed > 0) {
      transferFailuresCount.innerText = `${failed} error${failed !== 1 ? 's' : ''}`;
      transferFailuresCount.style.color = 'var(--color-error)';
    } else {
      transferFailuresCount.innerText = '0 errors';
      transferFailuresCount.style.color = 'var(--text-muted)';
    }
  });

  window.api.onDryRunFileStart((file) => {
    let row = document.getElementById(`transfer-row-${file.index}`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'queue-row';
      row.id = `transfer-row-${file.index}`;
      const origFile = activeFiles[file.index];
      const displayFileId = origFile ? origFile.id : '';

      row.innerHTML = `
        <div class="queue-name-col">
          <span class="queue-filename">${escapeHtml(file.name)}</span>
          <span class="queue-relpath">Simulated Destination: ${escapeHtml(file.relativePath || '/')}</span>
          <div class="file-actions">
            <button class="action-link copy-btn" data-name="${escapeHtml(file.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy Name</span>
            </button>
            ${displayFileId ? `
            <a href="https://drive.google.com/open?id=${displayFileId}" target="_blank" class="action-link open-btn" id="open-drive-${file.index}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>Open in Drive</span>
            </a>
            ` : ''}
          </div>
        </div>
        <div class="queue-size">${formatBytes(file.size)}</div>
        <div class="queue-status-col" id="status-col-${file.index}">
          <span class="status-badge working">Simulating</span>
        </div>
      `;
      transferQueueList.appendChild(row);
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  window.api.onDryRunFileComplete((result) => {
    const statusCol = document.getElementById(`status-col-${result.index}`);
    if (!statusCol) return;

    if (result.success) {
      if (result.skipped) {
        statusCol.innerHTML = `<span class="status-badge skipped">Skipped (Exists)</span>`;
      } else if (result.action === 'Rename') {
        statusCol.innerHTML = `<span class="status-badge completed" style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.4); color: var(--color-warning);">Rename: ${escapeHtml(result.simulatedName)}</span>`;
      } else if (result.action === 'Duplicate') {
        statusCol.innerHTML = `<span class="status-badge completed" style="background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.4); color: #a5b4fc;">Duplicate</span>`;
      } else {
        statusCol.innerHTML = `<span class="status-badge completed">Eligible</span>`;
      }
    } else {
      statusCol.innerHTML = `
        <span class="status-badge failed">Error</span>
        <span class="status-error-msg" title="${escapeHtml(result.error)}">${escapeHtml(result.error)}</span>
      `;
    }
  });

  window.api.onDryRunComplete((results) => {
    isTransferActive = false;
    transferOverallStatus.innerHTML = `<span style="color: var(--color-success)">Dry-Run Simulation Complete!</span>`;
    transferOverallDetail.innerText = `Simulation summary: ${results.completedCount} files would migrate, ${results.skippedCount} would skip, ${results.virtualFoldersCreated.length} folder structures would be recreated.`;
    transferOverallBar.style.width = '100%';
    
    btnCancelTransfer.classList.add('hidden');
    btnConfirmMigration.classList.remove('hidden');
    setNavigationLocked(false);
  });

  window.api.onDryRunCancelled(() => {
    isTransferActive = false;
    transferOverallStatus.innerHTML = `<span style="color: var(--color-error)">Simulation Cancelled</span>`;
    transferOverallDetail.innerText = 'The simulation run was cancelled by the user.';
    btnCancelTransfer.disabled = true;
    setNavigationLocked(false);
  });

  window.api.onDryRunError((message) => {
    isTransferActive = false;
    transferOverallStatus.innerHTML = `<span style="color: var(--color-error)">Simulation Error</span>`;
    transferOverallDetail.innerText = `A simulation error occurred: ${message}`;
    btnCancelTransfer.disabled = true;
    setNavigationLocked(false);
  });

  // Real-time log line streaming listener
  window.api.onLogLine((line) => {
    if (liveLogContainer.innerHTML.includes('No active logs yet')) {
      liveLogContainer.innerHTML = '';
    }

    const logRow = document.createElement('div');
    logRow.innerText = line;
    liveLogContainer.appendChild(logRow);

    // Bounded log memory size
    while (liveLogContainer.children.length > 200) {
      liveLogContainer.removeChild(liveLogContainer.firstChild);
    }

    if (!liveLogContainer.classList.contains('hidden')) {
      liveLogContainer.scrollTop = liveLogContainer.scrollHeight;
    }
  });
}

export async function loadLastResults() {
  const banner = document.getElementById('last-results-banner');
  const bannerText = document.getElementById('last-results-banner-text');
  const btnClear = document.getElementById('btn-clear-last-results');

  try {
    const response = await window.api.getLastResults();
    if (response.exists) {
      const results = response.data;
      const dateStr = new Date(results.timestamp).toLocaleString();
      bannerText.innerHTML = `Showing results from the transfer run on <strong>${dateStr}</strong>.`;
      banner.classList.remove('hidden');

      // Enable Transfer Nav button if results are present so user can look at them!
      const navTransfer = document.getElementById('nav-transfer');
      navTransfer.removeAttribute('disabled');

      // Update Overall status card
      const total = results.totalFiles;
      const completed = results.completedCount;
      const failed = results.failedCount;
      const skipped = results.skippedCount;
      const processed = completed + failed + skipped;

      const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
      transferOverallBar.style.width = `${percent}%`;
      transferOverallStatus.innerText = results.status === 'completed' ? 'Migration Completed!' : 'Transfer Interrupted / Cancelled';
      transferOverallDetail.innerText = `Processed ${processed} of ${total} files.`;
      transferStatsCount.innerText = `${completed} completed, ${skipped} skipped`;
      
      if (failed > 0) {
        transferFailuresCount.innerText = `${failed} failure${failed !== 1 ? 's' : ''}`;
        transferFailuresCount.style.color = 'var(--color-error)';
      } else {
        transferFailuresCount.innerText = '0 failures';
        transferFailuresCount.style.color = 'var(--text-muted)';
      }

      // Populate file tasks list
      const fragment = document.createDocumentFragment();
      results.filesList.forEach((file, index) => {
        const row = document.createElement('div');
        row.className = 'queue-row';
        row.id = `transfer-row-${index}`;
        
        let statusBadge = '';
        const outcome = results.processedMap[index];
        if (outcome) {
          if (outcome.success) {
            if (outcome.skipped) {
              statusBadge = `<span class="status-badge skipped">Skipped</span>`;
            } else if (outcome.copied) {
              statusBadge = `<span class="status-badge completed" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.4);">Copied</span>`;
            } else {
              statusBadge = `<span class="status-badge completed">Transferred</span>`;
            }
          } else {
            statusBadge = `
              <span class="status-badge failed">Failed</span>
              <span class="status-error-msg" title="${escapeHtml(outcome.error)}">${escapeHtml(outcome.error)}</span>
            `;
          }
        } else {
          statusBadge = `<span class="status-badge pending">Pending</span>`;
        }

        const displayFileId = (outcome && outcome.newFileId) || file.id;

        row.innerHTML = `
          <div class="queue-name-col">
            <span class="queue-filename">${escapeHtml(file.name)}</span>
            <span class="queue-relpath">Destination: ${escapeHtml(file.relativePath || '/')}</span>
            <div class="file-actions">
              <button class="action-link copy-btn" data-name="${escapeHtml(file.name)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy Name</span>
              </button>
              ${displayFileId ? `
              <a href="https://drive.google.com/open?id=${displayFileId}" target="_blank" class="action-link open-btn" id="open-drive-${index}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                <span>Open in Drive</span>
              </a>
              ` : ''}
            </div>
          </div>
          <div class="queue-size">${formatBytes(file.size)}</div>
          <div class="queue-status-col" id="status-col-${index}">
            ${statusBadge}
          </div>
        `;
        fragment.appendChild(row);
      });
      transferQueueList.innerHTML = '';
      transferQueueList.appendChild(fragment);

      // Hide cancel button
      btnCancelTransfer.classList.add('hidden');

      btnClear.onclick = async () => {
        await window.api.clearLastResults();
        banner.classList.add('hidden');
        resetTransferUI();
      };
    }
  } catch (err) {
    console.error('Failed to load last results:', err);
  }
}

function resetTransferUI() {
  transferOverallStatus.innerText = 'No active transfer';
  transferOverallDetail.innerText = 'Scanned files selection will appear here when you start a migration.';
  transferOverallBar.style.width = '0%';
  transferStatsCount.innerText = '0 / 0 files completed';
  transferFailuresCount.innerText = '0 failures';
  transferQueueList.innerHTML = '';
}

// --- PRIVATE HELPERS ---

function setNavigationLocked(isLocked) {
  if (isLocked) {
    navConnect.setAttribute('disabled', 'true');
    navScan.setAttribute('disabled', 'true');
    navTransfer.setAttribute('disabled', 'true');
    navSettings.setAttribute('disabled', 'true');
    if (navLister) navLister.setAttribute('disabled', 'true');
  } else {
    navConnect.removeAttribute('disabled');
    navScan.removeAttribute('disabled');
    navTransfer.removeAttribute('disabled');
    navSettings.removeAttribute('disabled');
    if (navLister) navLister.removeAttribute('disabled');
  }
}
