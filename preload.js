const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config Manager
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (newConfig) => ipcRenderer.invoke('save-config', newConfig),

  // Auth Operations
  startOAuth: () => ipcRenderer.invoke('start-oauth'),
  logout: () => ipcRenderer.invoke('logout'),
  checkAuth: () => ipcRenderer.invoke('check-auth'),

  // Drive Operations
  listSharedDrives: () => ipcRenderer.invoke('list-shared-drives'),
  listFolder: (folderId) => ipcRenderer.invoke('list-folder', folderId),
  getFolderName: (folderId) => ipcRenderer.invoke('get-folder-name', folderId),

  // Local I/O Credentials Chooser & Log Opener
  selectCredentialsJson: () => ipcRenderer.invoke('select-credentials-json'),
  openLogFile: () => ipcRenderer.invoke('open-log-file'),
  getResumeCheckpoint: () => ipcRenderer.invoke('get-resume-checkpoint'),
  clearResumeCheckpoint: () => ipcRenderer.invoke('clear-resume-checkpoint'),
  getLastResults: () => ipcRenderer.invoke('get-last-results'),
  clearLastResults: () => ipcRenderer.invoke('clear-last-results'),
  exportCsv: (rows) => ipcRenderer.invoke('export-csv', rows),
  checkNesting: (sourceId, destId) => ipcRenderer.invoke('check-nesting', { sourceId, destId }),

  // Scanner Controls
  startScan: (sourceId, filterPattern, filterType, mimeFilters, dateAfter, dateBefore, recurseShared) => 
    ipcRenderer.invoke('start-scan', { sourceId, filterPattern, filterType, mimeFilters, dateAfter, dateBefore, recurseShared }),
  cancelScan: () => ipcRenderer.invoke('cancel-scan'),

  // Scanner Listeners
  onScanStarted: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('scan-started', handler);
    return () => ipcRenderer.removeListener('scan-started', handler);
  },
  onScanProgress: (callback) => {
    const handler = (event, count) => callback(count);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },
  onScanSuccess: (callback) => {
    const handler = (event, files) => callback(files);
    ipcRenderer.on('scan-success', handler);
    return () => ipcRenderer.removeListener('scan-success', handler);
  },
  onScanCancelled: (callback) => {
    const handler = (event, files) => callback(files);
    ipcRenderer.on('scan-cancelled', handler);
    return () => ipcRenderer.removeListener('scan-cancelled', handler);
  },
  onScanError: (callback) => {
    const handler = (event, message) => callback(message);
    ipcRenderer.on('scan-error', handler);
    return () => ipcRenderer.removeListener('scan-error', handler);
  },

  // Transfer Controls
  startTransfer: (sourceId, destId, selectionMap, filesList, isResume) => 
    ipcRenderer.invoke('start-transfer', { sourceId, destId, selectionMap, filesList, isResume }),
  startDryRun: (sourceId, destId, selectionMap, filesList) => 
    ipcRenderer.invoke('start-dry-run', { sourceId, destId, selectionMap, filesList }),
  cancelTransfer: () => ipcRenderer.invoke('cancel-transfer'),

  // Transfer Listeners
  onTransferStarted: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('transfer-started', handler);
    return () => ipcRenderer.removeListener('transfer-started', handler);
  },
  onTransferProgress: (callback) => {
    const handler = (event, stats) => callback(stats);
    ipcRenderer.on('transfer-progress', handler);
    return () => ipcRenderer.removeListener('transfer-progress', handler);
  },
  onTransferFileStart: (callback) => {
    const handler = (event, file) => callback(file);
    ipcRenderer.on('transfer-file-start', handler);
    return () => ipcRenderer.removeListener('transfer-file-start', handler);
  },
  onTransferFileComplete: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('transfer-file-complete', handler);
    return () => ipcRenderer.removeListener('transfer-file-complete', handler);
  },
  onTransferSuccess: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('transfer-success', handler);
    return () => ipcRenderer.removeListener('transfer-success', handler);
  },
  onTransferCancelled: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('transfer-cancelled', handler);
    return () => ipcRenderer.removeListener('transfer-cancelled', handler);
  },
  onTransferError: (callback) => {
    const handler = (event, message) => callback(message);
    ipcRenderer.on('transfer-error', handler);
    return () => ipcRenderer.removeListener('transfer-error', handler);
  },

  // Dry-Run Listeners
  onDryRunStarted: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('dry-run-started', handler);
    return () => ipcRenderer.removeListener('dry-run-started', handler);
  },
  onDryRunProgress: (callback) => {
    const handler = (event, stats) => callback(stats);
    ipcRenderer.on('dry-run-progress', handler);
    return () => ipcRenderer.removeListener('dry-run-progress', handler);
  },
  onDryRunFileStart: (callback) => {
    const handler = (event, file) => callback(file);
    ipcRenderer.on('dry-run-file-start', handler);
    return () => ipcRenderer.removeListener('dry-run-file-start', handler);
  },
  onDryRunFileComplete: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('dry-run-file-complete', handler);
    return () => ipcRenderer.removeListener('dry-run-file-complete', handler);
  },
  onDryRunComplete: (callback) => {
    const handler = (event, results) => callback(results);
    ipcRenderer.on('dry-run-complete', handler);
    return () => ipcRenderer.removeListener('dry-run-complete', handler);
  },
  onDryRunCancelled: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('dry-run-cancelled', handler);
    return () => ipcRenderer.removeListener('dry-run-cancelled', handler);
  },
  onDryRunError: (callback) => {
    const handler = (event, message) => callback(message);
    ipcRenderer.on('dry-run-error', handler);
    return () => ipcRenderer.removeListener('dry-run-error', handler);
  },
  onLogLine: (callback) => {
    const handler = (event, line) => callback(line);
    ipcRenderer.on('log-line', handler);
    return () => ipcRenderer.removeListener('log-line', handler);
  },

  // Lister Controls
  startListerScan: (targetId) => ipcRenderer.invoke('start-lister-scan', { targetId }),
  cancelListerScan: () => ipcRenderer.invoke('cancel-lister-scan'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),

  // Lister Listeners
  onListerStarted: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('lister-started', handler);
    return () => ipcRenderer.removeListener('lister-started', handler);
  },
  onListerProgress: (callback) => {
    const handler = (event, stats) => callback(stats);
    ipcRenderer.on('lister-progress', handler);
    return () => ipcRenderer.removeListener('lister-progress', handler);
  },
  onListerSaving: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('lister-saving', handler);
    return () => ipcRenderer.removeListener('lister-saving', handler);
  },
  onListerSuccess: (callback) => {
    const handler = (event, filePath) => callback(filePath);
    ipcRenderer.on('lister-success', handler);
    return () => ipcRenderer.removeListener('lister-success', handler);
  },
  onListerCancelled: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('lister-cancelled', handler);
    return () => ipcRenderer.removeListener('lister-cancelled', handler);
  },
  onListerCancelledSave: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('lister-cancelled-save', handler);
    return () => ipcRenderer.removeListener('lister-cancelled-save', handler);
  },
  onListerEmpty: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('lister-empty', handler);
    return () => ipcRenderer.removeListener('lister-empty', handler);
  },
  onListerError: (callback) => {
    const handler = (event, message) => callback(message);
    ipcRenderer.on('lister-error', handler);
    return () => ipcRenderer.removeListener('lister-error', handler);
  },

  getPlatform: () => process.platform
});

