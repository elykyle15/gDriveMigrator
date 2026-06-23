import { escapeHtml, formatBytes, copyTextToClipboard } from './utils.js';
import { verifiedSourceId, verifiedDestId } from './auth.js';

// --- STATE ---
let filesList = [];
let selectionMap = {}; // index -> boolean

// --- DOM ELEMENTS ---
const btnStartScan = document.getElementById('btn-start-scan');
const filterType = document.getElementById('filter-type');
const filterPattern = document.getElementById('filter-pattern');

const scanProgressCard = document.getElementById('scan-progress-card');
const scanStatusText = document.getElementById('scan-status-text');
const scanProgressDetail = document.getElementById('scan-progress-detail');
const btnCancelScan = document.getElementById('btn-cancel-scan');
const scanOverallBar = document.getElementById('scan-overall-bar');
const scanItemsFound = document.getElementById('scan-items-found');

const scanResultsCard = document.getElementById('scan-results-card');
const scanResultsList = document.getElementById('scan-results-list');
const checkboxSelectAll = document.getElementById('checkbox-select-all');
const selectionSummaryText = document.getElementById('selection-summary-text');
const btnStartTransfer = document.getElementById('btn-start-transfer');
const btnStartDryRun = document.getElementById('btn-start-dry-run');

// Advanced Filters Elements
const btnToggleAdvancedFilters = document.getElementById('btn-toggle-advanced-filters');
const advancedFiltersContainer = document.getElementById('advanced-filters-container');
const mimeAll = document.getElementById('mime-all');
const filterDateAfter = document.getElementById('filter-date-after');
const filterDateBefore = document.getElementById('filter-date-before');
const scanRecurseShared = document.getElementById('scan-recurse-shared');

// Nav Items to Lock during crawl
const navConnect = document.querySelector('[data-tab="connect"]');
const navScan = document.querySelector('[data-tab="scan"]');
const navTransfer = document.querySelector('[data-tab="transfer"]');
const navSettings = document.querySelector('[data-tab="settings"]');
const navLister = document.querySelector('[data-tab="lister"]');

// --- EXPORTED FUNCTIONS ---

export function initScannerController() {
  // Toggle advanced filters
  btnToggleAdvancedFilters.addEventListener('click', () => {
    const isHidden = advancedFiltersContainer.classList.toggle('hidden');
    if (isHidden) {
      btnToggleAdvancedFilters.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" id="advanced-toggle-icon">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg> Show Advanced Filters`;
    } else {
      btnToggleAdvancedFilters.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" id="advanced-toggle-icon" style="transform: rotate(180deg);">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg> Hide Advanced Filters`;
    }
  });

  // Handle MIME All check/uncheck
  mimeAll.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const checkboxes = advancedFiltersContainer.querySelectorAll('.mime-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
      if (isChecked) {
        cb.setAttribute('disabled', 'true');
      } else {
        cb.removeAttribute('disabled');
      }
    });
  });

  // Start Scan click handler
  btnStartScan.addEventListener('click', async () => {
    if (!verifiedSourceId) {
      alert('Please verify and set the source path first on the Connect tab.');
      return;
    }

    const pattern = filterPattern.value.trim();

    // Read MIME types
    let mimeFilters = null;
    if (!mimeAll.checked) {
      mimeFilters = [];
      const checkboxes = advancedFiltersContainer.querySelectorAll('.mime-checkbox');
      checkboxes.forEach(cb => {
        if (cb.checked) {
          mimeFilters.push(cb.value);
        }
      });
    }

    // Read dates
    const dateAfter = filterDateAfter.value || null;
    const dateBefore = filterDateBefore.value || null;
    const recurseShared = scanRecurseShared.checked;

    btnStartScan.disabled = true;
    scanResultsCard.classList.add('hidden');
    
    try {
      await window.api.startScan(verifiedSourceId, pattern, filterType.value, mimeFilters, dateAfter, dateBefore, recurseShared);
    } catch (err) {
      alert('Failed to start scan: ' + err.message);
      resetScanUI();
    }
  });

  // Cancel Scan click handler
  btnCancelScan.addEventListener('click', async () => {
    if (confirm('Cancel active scan?')) {
      btnCancelScan.disabled = true;
      btnCancelScan.innerText = 'Cancelling...';
      await window.api.cancelScan();
    }
  });

  // Select All Checkbox Handler
  checkboxSelectAll.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    filesList.forEach((_, idx) => {
      selectionMap[idx] = isChecked;
    });
    const checkboxes = scanResultsList.querySelectorAll('.file-select-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
    });
    updateSelectionSummary();
  });

  // Copy button event delegation for scan results list
  scanResultsList.addEventListener('click', async (e) => {
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
  window.api.onScanStarted(() => {
    scanProgressCard.classList.remove('hidden');
    scanStatusText.innerText = 'Initializing Scan...';
    scanProgressDetail.innerText = 'Connecting to Google Drive and loading metadata';
    scanOverallBar.style.width = '100%';
    scanItemsFound.innerText = '0 matching files found';
    
    btnCancelScan.disabled = false;
    btnCancelScan.innerText = 'Cancel Scan';
    
    setNavigationLocked(true);
  });

  window.api.onScanProgress((data) => {
    const eligibleCount = typeof data === 'object' ? data.eligibleCount : data;
    const scannedCount = typeof data === 'object' ? data.scannedCount : 0;

    scanStatusText.innerText = 'Scanning Source Directory...';
    let detailText = `Matched ${eligibleCount} file${eligibleCount !== 1 ? 's' : ''} owned by filtered accounts.`;
    if (scannedCount > 0) {
      detailText += ` (${scannedCount} items evaluated)`;
    }
    scanProgressDetail.innerText = detailText;
    scanItemsFound.innerText = `${eligibleCount} matching file${eligibleCount !== 1 ? 's' : ''} found`;
  });

  window.api.onScanSuccess((eligibleFiles) => {
    scanProgressCard.classList.add('hidden');
    setNavigationLocked(false);
    btnStartScan.disabled = false;

    filesList = eligibleFiles;
    selectionMap = {};
    checkboxSelectAll.checked = true;

    if (filesList.length === 0) {
      alert('Scan complete. No files matching the filtered email were found.');
      return;
    }

    renderScanResults();
  });

  window.api.onScanCancelled((eligibleFiles) => {
    const fileCount = eligibleFiles ? eligibleFiles.length : 0;
    scanStatusText.innerHTML = `<span style="color: var(--color-warning)">Scan Cancelled</span>`;
    scanProgressDetail.innerText = `Crawl aborted. Showing ${fileCount} item${fileCount !== 1 ? 's' : ''} identified prior to cancellation.`;
    btnCancelScan.disabled = true;
    
    setNavigationLocked(false);
    btnStartScan.disabled = false;

    if (eligibleFiles && eligibleFiles.length > 0) {
      filesList = eligibleFiles;
      selectionMap = {};
      checkboxSelectAll.checked = true;
      renderScanResults();
    }
  });

  window.api.onScanError((message) => {
    scanStatusText.innerHTML = `<span style="color: var(--color-error)">Scan Error</span>`;
    scanProgressDetail.innerText = `An error occurred: ${message}`;
    btnCancelScan.disabled = true;
    
    setNavigationLocked(false);
    btnStartScan.disabled = false;
  });
}

export function getScannedFilesSelection() {
  return {
    sourceId: verifiedSourceId,
    destId: verifiedDestId,
    selectionMap,
    filesList
  };
}

// --- PRIVATE HELPERS ---

function resetScanUI() {
  btnStartScan.disabled = false;
  btnCancelScan.disabled = true;
  setNavigationLocked(false);
}

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
    navSettings.removeAttribute('disabled');
    if (navLister) navLister.removeAttribute('disabled');
    // Transfer navigation stays locked/unlocked depending on active operations
  }
}

function renderScanResults() {
  const fragment = document.createDocumentFragment();
  
  filesList.forEach((file, index) => {
    selectionMap[index] = true; // Default selected
  });

  const displayLimit = 5000;
  const itemsToRender = filesList.slice(0, displayLimit);

  itemsToRender.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'queue-row';
    row.innerHTML = `
      <div class="queue-name-col">
        <label class="custom-checkbox">
          <input type="checkbox" class="file-select-checkbox" data-idx="${index}" checked>
          <span class="checkmark"></span>
          <span class="queue-filename" style="margin-left: 28px; display: inline-block;">${escapeHtml(file.name)}</span>
        </label>
        <span class="queue-relpath" style="padding-left: 28px; margin-top: 4px;">
          Owner: <strong>${escapeHtml(file.ownerEmail)}</strong> &bull; Relative path: ${escapeHtml(file.relativePath)}
        </span>
        <div class="file-actions" style="padding-left: 28px;">
          <button class="action-link copy-btn" data-name="${escapeHtml(file.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy Name</span>
          </button>
          ${file.id ? `
          <a href="https://drive.google.com/open?id=${file.id}" target="_blank" class="action-link open-btn">
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
      <div class="queue-status-col">
        <span class="status-badge pending">Eligible</span>
      </div>
    `;

    // Row checkbox listener
    const checkbox = row.querySelector('.file-select-checkbox');
    checkbox.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'), 10);
      selectionMap[idx] = e.target.checked;
      
      // If any unchecked, turn off select-all checkbox
      if (!e.target.checked) {
        checkboxSelectAll.checked = false;
      }
      updateSelectionSummary();
    });

    fragment.appendChild(row);
  });

  if (filesList.length > displayLimit) {
    const warningRow = document.createElement('div');
    warningRow.className = 'queue-row warning-row';
    warningRow.style.display = 'flex';
    warningRow.style.alignItems = 'center';
    warningRow.style.justifyContent = 'center';
    warningRow.style.padding = '12px';
    warningRow.style.background = 'rgba(245, 158, 11, 0.1)';
    warningRow.style.border = '1px dashed rgba(245, 158, 11, 0.4)';
    warningRow.style.borderRadius = '6px';
    warningRow.style.marginTop = '8px';
    warningRow.style.color = '#d97706';
    warningRow.style.fontSize = '13px';
    warningRow.innerHTML = `
      <span>⚠️ Showing first 5,000 items. The remaining ${filesList.length - displayLimit} items will be processed during transfer.</span>
    `;
    fragment.appendChild(warningRow);
  }

  scanResultsList.innerHTML = '';
  scanResultsList.appendChild(fragment);
  scanResultsCard.classList.remove('hidden');
  updateSelectionSummary();
}

function updateSelectionSummary() {
  let selectedFiles = 0;
  let selectedBytes = 0;

  filesList.forEach((file, index) => {
    if (selectionMap[index] === true) {
      selectedFiles++;
      selectedBytes += file.size;
    }
  });

  if (selectedFiles > 0) {
    selectionSummaryText.innerText = `${selectedFiles} of ${filesList.length} file(s) selected (${formatBytes(selectedBytes)})`;
    btnStartTransfer.removeAttribute('disabled');
    btnStartDryRun.removeAttribute('disabled');
  } else {
    selectionSummaryText.innerText = 'No files selected for migration';
    btnStartTransfer.setAttribute('disabled', 'true');
    btnStartDryRun.setAttribute('disabled', 'true');
  }
}
