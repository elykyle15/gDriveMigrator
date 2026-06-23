import { escapeHtml } from './utils.js';

// --- STATE ---
let appConfig = null;
let currentAuthStatus = { authenticated: false, user: null };

export let verifiedSourceId = null;
export let verifiedDestId = null;

// --- DOM ELEMENTS ---
const statusPill = document.getElementById('status-pill');
const statusText = statusPill.querySelector('.status-text');
const tipLink = document.getElementById('tip-link');

// Connect Tab
const authStatusCard = document.getElementById('auth-status-card');
const unauthSection = authStatusCard.querySelector('.auth-card-unauth');
const authSection = authStatusCard.querySelector('.auth-card-auth');
const userAvatarInitials = document.getElementById('user-avatar-initials');
const userDisplayName = document.getElementById('user-display-name');
const userEmailAddress = document.getElementById('user-email-address');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');

// Source Selection
const sourceSelectorCard = document.getElementById('source-selector-card');
const sourceTabCustom = document.getElementById('source-tab-custom');
const sourceTabList = document.getElementById('source-tab-list');
const sourceTabShared = document.getElementById('source-tab-shared');
const sourceFormCustom = document.getElementById('source-form-custom');
const sourceFormList = document.getElementById('source-form-list');
const sourceIdInput = document.getElementById('source-id-input');
const sourceListSelect = document.getElementById('source-list-select');
const btnVerifySource = document.getElementById('btn-verify-source');
const sourceStatusDisplay = document.getElementById('source-status-display');

// Destination Selection
const destSelectorCard = document.getElementById('dest-selector-card');
const destTabCustom = document.getElementById('dest-tab-custom');
const destTabList = document.getElementById('dest-tab-list');
const destFormCustom = document.getElementById('dest-form-custom');
const destFormList = document.getElementById('dest-form-list');
const destIdInput = document.getElementById('dest-id-input');
const destListSelect = document.getElementById('dest-list-select');
const btnVerifyDest = document.getElementById('btn-verify-dest');
const destStatusDisplay = document.getElementById('dest-status-display');

// Settings Elements
const settingsClientId = document.getElementById('settings-client-id');
const settingsClientSecret = document.getElementById('settings-client-secret');
const settingsCollision = document.getElementById('settings-collision');
const settingsStructureOption = document.getElementById('settings-structure-option');
const settingsLeaveShortcut = document.getElementById('settings-leave-shortcut');
const settingsResolveShortcuts = document.getElementById('settings-resolve-shortcuts');
const settingsCopyFallback = document.getElementById('settings-copy-fallback');
const settingsAccessibilityCheck = document.getElementById('settings-accessibility-check');
const settingsConcurrency = document.getElementById('settings-concurrency');
const settingsConcurrencyValue = document.getElementById('settings-concurrency-value');
const btnImportJson = document.getElementById('btn-import-json');
const btnOpenLog = document.getElementById('btn-open-log');
const btnResetAuth = document.getElementById('btn-reset-auth');
const btnSaveSettings = document.getElementById('btn-save-settings');
const toastSaveSuccess = document.getElementById('settings-save-success');
const toastSaveError = document.getElementById('settings-save-error');

const navScan = document.getElementById('nav-scan');
const navTransfer = document.getElementById('nav-transfer');
const navLister = document.getElementById('nav-lister');

// --- EXPORTED FUNCTIONS ---

export async function initAuthAndSettings(onPathsVerifiedCallback) {
  // Load configuration
  await refreshConfig();

  // Tab toggles for source location
  sourceTabCustom.addEventListener('click', () => {
    sourceTabCustom.classList.add('active');
    sourceTabCustom.setAttribute('aria-selected', 'true');
    sourceTabList.classList.remove('active');
    sourceTabList.setAttribute('aria-selected', 'false');
    sourceTabShared.classList.remove('active');
    sourceTabShared.setAttribute('aria-selected', 'false');
    sourceFormCustom.classList.remove('hidden');
    sourceFormList.classList.add('hidden');
  });

  sourceTabList.addEventListener('click', () => {
    sourceTabList.classList.add('active');
    sourceTabList.setAttribute('aria-selected', 'true');
    sourceTabCustom.classList.remove('active');
    sourceTabCustom.setAttribute('aria-selected', 'false');
    sourceTabShared.classList.remove('active');
    sourceTabShared.setAttribute('aria-selected', 'false');
    sourceFormCustom.classList.add('hidden');
    sourceFormList.classList.remove('hidden');
    loadSharedDrivesDropdown(sourceListSelect);
  });

  sourceTabShared.addEventListener('click', () => {
    sourceTabShared.classList.add('active');
    sourceTabShared.setAttribute('aria-selected', 'true');
    sourceTabCustom.classList.remove('active');
    sourceTabCustom.setAttribute('aria-selected', 'false');
    sourceTabList.classList.remove('active');
    sourceTabList.setAttribute('aria-selected', 'false');
    sourceFormCustom.classList.add('hidden');
    sourceFormList.classList.add('hidden');
  });

  // Handle concurrency slider change
  settingsConcurrency.addEventListener('input', (e) => {
    settingsConcurrencyValue.innerText = e.target.value;
  });

  // Tab toggles for destination location
  destTabCustom.addEventListener('click', () => {
    destTabCustom.classList.add('active');
    destTabCustom.setAttribute('aria-selected', 'true');
    destTabList.classList.remove('active');
    destTabList.setAttribute('aria-selected', 'false');
    destFormCustom.classList.remove('hidden');
    destFormList.classList.add('hidden');
  });

  destTabList.addEventListener('click', () => {
    destTabList.classList.add('active');
    destTabList.setAttribute('aria-selected', 'true');
    destTabCustom.classList.remove('active');
    destTabCustom.setAttribute('aria-selected', 'false');
    destFormCustom.classList.add('hidden');
    destFormList.classList.remove('hidden');
    loadSharedDrivesDropdown(destListSelect);
  });

  // Verify and Set Source ID handler
  btnVerifySource.addEventListener('click', async () => {
    let sourceId = '';
    if (sourceTabCustom.classList.contains('active')) {
      sourceId = sourceIdInput.value.trim();
      if (sourceId === '') sourceId = 'root';
    } else if (sourceTabList.classList.contains('active')) {
      sourceId = sourceListSelect.value;
    } else if (sourceTabShared.classList.contains('active')) {
      sourceId = 'shared-with-me';
    }

    if (!sourceId) {
      alert('Please enter or select a source folder/drive.');
      return;
    }

    btnVerifySource.disabled = true;
    btnVerifySource.innerText = 'Verifying...';
    sourceStatusDisplay.classList.add('hidden');

    try {
      if (verifiedDestId) {
        const nestCheck = await window.api.checkNesting(sourceId, verifiedDestId);
        if (nestCheck.nested) {
          alert('Invalid Paths Config: ' + nestCheck.reason);
          return;
        }
      }

      const folderName = await window.api.getFolderName(sourceId);
      verifiedSourceId = sourceId;
      sourceStatusDisplay.innerHTML = `Verified Source: <strong>${escapeHtml(folderName)}</strong>`;
      sourceStatusDisplay.classList.remove('hidden');
      checkUnlockingScanTab(onPathsVerifiedCallback);
    } catch (err) {
      alert('Failed to verify source path: ' + err.message);
    } finally {
      btnVerifySource.disabled = false;
      btnVerifySource.innerText = 'Verify & Set Source';
    }
  });

  // Verify and Set Destination ID handler
  btnVerifyDest.addEventListener('click', async () => {
    let destId = '';
    if (destTabCustom.classList.contains('active')) {
      destId = destIdInput.value.trim();
    } else {
      destId = destListSelect.value;
    }

    if (!destId) {
      alert('Please enter or select a destination folder/drive.');
      return;
    }

    btnVerifyDest.disabled = true;
    btnVerifyDest.innerText = 'Verifying...';
    destStatusDisplay.classList.add('hidden');

    try {
      if (verifiedSourceId) {
        const nestCheck = await window.api.checkNesting(verifiedSourceId, destId);
        if (nestCheck.nested) {
          alert('Invalid Paths Config: ' + nestCheck.reason);
          return;
        }
      }

      const folderName = await window.api.getFolderName(destId);
      verifiedDestId = destId;
      destStatusDisplay.innerHTML = `Verified Destination: <strong>${escapeHtml(folderName)}</strong>`;
      destStatusDisplay.classList.remove('hidden');
      checkUnlockingScanTab(onPathsVerifiedCallback);
    } catch (err) {
      alert('Failed to verify destination path: ' + err.message);
    } finally {
      btnVerifyDest.disabled = false;
      btnVerifyDest.innerText = 'Verify & Set Destination';
    }
  });

  // Login click handler
  btnLogin.addEventListener('click', async () => {
    if (!appConfig.clientId || !appConfig.clientSecret) {
      alert('Please configure GCP OAuth Client ID and Secret in the Settings tab first.');
      return;
    }
    btnLogin.disabled = true;
    btnLogin.innerHTML = `Authenticating...`;

    try {
      await window.api.startOAuth();
      await checkAuthentication();
    } catch (err) {
      console.error(err);
      alert('Authentication failed: ' + err.message);
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerHTML = `Sign in with Google`;
    }
  });

  // Logout click handler
  btnLogout.addEventListener('click', async () => {
    if (confirm('Are you sure you want to sign out?')) {
      await window.api.logout();
      await checkAuthentication();
    }
  });

  // Import JSON configuration
  btnImportJson.addEventListener('click', async () => {
    try {
      const credentials = await window.api.selectCredentialsJson();
      if (credentials) {
        settingsClientId.value = credentials.clientId;
        settingsClientSecret.value = credentials.clientSecret;
      }
    } catch (err) {
      alert('Failed to import: ' + err.message);
    }
  });

  // Open Log file handler
  btnOpenLog.addEventListener('click', async () => {
    try {
      await window.api.openLogFile();
    } catch (err) {
      alert('Failed to open log file: ' + err.message);
    }
  });

  // Reset auth credentials
  btnResetAuth.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all credentials and sign out?')) {
      try {
        const resetConfig = {
          clientId: '',
          clientSecret: '',
          refreshToken: ''
        };
        appConfig = await window.api.saveConfig(resetConfig);
        await refreshConfig();
        await checkAuthentication();
        alert('Credentials and session reset successfully.');
      } catch (err) {
        alert('Reset failed: ' + err.message);
      }
    }
  });

  // Save Settings handler
  btnSaveSettings.addEventListener('click', async () => {
    const newConfig = {
      clientId: settingsClientId.value.trim(),
      clientSecret: settingsClientSecret.value.trim(),
      collisionSetting: settingsCollision.value,
      recreateFolderStructure: settingsStructureOption.value === 'recreate',
      structureOption: settingsStructureOption.value,
      leaveShortcutAtSource: settingsLeaveShortcut.checked,
      resolveShortcutsRecursively: settingsResolveShortcuts.checked,
      copyOnMoveFailure: settingsCopyFallback.checked,
      ensureAccessibilityOnMove: settingsAccessibilityCheck.checked,
      concurrentTransfers: parseInt(settingsConcurrency.value, 10) || 3
    };

    try {
      appConfig = await window.api.saveConfig(newConfig);
      showToast(toastSaveSuccess);
      await refreshConfig();
      await checkAuthentication();
    } catch (err) {
      showToast(toastSaveError);
    }
  });

  // Check auth on load
  await checkAuthentication();
}

export async function refreshConfig() {
  appConfig = await window.api.getConfig();

  // Populate settings fields
  settingsClientId.value = appConfig.clientId || '';
  settingsClientSecret.value = appConfig.clientSecret || '';
  settingsCollision.value = appConfig.collisionSetting || 'skip';
  settingsStructureOption.value = appConfig.structureOption || (appConfig.recreateFolderStructure === false ? 'flat' : 'recreate');
  settingsLeaveShortcut.checked = appConfig.leaveShortcutAtSource === true;
  settingsResolveShortcuts.checked = appConfig.resolveShortcutsRecursively === true;
  settingsCopyFallback.checked = appConfig.copyOnMoveFailure === true;
  settingsAccessibilityCheck.checked = appConfig.ensureAccessibilityOnMove === true;
  settingsConcurrency.value = appConfig.concurrentTransfers || 3;
  settingsConcurrencyValue.innerText = appConfig.concurrentTransfers || 3;
}

export async function checkAuthentication() {
  currentAuthStatus = await window.api.checkAuth();

  if (currentAuthStatus.authenticated) {
    statusPill.className = 'connection-status-pill connected';
    statusText.innerText = 'Connected';

    unauthSection.classList.add('hidden');
    authSection.classList.remove('hidden');

    const name = currentAuthStatus.user.displayName || 'Google User';
    const email = currentAuthStatus.user.emailAddress || 'Connected';
    userDisplayName.innerText = name;
    userEmailAddress.innerText = email;
    userAvatarInitials.innerText = name.charAt(0).toUpperCase();

    sourceSelectorCard.classList.remove('disabled');
    destSelectorCard.classList.remove('disabled');
    if (navLister) navLister.removeAttribute('disabled');

    // Only show tip widget for non-academic (.edu) authenticated users
    const isEdu = email.toLowerCase().endsWith('.edu');
    if (isEdu) {
      tipLink.classList.add('hidden');
    } else {
      tipLink.classList.remove('hidden');
    }
  } else {
    statusPill.className = 'connection-status-pill disconnected';
    statusText.innerText = 'Disconnected';

    unauthSection.classList.remove('hidden');
    authSection.classList.add('hidden');

    sourceSelectorCard.classList.add('disabled');
    destSelectorCard.classList.add('disabled');
    navScan.setAttribute('disabled', 'true');
    navTransfer.setAttribute('disabled', 'true');
    if (navLister) navLister.setAttribute('disabled', 'true');

    // Hide tip widget if disconnected
    tipLink.classList.add('hidden');
  }
}

// --- PRIVATE HELPERS ---

async function loadSharedDrivesDropdown(selectElement) {
  selectElement.innerHTML = `<option value="" disabled selected>Loading drives...</option>`;
  try {
    const drives = await window.api.listSharedDrives();
    if (drives.length === 0) {
      selectElement.innerHTML = `<option value="" disabled>No Shared Drives found</option>`;
      return;
    }
    selectElement.innerHTML = drives.map(d =>
      `<option value="${d.id}">${escapeHtml(d.name)}</option>`
    ).join('');
  } catch (err) {
    selectElement.innerHTML = `<option value="" disabled>Error loading Shared Drives</option>`;
  }
}

function checkUnlockingScanTab(onPathsVerifiedCallback) {
  if (verifiedSourceId && verifiedDestId) {
    onPathsVerifiedCallback();
  }
}

function showToast(element) {
  element.classList.remove('hidden');
  setTimeout(() => {
    element.classList.add('hidden');
  }, 4000);
}
