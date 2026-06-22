const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const crypto = require('crypto');

// --- SECURITY & ID SANITIZATION HELPERS ---
function safeDriveId(id) {
  if (!id) return '';
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

// --- LOGGER SERVICE ---
class Logger {
  constructor() {
    this.logPath = path.join(app.getPath('userData'), 'transfer-log.txt');
    this.buffer = [];
    this.flushInterval = setInterval(() => this.flush(), 500);
    if (typeof this.flushInterval.unref === 'function') {
      this.flushInterval.unref();
    }
    // Clear log or ensure it exists
    try {
      fs.writeFileSync(this.logPath, `--- TRANSFER LOG STARTED: ${new Date().toLocaleString()} ---\r\n`, 'utf8');
    } catch (err) {
      console.error('Failed to initialize log file:', err);
    }
  }

  log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\r\n`;
    this.buffer.push(line);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-line', line.trim());
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    fs.appendFile(this.logPath, batch.join(''), 'utf8', (err) => {
      if (err) {
        console.error('Failed to write log batch:', err);
      }
    });
  }

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

let logger;

// --- CONFIGURATION MANAGER ---
class ConfigManager {
  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'transfer-config.json');
    this.defaultConfig = {
      clientId: '',
      clientSecret: '',
      refreshToken: '',
      emailFilterPattern: '',
      emailFilterType: 'starts-with',
      recreateFolderStructure: true,
      structureOption: 'recreate',
      leaveShortcutAtSource: false,
      resolveShortcutsRecursively: false,
      copyOnMoveFailure: false,
      ensureAccessibilityOnMove: true,
      collisionSetting: 'skip',
      concurrentTransfers: 3
    };
    this.config = this.load();
  }

  encrypt(str) {
    if (!str) return '';
    if (!safeStorage.isEncryptionAvailable()) return str;
    try {
      const encryptedBuffer = safeStorage.encryptString(str);
      return encryptedBuffer.toString('base64');
    } catch (err) {
      console.error('Encryption failed:', err);
      return str;
    }
  }

  decrypt(str) {
    if (!str) return '';
    if (!safeStorage.isEncryptionAvailable()) return str;
    try {
      const buffer = Buffer.from(str, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (err) {
      return str;
    }
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(data);
        
        if (parsed.clientSecret) {
          parsed.clientSecret = this.decrypt(parsed.clientSecret);
        }
        if (parsed.refreshToken) {
          parsed.refreshToken = this.decrypt(parsed.refreshToken);
        }
        
        return { ...this.defaultConfig, ...parsed };
      }
    } catch (err) {
      console.error('Failed to load config, using defaults:', err);
    }
    return { ...this.defaultConfig };
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const configToSave = { ...this.config };
      
      if (configToSave.clientSecret) {
        configToSave.clientSecret = this.encrypt(configToSave.clientSecret);
      }
      if (configToSave.refreshToken) {
        configToSave.refreshToken = this.encrypt(configToSave.refreshToken);
      }

      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
    this.save();
  }

  getAll() {
    return this.config;
  }

  setAll(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.save();
  }
}

let configManager;
let mainWindow;
let activeOAuthServer = null;

// --- GOOGLE API HELPERS ---
function getOAuthClient(redirectUri = 'http://127.0.0.1') {
  const clientId = configManager.get('clientId');
  const clientSecret = configManager.get('clientSecret');
  if (!clientId || !clientSecret) {
    throw new Error('OAuth Client ID and Client Secret are not configured.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getDriveClient() {
  const oauth2Client = getOAuthClient();
  const refreshToken = configManager.get('refreshToken');
  if (!refreshToken) {
    throw new Error('User is not authenticated. Please log in first.');
  }

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.getAccessToken();
  return google.drive({ version: 'v3', auth: oauth2Client });
}

// --- WINDOW MANAGEMENT ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (activeOAuthServer) {
      activeOAuthServer.close();
    }
  });
}

// --- EXECUTE WITH RETRY HELPER ---
async function executeWithRetry(fn, retries = 3, initialDelay = 1000) {
  let delay = initialDelay;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message === 'Cancelled') throw err;

      const code = err.code || err.response?.status;
      // Don't retry on permanent client errors
      if (code && code >= 400 && code < 500 && code !== 429) throw err;

      if (attempt === retries) throw err;
      logger.log(`API attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

// --- INITIALIZE APPLICATION ---
app.whenReady().then(() => {
  logger = new Logger();
  configManager = new ConfigManager();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (logger) logger.destroy();
});

// --- IPC EVENT HANDLERS ---

// 1. Config & Log operations
ipcMain.handle('get-config', () => {
  const config = configManager.getAll();
  return {
    ...config,
    clientSecret: config.clientSecret ? '••••••' : '',
    refreshToken: config.refreshToken ? '••••••' : ''
  };
});

ipcMain.handle('save-config', (event, newConfig) => {
  if (typeof newConfig !== 'object' || newConfig === null) {
    const config = configManager.getAll();
    return {
      ...config,
      clientSecret: config.clientSecret ? '••••••' : '',
      refreshToken: config.refreshToken ? '••••••' : ''
    };
  }
  const allowedKeys = [
    'clientId', 'clientSecret', 'refreshToken', 'emailFilterPattern', 
    'emailFilterType', 'recreateFolderStructure', 'resolveShortcutsRecursively', 
    'copyOnMoveFailure', 'ensureAccessibilityOnMove', 
    'structureOption', 'leaveShortcutAtSource', 'collisionSetting', 'concurrentTransfers'
  ];
  const sanitizedConfig = {};
  for (const key of allowedKeys) {
    if (newConfig[key] !== undefined) {
      if (key === 'clientSecret' && newConfig[key] === '••••••') {
        continue;
      }
      if (key === 'refreshToken' && newConfig[key] === '••••••') {
        continue;
      }
      sanitizedConfig[key] = newConfig[key];
    }
  }
  configManager.setAll(sanitizedConfig);
  logger.log('Configuration saved/updated.');
  
  const config = configManager.getAll();
  return {
    ...config,
    clientSecret: config.clientSecret ? '••••••' : '',
    refreshToken: config.refreshToken ? '••••••' : ''
  };
});

ipcMain.handle('open-log-file', async () => {
  try {
    await shell.openPath(logger.logPath);
    return { success: true };
  } catch (err) {
    logger.log(`Failed to open log file: ${err.message}`);
    throw err;
  }
});

// 2. Authentication Flow
ipcMain.handle('start-oauth', async () => {
  if (activeOAuthServer) {
    activeOAuthServer.close();
  }

  const stateToken = crypto.randomBytes(32).toString('hex');
  logger.log('OAuth process initiated.');

  return new Promise((resolve, reject) => {
    const serverTimeout = setTimeout(() => {
      if (activeOAuthServer) {
        activeOAuthServer.close();
        activeOAuthServer = null;
        logger.log('OAuth server timed out.');
        wrappedReject(new Error('Authentication timed out. Please try again.'));
      }
    }, 2 * 60 * 1000);

    const wrappedResolve = (value) => {
      clearTimeout(serverTimeout);
      resolve(value);
    };

    const wrappedReject = (err) => {
      clearTimeout(serverTimeout);
      reject(err);
    };

    activeOAuthServer = http.createServer(async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url, true);
        if (parsedUrl.pathname === '/') {
          const code = parsedUrl.query.code;
          const returnedState = parsedUrl.query.state;

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing auth code.');
            wrappedReject(new Error('OAuth code not found in callback.'));
            activeOAuthServer.close();
            activeOAuthServer = null;
            return;
          }

          if (returnedState !== stateToken) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid state parameter. CSRF attempt detected.');
            wrappedReject(new Error('CSRF state mismatch.'));
            activeOAuthServer.close();
            activeOAuthServer = null;
            return;
          }

          const redirectUri = `http://127.0.0.1:${activeOAuthServer.address().port}`;
          const oauth2Client = getOAuthClient(redirectUri);
          const { tokens } = await oauth2Client.getToken(code);

          if (tokens.refresh_token) {
            configManager.set('refreshToken', tokens.refresh_token);
            logger.log('OAuth refresh token saved successfully.');
          } else {
            const existing = configManager.get('refreshToken');
            if (!existing) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('No refresh token returned. Please revoke access and try again.');
              wrappedReject(new Error('No refresh token returned by Google.'));
              activeOAuthServer.close();
              activeOAuthServer = null;
              return;
            }
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #0b0f19; color: #f3f4f6; margin: 0;">
                <div style="text-align: center; padding: 40px; border-radius: 12px; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 4px 30px rgba(0,0,0,0.5); backdrop-filter: blur(12px);">
                  <h1 style="color: #10b981; margin: 0 0 16px 0; font-size: 24px;">Authentication Successful!</h1>
                  <p style="font-size: 15px; color: #9ca3af; margin: 0 0 24px 0;">You can close this window and return to the application.</p>
                  <div style="font-size: 11px; color: #6b7280; letter-spacing: 0.05em; text-transform: uppercase;">Google Drive Move to Shared Drive</div>
                </div>
              </body>
            </html>
          `);

          wrappedResolve({ success: true });
          setTimeout(() => {
            if (activeOAuthServer) {
              activeOAuthServer.close();
              activeOAuthServer = null;
            }
          }, 200);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error during authentication callback: ' + err.message);
        wrappedReject(err);
        if (activeOAuthServer) {
          activeOAuthServer.close();
          activeOAuthServer = null;
        }
      }
    });

    activeOAuthServer.listen(0, '127.0.0.1', (err) => {
      if (err) {
        wrappedReject(err);
      } else {
        const port = activeOAuthServer.address().port;
        const redirectUri = `http://127.0.0.1:${port}`;
        const oauth2Client = getOAuthClient(redirectUri);
        
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          state: stateToken,
          scope: ['https://www.googleapis.com/auth/drive'] // Requesting write permission for migrations
        });
        shell.openExternal(authUrl);
      }
    });
  });
});

ipcMain.handle('logout', () => {
  configManager.set('refreshToken', '');
  logger.log('User logged out.');
  return { success: true };
});

ipcMain.handle('check-auth', async () => {
  try {
    const drive = await getDriveClient();
    const about = await drive.about.get({ fields: 'user(displayName, emailAddress)' });
    return { authenticated: true, user: about.data.user };
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
});

// 3. Drive API Operations
ipcMain.handle('list-shared-drives', async () => {
  try {
    const drive = await getDriveClient();
    let drives = [];
    let pageToken = null;
    do {
      const response = await drive.drives.list({
        pageSize: 100,
        fields: 'nextPageToken, drives(id, name)',
        pageToken: pageToken
      });
      if (response.data.drives) {
        drives = drives.concat(response.data.drives);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    return drives;
  } catch (err) {
    logger.log(`Failed to list shared drives: ${err.message}`);
    throw err;
  }
});

ipcMain.handle('get-folder-name', async (event, folderId) => {
  try {
    if (folderId === 'root') return 'My Drive';
    if (folderId === 'shared-with-me') return 'Shared With Me';
    const drive = await getDriveClient();
    try {
      const sdResponse = await drive.drives.get({ driveId: folderId });
      return sdResponse.data.name;
    } catch (sdErr) {
      const response = await drive.files.get({
        fileId: folderId,
        fields: 'name',
        supportsAllDrives: true
      });
      return response.data.name;
    }
  } catch (err) {
    return `Folder (${folderId})`;
  }
});
ipcMain.handle('check-nesting', async (event, { sourceId, destId }) => {
  if (sourceId === destId) {
    return { nested: true, reason: 'Source and destination locations are identical.' };
  }
  if (sourceId === 'shared-with-me') {
    return { nested: false };
  }
  // Standardize My Drive root ID
  const src = sourceId === '' ? 'root' : sourceId;
  const dst = destId === '' ? 'root' : destId;

  if (src === dst) {
    return { nested: true, reason: 'Source and destination locations are identical.' };
  }

  try {
    const drive = await getDriveClient();
    const nested = await isFolderNested(drive, dst, src);
    if (nested) {
      return { nested: true, reason: 'The destination folder is located inside the source folder, which would cause infinite scanning loops.' };
    }
    return { nested: false };
  } catch (err) {
    logger.log(`Nesting check error: ${err.message}`);
    return { nested: false };
  }
});

// Simple cache for parent-chain queries to avoid repeated API calls
const nestingCheckCache = new Map(); // childFolderId -> parentFolderId (or null)

async function isFolderNested(drive, childFolderId, ancestorFolderId) {
  if (childFolderId === ancestorFolderId) return true;
  if (childFolderId === 'root') return false;

  const visited = new Set([childFolderId]);
  let currentId = childFolderId;
  const MAX_DEPTH = 20;
  let depth = 0;

  while (depth < MAX_DEPTH) {
    depth++;
    try {
      let parents = [];
      if (nestingCheckCache.has(currentId)) {
        const cachedParent = nestingCheckCache.get(currentId);
        parents = cachedParent ? [cachedParent] : [];
      } else {
        const fileMeta = await executeWithRetry(async () => {
          return await drive.files.get({
            fileId: currentId,
            fields: 'id, parents',
            supportsAllDrives: true
          });
        }, 3, 1000);

        parents = fileMeta.data.parents || [];
        if (parents.length > 0) {
          nestingCheckCache.set(currentId, parents[0]);
        } else {
          nestingCheckCache.set(currentId, null);
        }
      }

      if (parents.length === 0) {
        break;
      }

      if (parents.includes(ancestorFolderId)) {
        return true;
      }

      // If checking if ancestor is My Drive ('root')
      if (ancestorFolderId === 'root' && (parents.includes('root') || parents.includes('My Drive'))) {
        return true;
      }

      const nextId = parents[0];
      if (!nextId || visited.has(nextId)) {
        break;
      }
      visited.add(nextId);
      currentId = nextId;
    } catch (err) {
      // Access error or reached top-level Shared Drive
      break;
    }
  }
  return false;
}
ipcMain.handle('select-credentials-json', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON Credentials', extensions: ['json'] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const filePath = result.filePaths[0];
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(data);
    const credentials = parsed.installed || parsed.web;
    if (!credentials) {
      throw new Error('Invalid credentials format. Must be nested inside "installed" or "web".');
    }
    return {
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret
    };
  } catch (err) {
    logger.log(`Failed to parse imported json: ${err.message}`);
    throw err;
  }
});

// --- SCANNING ENGINE ---
let currentScanTask = null;

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function getMimeCategory(mimeType) {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    return 'google-apps';
  }
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'other';
}

ipcMain.handle('start-scan', async (event, { sourceId, filterPattern, filterType, mimeFilters, dateAfter, dateBefore, recurseShared }) => {
  if (currentScanTask) {
    throw new Error('A scan is already in progress.');
  }

  // Pre-validate Regex filter to prevent syntax issues or catastrophically long patterns (ReDoS prevention)
  if (filterType === 'regex' && filterPattern) {
    if (filterPattern.length > 200) {
      throw new Error('Regex filter pattern is too long (maximum 200 characters).');
    }
    try {
      new RegExp(filterPattern, 'i');
    } catch (rxErr) {
      throw new Error(`Invalid regex pattern: ${rxErr.message}`);
    }
  }

  currentScanTask = { cancelled: false };
  mainWindow.webContents.send('scan-started');
  logger.log(`Starting scan on source folder: ${sourceId} with filter ${filterType} = "${filterPattern}", MIME filters: [${mimeFilters || ''}], dates: [${dateAfter || ''} to ${dateBefore || ''}]`);

  try {
    const drive = await getDriveClient();
    const eligibleFiles = [];
    const scannedFolderIds = new Set();
    const resolveShortcuts = configManager.get('resolveShortcutsRecursively') === true;
    const sourceFoldersMap = {};

    let totalScanned = 0;
    let lastProgressSent = Date.now();
    function throttleProgressUpdate(force = false) {
      const now = Date.now();
      if (force || now - lastProgressSent > 150) {
        mainWindow.webContents.send('scan-progress', {
          eligibleCount: eligibleFiles.length,
          scannedCount: totalScanned
        });
        lastProgressSent = now;
      }
    }

    async function scanFolder(folderId, currentRelPath, folderMeta = null) {
      if (currentScanTask.cancelled) return;
      if (scannedFolderIds.has(folderId)) {
        logger.log(`Circular folder reference detected for folder: ${folderId}. Skipping.`);
        return;
      }
      scannedFolderIds.add(folderId);

      if (currentRelPath) {
        sourceFoldersMap[currentRelPath] = folderId;
      }

      let pageToken = null;
      let hasChildren = false;
      do {
        if (currentScanTask.cancelled) break;
        const safeFolderId = safeDriveId(folderId);
        const query = folderId === 'shared-with-me'
          ? 'sharedWithMe = true and trashed = false'
          : `'${safeFolderId}' in parents and trashed = false`;
        const response = await executeWithRetry(async () => {
          return await drive.files.list({
            q: query,
            pageSize: 1000,
            fields: 'nextPageToken, files(id, name, mimeType, size, owners(displayName, emailAddress), parents, createdTime, modifiedTime, shortcutDetails)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageToken: pageToken
          });
        }, 5, 1000);

        const items = response.data.files || [];
        if (items.length > 0) {
          hasChildren = true;
        }
        for (const item of items) {
          if (currentScanTask.cancelled) break;
          totalScanned++;

          const isShortcut = item.mimeType === 'application/vnd.google-apps.shortcut';
          const targetMimeType = isShortcut && item.shortcutDetails ? item.shortcutDetails.targetMimeType : null;
          const targetId = isShortcut && item.shortcutDetails ? item.shortcutDetails.targetId : item.id;
          
          const isFolder = item.mimeType === 'application/vnd.google-apps.folder' || 
            (isShortcut && resolveShortcuts && targetMimeType === 'application/vnd.google-apps.folder');

          const relativePath = path.join(currentRelPath, sanitizeFilename(item.name));

          if (isFolder) {
            // Recurse down folder structure if not disabled for shared-with-me
            if (folderId !== 'shared-with-me' || recurseShared !== false) {
              await scanFolder(targetId, relativePath, item);
            }
          } else {
            // Check if it matches owner email pattern
            let ownerEmail = '';
            let ownerName = '';
            if (item.owners && item.owners.length > 0) {
              ownerName = item.owners[0].displayName || '';
              ownerEmail = item.owners[0].emailAddress || '';
            }

            let isMatch = false;
            if (!filterPattern) {
              isMatch = true;
            } else {
              const emailLower = ownerEmail.toLowerCase();
              const patternLower = filterPattern.toLowerCase();

              if (filterType === 'starts-with') {
                isMatch = emailLower.startsWith(patternLower);
              } else if (filterType === 'ends-with') {
                isMatch = emailLower.endsWith(patternLower);
              } else if (filterType === 'exact') {
                isMatch = (emailLower === patternLower);
              } else if (filterType === 'contains') {
                isMatch = emailLower.includes(patternLower);
              } else if (filterType === 'regex') {
                try {
                  if (filterPattern.length > 200) throw new Error('Pattern too long');
                  const rx = new RegExp(filterPattern, 'i');
                  isMatch = rx.test(ownerEmail);
                } catch (_) {
                  isMatch = false;
                }
              }
            }

            // Apply secondary MIME type filters
            if (isMatch && mimeFilters && mimeFilters.length > 0) {
              const targetMime = isShortcut ? (targetMimeType || item.mimeType) : item.mimeType;
              const category = getMimeCategory(targetMime);
              if (!mimeFilters.includes(category)) {
                isMatch = false;
              }
            }

            // Apply secondary date modified filters
            if (isMatch) {
              if (dateAfter && item.modifiedTime) {
                const modifiedTime = new Date(item.modifiedTime);
                const afterDate = new Date(dateAfter);
                if (modifiedTime < afterDate) {
                  isMatch = false;
                }
              }
              if (dateBefore && item.modifiedTime) {
                const modifiedTime = new Date(item.modifiedTime);
                const beforeDate = new Date(dateBefore);
                beforeDate.setHours(23, 59, 59, 999);
                if (modifiedTime > beforeDate) {
                  isMatch = false;
                }
              }
            }

            if (isMatch) {
              eligibleFiles.push({
                id: item.id,
                name: item.name,
                mimeType: isShortcut ? (targetMimeType || item.mimeType) : item.mimeType,
                size: isShortcut ? 0 : parseInt(item.size || 0, 10),
                ownerName,
                ownerEmail,
                parents: item.parents || [],
                relativePath,
                isShortcut
              });
              throttleProgressUpdate();
            }
          }
          throttleProgressUpdate();
        }
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    }

    await scanFolder(sourceId, '', null);

    if (currentScanTask.cancelled) {
      logger.log(`Scan cancelled by user. Returning ${eligibleFiles.length} files found before cancellation.`);
      mainWindow.webContents.send('scan-cancelled', eligibleFiles);
      currentScanTask = null;
      return eligibleFiles;
    }

    // Ensure we send the final exact count at scan completion
    mainWindow.webContents.send('scan-progress', {
      eligibleCount: eligibleFiles.length,
      scannedCount: totalScanned
    });

    lastSourceFoldersMap = sourceFoldersMap;

    logger.log(`Scan complete. Found ${eligibleFiles.length} eligible files.`);
    mainWindow.webContents.send('scan-success', eligibleFiles);
    
    if (Notification.isSupported()) {
      new Notification({
        title: 'Scan Completed',
        body: `Found ${eligibleFiles.length} files matching the filter criteria.`
      }).show();
    }
    
    currentScanTask = null;
    return eligibleFiles;

  } catch (err) {
    logger.log(`Scan failed with error: ${err.message}`);
    mainWindow.webContents.send('scan-error', err.message);
    currentScanTask = null;
    throw err;
  }
});

ipcMain.handle('cancel-scan', () => {
  if (currentScanTask) {
    currentScanTask.cancelled = true;
    logger.log('Scan cancelled by user.');
    return { success: true };
  }
  return { success: false };
});

// --- TRANSFER ENGINE ---
let lastSourceFoldersMap = {};
let currentTransferTask = null;

// Helper to fetch direct (explicit) permissions of an item
async function fetchDirectPermissions(drive, fileId) {
  try {
    const response = await executeWithRetry(async () => {
      return await drive.permissions.list({
        fileId: fileId,
        fields: 'permissions(id, role, type, emailAddress, domain, displayName, inherited)',
        supportsAllDrives: true
      });
    }, 3, 1000);
    
    // Filter out permissions that are inherited
    return (response.data.permissions || []).filter(p => !p.inherited);
  } catch (err) {
    logger.log(`Failed to fetch permissions for item ${fileId}: ${err.message}`);
    return [];
  }
}

// Helper to restore direct permissions to an item in its new destination
async function restorePermissions(drive, fileId, permissionsList) {
  for (const perm of permissionsList) {
    // We only replicate user/group direct shares. Anyone/domain shares can also be handled.
    if (perm.type === 'anyone') {
      try {
        await executeWithRetry(async () => {
          return await drive.permissions.create({
            fileId: fileId,
            resource: { role: perm.role, type: 'anyone' },
            supportsAllDrives: true,
            sendNotificationEmail: false
          });
        }, 2, 1000);
      } catch (_) {}
    } else if (perm.emailAddress) {
      try {
        await executeWithRetry(async () => {
          return await drive.permissions.create({
            fileId: fileId,
            resource: {
              role: perm.role,
              type: perm.type,
              emailAddress: perm.emailAddress
            },
            supportsAllDrives: true,
            sendNotificationEmail: false
          });
        }, 2, 1000);
      } catch (err) {
        logger.log(`Failed restoring permission for ${perm.emailAddress} on item ${fileId}: ${err.message}`);
      }
    }
  }
}

const checkpointPath = path.join(app.getPath('userData'), 'transfer-checkpoint.json');

function saveCheckpoint(data) {
  try {
    fs.writeFileSync(checkpointPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save checkpoint:', err);
  }
}

let checkpointDirty = false;
let lastCheckpointTime = 0;
let pendingCheckpointData = null;

function maybeSaveCheckpoint(data) {
  pendingCheckpointData = data;
  checkpointDirty = true;
  const now = Date.now();
  if (now - lastCheckpointTime > 3000) { // Save at most every 3 seconds
    saveCheckpoint(data);
    lastCheckpointTime = now;
    checkpointDirty = false;
    pendingCheckpointData = null;
  }
}

function forceSaveCheckpoint() {
  if (checkpointDirty && pendingCheckpointData) {
    saveCheckpoint(pendingCheckpointData);
    checkpointDirty = false;
    pendingCheckpointData = null;
  }
}

function clearCheckpoint() {
  try {
    if (fs.existsSync(checkpointPath)) {
      fs.unlinkSync(checkpointPath);
    }
  } catch (err) {
    console.error('Failed to clear checkpoint:', err);
  }
}

ipcMain.handle('get-resume-checkpoint', () => {
  if (fs.existsSync(checkpointPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      // Get selected indices count
      const totalSelected = Object.values(data.selectionMap || {}).filter(Boolean).length;
      const completedCount = Object.keys(data.processedMap || {}).length;
      return {
        exists: true,
        sourceId: data.sourceId,
        destId: data.destId,
        totalFiles: totalSelected,
        completedCount
      };
    } catch (_) {}
  }
  return { exists: false };
});

ipcMain.handle('clear-resume-checkpoint', () => {
  clearCheckpoint();
  return { success: true };
});

const lastResultsPath = path.join(app.getPath('userData'), 'last-transfer-results.json');

function saveLastResults(data) {
  try {
    fs.writeFileSync(lastResultsPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save last results:', err);
  }
}

ipcMain.handle('get-last-results', () => {
  if (fs.existsSync(lastResultsPath)) {
    try {
      return {
        exists: true,
        data: JSON.parse(fs.readFileSync(lastResultsPath, 'utf8'))
      };
    } catch (_) {}
  }
  return { exists: false };
});

ipcMain.handle('clear-last-results', () => {
  try {
    if (fs.existsSync(lastResultsPath)) {
      fs.unlinkSync(lastResultsPath);
    }
  } catch (_) {}
  return { success: true };
});

ipcMain.handle('export-csv', async (event, rows) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export CSV Report',
    defaultPath: path.join(app.getPath('downloads'), `transfer_report_${Date.now()}.csv`),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, cancelled: true };
  }

  try {
    const escapeCsv = (val) => {
      if (val === undefined || val === null) return '""';
      let clean = String(val).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const headers = ['Filename', 'Source Path', 'Destination Path', 'Status', 'Owner', 'Error Message', 'Document ID', 'Drive Link'];
    const lines = [headers.join(',')];

    for (const row of rows) {
      const line = [
        escapeCsv(row.filename),
        escapeCsv(row.sourcePath),
        escapeCsv(row.destinationPath),
        escapeCsv(row.status),
        escapeCsv(row.owner),
        escapeCsv(row.errorMessage),
        escapeCsv(row.documentId),
        escapeCsv(row.driveLink)
      ].join(',');
      lines.push(line);
    }

    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf8');
    logger.log(`Exported CSV report with ${rows.length} rows to ${result.filePath}`);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    logger.log(`Failed to export CSV report: ${err.message}`);
    throw err;
  }
});

async function getUniqueFileName(drive, targetParentFolderId, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const qBase = base.replace(/'/g, "\\'");
  const safeParentId = safeDriveId(targetParentFolderId);
  
  const patternResponse = await executeWithRetry(async () => {
    return await drive.files.list({
      q: `'${safeParentId}' in parents and name contains '${qBase}' and trashed = false`,
      fields: 'files(name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1000
    });
  }, 3, 1000);

  const existingNames = new Set((patternResponse.data.files || []).map(f => f.name));
  let counter = 1;
  while (existingNames.has(`${base} (${counter})${ext}`)) {
    counter++;
  }
  return `${base} (${counter})${ext}`;
}

ipcMain.handle('start-transfer', async (event, { sourceId, destId, selectionMap, filesList, isResume }) => {
  if (currentTransferTask) {
    throw new Error('A transfer task is already active.');
  }

  currentTransferTask = { cancelled: false };
  logger.log(`Starting transfer queue migration to target destination: ${destId} (Resume: ${!!isResume})`);

  try {
    const drive = await getDriveClient();
    const config = configManager.getAll();

    // Perform pre-flight accessibility check if enabled and not resuming
    if (config.ensureAccessibilityOnMove && !isResume) {
      logger.log(`Performing pre-flight accessibility check for destination: ${destId}`);
      let driveId = null;
      let restrictions = null;
      try {
        const driveRes = await drive.drives.get({ driveId: destId });
        driveId = destId;
        restrictions = driveRes.data.restrictions;
      } catch (err) {
        // If 404, check if destId is a folder inside a Shared Drive
        try {
          const fileRes = await drive.files.get({
            fileId: destId,
            fields: 'driveId',
            supportsAllDrives: true
          });
          if (fileRes.data.driveId) {
            driveId = fileRes.data.driveId;
            const driveRes = await drive.drives.get({ driveId: driveId });
            restrictions = driveRes.data.restrictions;
          }
        } catch (fileErr) {
          logger.log(`Failed to resolve destination folder hierarchy: ${fileErr.message}`);
        }
      }

      if (restrictions && (restrictions.driveMembersOnly || restrictions.domainUsersOnly)) {
        logger.log(`Destination Shared Drive has restrictions: driveMembersOnly=${restrictions.driveMembersOnly}, domainUsersOnly=${restrictions.domainUsersOnly}`);
        
        // Fetch Shared Drive members & domains
        const members = new Set();
        const domains = new Set();
        try {
          const permResponse = await drive.permissions.list({
            fileId: driveId,
            supportsAllDrives: true,
            pageSize: 100
          });
          for (const perm of permResponse.data.permissions || []) {
            if (perm.emailAddress) {
              members.add(perm.emailAddress.toLowerCase());
              const parts = perm.emailAddress.split('@');
              if (parts.length > 1) {
                domains.add(parts[1].toLowerCase());
              }
            }
          }
        } catch (permErr) {
          logger.log(`Pre-flight warning: Could not fetch members of Shared Drive ${driveId}: ${permErr.message}`);
        }

        // Scan selected files for owner access loss
        const filesToMigrateSample = filesList.filter((_, idx) => selectionMap[idx] === true);
        const nonMembers = new Set();
        const outsideDomain = new Set();

        for (const file of filesToMigrateSample) {
          if (file.ownerEmail) {
            const email = file.ownerEmail.toLowerCase();
            if (restrictions.driveMembersOnly && !members.has(email)) {
              nonMembers.add(file.ownerEmail);
            }
            if (restrictions.domainUsersOnly) {
              const parts = email.split('@');
              if (parts.length > 1 && !domains.has(parts[1])) {
                outsideDomain.add(file.ownerEmail);
              }
            }
          }
        }

        const affectedEmails = new Set([...nonMembers, ...outsideDomain]);
        if (affectedEmails.size > 0) {
          logger.log(`Pre-flight check found access loss for ${affectedEmails.size} owner(s).`);
          
          const emailListStr = Array.from(affectedEmails).slice(0, 10).join('\n') + (affectedEmails.size > 10 ? `\n...and ${affectedEmails.size - 10} more` : '');
          let message = `The destination Shared Drive restricts sharing to:`;
          if (restrictions.driveMembersOnly) message += `\n- Members of this Shared Drive only`;
          if (restrictions.domainUsersOnly) message += `\n- Users in this domain only`;
          message += `\n\nThe following file owners are not members (or are outside the domain) and will lose access to their moved files:\n\n${emailListStr}`;
          message += `\n\nHow do you want to proceed?`;

          const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'warning',
            buttons: ['Proceed & Strip Access', 'Copy Files (Keep Originals)', 'Cancel Migration'],
            defaultId: 1,
            cancelId: 2,
            title: 'Destination Security Restrictions Alert',
            message: 'Potential Access Loss Detected',
            detail: message
          });

          if (choice === 0) {
            logger.log('User chose option 0: Proceed and strip access.');
          } else if (choice === 1) {
            logger.log('User chose option 1: Force copy mode to preserve accessibility.');
            config.forceCopy = true;
          } else {
            logger.log('User chose option 2: Cancel migration.');
            throw new Error('Migration cancelled by user due to destination security restrictions.');
          }
        }
      }
    }

    // Map files containing index for quick reference
    const filesToMigrate = filesList.filter((_, idx) => selectionMap[idx] === true);
    const totalFiles = filesToMigrate.length;

    // Cache destination recreated directories mapping: sourceRelativeFolderPath -> destinationFolderId
    // Root of target is destId, and '.' represents the root directory in Node path.dirname
    let folderCache = { '': destId, '.': destId };
    let processedMap = {};
    let currentSourceFoldersMap = { ...lastSourceFoldersMap };

    if (isResume && fs.existsSync(checkpointPath)) {
      try {
        const cpData = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
        folderCache = cpData.folderCache || { '': destId, '.': destId };
        processedMap = cpData.processedMap || {};
        currentSourceFoldersMap = cpData.sourceFoldersMap || { ...lastSourceFoldersMap };
      } catch (cpErr) {
        logger.log(`Failed to load checkpoint: ${cpErr.message}`);
      }
    }
    
    // Ensure root mappings are always present
    folderCache[''] = destId;
    folderCache['.'] = destId;

    mainWindow.webContents.send('transfer-started', {
      sourceId,
      destId,
      selectionMap,
      filesList,
      isResume: !!isResume,
      processedMap
    });

    const checkpointData = {
      sourceId,
      destId,
      selectionMap,
      filesList,
      processedMap,
      folderCache,
      sourceFoldersMap: currentSourceFoldersMap
    };

    // Function to create or resolve a folder path inside destination Shared Drive
    async function resolveDestinationPath(relativePath) {
      if (folderCache[relativePath] !== undefined) {
        return folderCache[relativePath];
      }

      const parts = relativePath.split(path.sep).filter(p => p !== '');
      let currentParent = destId;
      let buildPath = '';

      for (const part of parts) {
        const parentOfNext = currentParent;
        buildPath = buildPath === '' ? part : path.join(buildPath, part);

        if (folderCache[buildPath] !== undefined) {
          currentParent = folderCache[buildPath];
          continue;
        }

        // Search if folder already exists under this parent (Merge folders option A)
        let resolvedFolderId = null;
        try {
          const qPart = part.replace(/'/g, "\\'");
          const safeParentId = safeDriveId(parentOfNext);
          const searchResponse = await executeWithRetry(async () => {
            return await drive.files.list({
              q: `'${safeParentId}' in parents and name = '${qPart}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
              fields: 'files(id)',
              supportsAllDrives: true,
              includeItemsFromAllDrives: true
            });
          }, 3, 1000);
          
          const matchingFolders = searchResponse.data.files || [];
          if (matchingFolders.length > 0) {
            resolvedFolderId = matchingFolders[0].id;
            logger.log(`Re-using existing folder in destination: "${buildPath}" (${resolvedFolderId})`);
          }
        } catch (searchErr) {
          logger.log(`Error searching folder "${part}" under parent ${parentOfNext}: ${searchErr.message}`);
        }

        // Create folder if it doesn't exist
        if (!resolvedFolderId) {
          try {
            const folderCreateResponse = await executeWithRetry(async () => {
              return await drive.files.create({
                resource: {
                  name: part,
                  mimeType: 'application/vnd.google-apps.folder',
                  parents: [parentOfNext]
                },
                fields: 'id',
                supportsAllDrives: true
              });
            }, 3, 1000);

            resolvedFolderId = folderCreateResponse.data.id;
            logger.log(`Created folder in destination: "${buildPath}" (${resolvedFolderId})`);

            // Check original folder's custom permissions and apply them to newly created folder
            const sourceFolderId = currentSourceFoldersMap[buildPath];
            if (sourceFolderId) {
              logger.log(`Replicating permissions for recreated folder: "${buildPath}" (Source ID: ${sourceFolderId}, Dest ID: ${resolvedFolderId})`);
              const folderPerms = await fetchDirectPermissions(drive, sourceFolderId);
              await restorePermissions(drive, resolvedFolderId, folderPerms);
            }
          } catch (createErr) {
            logger.log(`Failed to create directory "${part}" under parent ${parentOfNext}: ${createErr.message}`);
            throw new Error(`Folder creation failed: ${createErr.message}`);
          }
        }

        folderCache[buildPath] = resolvedFolderId;
        currentParent = resolvedFolderId;
      }

      return currentParent;
    }

    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Restore counts if resuming
    if (isResume) {
      for (const idx in processedMap) {
        const entry = processedMap[idx];
        if (entry.success) {
          if (entry.skipped) skippedCount++;
          else completedCount++;
        } else {
          failedCount++;
        }
      }
    }

    async function processFileTransfer(file, index) {
      if (currentTransferTask.cancelled) return;

      mainWindow.webContents.send('transfer-file-start', {
        index,
        name: file.name,
        size: file.size,
        relativePath: file.relativePath
      });

      let currentParentsString = (file.parents || []).join(',');
      if (!currentParentsString && file.id) {
        // Fetch current parents if not loaded
        try {
          const itemMeta = await executeWithRetry(async () => {
            return await drive.files.get({
              fileId: file.id,
              fields: 'parents',
              supportsAllDrives: true
            });
          }, 3, 1000);
          file.parents = itemMeta.data.parents || [];
          currentParentsString = file.parents.join(',');
        } catch (_) {}
      }

      try {
        // 1. Determine destination parent folder
        let targetParentFolderId = destId;
        const isRecreate = config.structureOption === 'recreate' || (config.structureOption === undefined && config.recreateFolderStructure);
        if (isRecreate) {
          const relativeFolderDir = path.dirname(file.relativePath);
          targetParentFolderId = await resolveDestinationPath(relativeFolderDir);
        }

        // 2. Fetch original permissions to preserve them
        const originalPerms = await fetchDirectPermissions(drive, file.id);

        // 3. Collision resolution check
        let finalFileName = file.name;
        let shouldProceed = true;
        
        try {
          const qName = file.name.replace(/'/g, "\\'");
          const safeParentId = safeDriveId(targetParentFolderId);
          const collisionResponse = await executeWithRetry(async () => {
            return await drive.files.list({
              q: `'${safeParentId}' in parents and name = '${qName}' and trashed = false`,
              fields: 'files(id, size)',
              supportsAllDrives: true,
              includeItemsFromAllDrives: true
            });
          }, 3, 1000);
          
          const collisions = collisionResponse.data.files || [];
          if (collisions.length > 0) {
            if (config.collisionSetting === 'skip') {
              shouldProceed = false;
              skippedCount++;
              logger.log(`Collision resolution (skip): File "${file.name}" (ID: ${file.id}) already exists in target destination. Skipping.`);
              mainWindow.webContents.send('transfer-file-complete', {
                index,
                success: true,
                skipped: true
              });
              processedMap[index] = { success: true, skipped: true };
              checkpointData.processedMap = processedMap;
              checkpointData.folderCache = folderCache;
              maybeSaveCheckpoint(checkpointData);
              return;
            } else if (config.collisionSetting === 'rename') {
              // Append suffix
              finalFileName = await getUniqueFileName(drive, targetParentFolderId, file.name);
            }
          }
        } catch (collisionErr) {
          logger.log(`Collision check failed for "${file.name}" (ID: ${file.id}): ${collisionErr.message}`);
        }

        if (currentTransferTask.cancelled) throw new Error('Cancelled');

        let isMoved = false;

        if (config.forceCopy === true) {
          logger.log(`Forcing copy mode for file: "${file.name}" (ID: ${file.id}) to preserve accessibility.`);
          
          let copiedFile;
          await executeWithRetry(async () => {
            const copyRes = await drive.files.copy({
              fileId: file.id,
              resource: {
                parents: [targetParentFolderId],
                name: finalFileName
              },
              supportsAllDrives: true,
              fields: 'id'
            });
            copiedFile = copyRes.data;
          }, 3, 1000);

          logger.log(`Fallback copy successful (forced). Copied file ID: ${copiedFile.id}`);
          
          // Restore permissions on copy
          await restorePermissions(drive, copiedFile.id, originalPerms);
          completedCount++;
          
          mainWindow.webContents.send('transfer-file-complete', {
            index,
            success: true,
            copied: true,
            newFileId: copiedFile.id
          });
          processedMap[index] = { success: true, copied: true, newFileId: copiedFile.id };
          checkpointData.processedMap = processedMap;
          checkpointData.folderCache = folderCache;
          maybeSaveCheckpoint(checkpointData);
          return;
        }

        // Try to perform the native move
        try {
          logger.log(`Moving file: "${file.name}" (ID: ${file.id}) to parent: ${targetParentFolderId}`);
          
          // Rename file if collision setting forced renaming
          if (finalFileName !== file.name) {
            await executeWithRetry(async () => {
              return await drive.files.update({
                fileId: file.id,
                resource: { name: finalFileName },
                supportsAllDrives: true
              });
            }, 3, 1000);
          }

          // Move parent updates
          await executeWithRetry(async () => {
            return await drive.files.update({
              fileId: file.id,
              addParents: targetParentFolderId,
              removeParents: currentParentsString,
              supportsAllDrives: true,
              enforceSingleParent: true
            });
          }, 3, 1000);

          isMoved = true;
          logger.log(`Successfully moved file: "${file.name}" (ID: ${file.id}) to destination.`);
        } catch (moveErr) {
          logger.log(`Native move failed for "${file.name}" (ID: ${file.id}): ${moveErr.message}`);

          // Fallback to copy if configured
          if (config.copyOnMoveFailure) {
            logger.log(`Attempting fallback copy for file: "${file.name}" (ID: ${file.id})`);
            
            let copiedFile;
            await executeWithRetry(async () => {
              const copyRes = await drive.files.copy({
                fileId: file.id,
                resource: {
                  parents: [targetParentFolderId],
                  name: finalFileName
                },
                supportsAllDrives: true,
                fields: 'id'
              });
              copiedFile = copyRes.data;
            }, 3, 1000);

            logger.log(`Fallback copy successful. Copied file ID: ${copiedFile.id}`);
            
            // Restore permissions on copy
            await restorePermissions(drive, copiedFile.id, originalPerms);
            completedCount++;
            
            mainWindow.webContents.send('transfer-file-complete', {
              index,
              success: true,
              copied: true,
              newFileId: copiedFile.id
            });
            processedMap[index] = { success: true, copied: true, newFileId: copiedFile.id };
            checkpointData.processedMap = processedMap;
            checkpointData.folderCache = folderCache;
            maybeSaveCheckpoint(checkpointData);
            return;
          } else {
            throw moveErr;
          }
        }

        if (isMoved) {
          // Re-apply explicit permissions
          await restorePermissions(drive, file.id, originalPerms);
          completedCount++;

          // If leaveShortcutAtSource is enabled, create a shortcut in the original folder pointing to the moved file ID
          if (config.leaveShortcutAtSource === true) {
            const originalParentId = (file.parents && file.parents.length > 0) ? file.parents[0] : sourceId;
            if (originalParentId && originalParentId !== 'shared-with-me') {
              try {
                logger.log(`Creating shortcut at source parent folder: ${originalParentId} pointing to moved item: ${file.id}`);
                await executeWithRetry(async () => {
                  return await drive.files.create({
                    resource: {
                      name: file.name,
                      mimeType: 'application/vnd.google-apps.shortcut',
                      shortcutDetails: {
                        targetId: file.id
                      },
                      parents: [originalParentId]
                    },
                    supportsAllDrives: true
                  });
                }, 3, 1000);
              } catch (shortcutErr) {
                logger.log(`Failed to create shortcut for moved item "${file.name}" (ID: ${file.id}) at parent ${originalParentId}: ${shortcutErr.message}`);
              }
            }
          }

          mainWindow.webContents.send('transfer-file-complete', {
            index,
            success: true
          });
          processedMap[index] = { success: true };
          checkpointData.processedMap = processedMap;
          checkpointData.folderCache = folderCache;
          maybeSaveCheckpoint(checkpointData);
        }

      } catch (err) {
        if (err.message === 'Cancelled' || currentTransferTask.cancelled) {
          throw err;
        }
        failedCount++;
        logger.log(`Failed to transfer file "${file.name}" (ID: ${file.id}): ${err.message}`);
        mainWindow.webContents.send('transfer-file-complete', {
          index,
          success: false,
          error: err.message
        });
        processedMap[index] = { success: false, error: err.message };
        checkpointData.processedMap = processedMap;
        checkpointData.folderCache = folderCache;
        maybeSaveCheckpoint(checkpointData);
      }
    }

    // Worker Pool logic (concurrency from settings, default 3, bounded 1-5)
    const activeIndices = Array.from({ length: totalFiles }, (_, i) => i);
    const maxConcurrency = Math.min(5, Math.max(1, parseInt(config.concurrentTransfers, 10) || 3));
    const workerCount = Math.min(maxConcurrency, totalFiles);

    async function worker() {
      while (activeIndices.length > 0 && !currentTransferTask.cancelled) {
        const itemIndex = activeIndices.shift();
        const file = filesToMigrate[itemIndex];

        // Bypass already processed files when resuming
        if (processedMap[itemIndex] !== undefined) {
          const entry = processedMap[itemIndex];
          mainWindow.webContents.send('transfer-file-start', {
            index: itemIndex,
            name: file.name,
            size: file.size,
            relativePath: file.relativePath
          });
          mainWindow.webContents.send('transfer-file-complete', {
            index: itemIndex,
            success: entry.success,
            skipped: entry.skipped,
            copied: entry.copied,
            error: entry.error
          });
          // Send progress updates so visual count stays accurate
          mainWindow.webContents.send('transfer-progress', {
            completedCount,
            failedCount,
            skippedCount,
            totalFiles
          });
          continue;
        }

        try {
          await processFileTransfer(file, itemIndex);
          // Send overall status update
          mainWindow.webContents.send('transfer-progress', {
            completedCount,
            failedCount,
            skippedCount,
            totalFiles
          });
        } catch (workerErr) {
          if (workerErr.message === 'Cancelled' || currentTransferTask.cancelled) {
            break;
          }
        }
      }
    }

    const workers = [];
    for (let w = 0; w < workerCount; w++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    const finalResults = {
      timestamp: new Date().toISOString(),
      sourceId,
      destId,
      totalFiles,
      completedCount,
      failedCount,
      skippedCount,
      processedMap,
      filesList: filesToMigrate
    };

    if (currentTransferTask.cancelled) {
      forceSaveCheckpoint();
      finalResults.status = 'cancelled';
      saveLastResults(finalResults);
      mainWindow.webContents.send('transfer-cancelled');
      currentTransferTask = null;
      return { status: 'cancelled' };
    }

    finalResults.status = 'completed';
    saveLastResults(finalResults);
    logger.log(`Transfer queue finished. Success: ${completedCount}, Failed: ${failedCount}, Skipped: ${skippedCount}`);
    mainWindow.webContents.send('transfer-success');

    if (Notification.isSupported()) {
      new Notification({
        title: 'Migration Completed',
        body: `Processed ${totalFiles} files: ${completedCount} completed successfully, ${skippedCount} skipped, ${failedCount} failed.`
      }).show();
    }

    clearCheckpoint();
    currentTransferTask = null;
    return { status: 'completed' };

  } catch (err) {
    logger.log(`Transfer queue failed globally: ${err.message}`);
    try {
      const finalResults = {
        timestamp: new Date().toISOString(),
        sourceId,
        destId,
        totalFiles: filesList.filter((_, idx) => selectionMap[idx] === true).length,
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        processedMap: {},
        filesList: filesList.filter((_, idx) => selectionMap[idx] === true),
        status: 'error',
        globalError: err.message
      };
      saveLastResults(finalResults);
    } catch (_) {}
    forceSaveCheckpoint();
    mainWindow.webContents.send('transfer-error', err.message);
    currentTransferTask = null;
    throw err;
  }
});


ipcMain.handle('start-dry-run', async (event, { sourceId, destId, selectionMap, filesList }) => {
  if (currentTransferTask) {
    throw new Error('A transfer task or dry-run is already active.');
  }

  currentTransferTask = { cancelled: false, isDryRun: true };
  mainWindow.webContents.send('dry-run-started');
  logger.log(`Starting dry-run simulation to destination: ${destId}`);

  try {
    const drive = await getDriveClient();
    const config = configManager.getAll();

    const filesToMigrate = filesList.filter((_, idx) => selectionMap[idx] === true);
    const totalFiles = filesToMigrate.length;

    // Cache destination directories: path -> folderId (real or virtual)
    const folderCache = { '': destId, '.': destId };
    const virtualFoldersCreated = []; // List of relative folder paths that will be created

    async function resolveDestinationPathSimulated(relativePath) {
      if (folderCache[relativePath] !== undefined) {
        return folderCache[relativePath];
      }

      const parts = relativePath.split(path.sep).filter(p => p !== '');
      let currentParent = destId;
      let buildPath = '';

      for (const part of parts) {
        const parentOfNext = currentParent;
        buildPath = buildPath === '' ? part : path.join(buildPath, part);

        if (folderCache[buildPath] !== undefined) {
          currentParent = folderCache[buildPath];
          continue;
        }

        // If parent is virtual, the child folder must also be virtual
        if (typeof parentOfNext === 'string' && parentOfNext.startsWith('virtual_')) {
          const virtualId = `virtual_${crypto.randomBytes(8).toString('hex')}`;
          virtualFoldersCreated.push({ relativePath: buildPath, name: part, parent: parentOfNext });
          folderCache[buildPath] = virtualId;
          currentParent = virtualId;
          continue;
        }

        // Parent is real, let's search if folder already exists under this parent
        let resolvedFolderId = null;
        try {
          const qPart = part.replace(/'/g, "\\'");
          const safeParentId = safeDriveId(parentOfNext);
          const searchResponse = await executeWithRetry(async () => {
            return await drive.files.list({
              q: `'${safeParentId}' in parents and name = '${qPart}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
              fields: 'files(id)',
              supportsAllDrives: true,
              includeItemsFromAllDrives: true
            });
          }, 3, 1000);
          
          const matchingFolders = searchResponse.data.files || [];
          if (matchingFolders.length > 0) {
            resolvedFolderId = matchingFolders[0].id;
          }
        } catch (searchErr) {
          logger.log(`Dry-run error searching folder "${part}" under parent ${parentOfNext}: ${searchErr.message}`);
        }

        if (!resolvedFolderId) {
          // It would be created!
          resolvedFolderId = `virtual_${crypto.randomBytes(8).toString('hex')}`;
          virtualFoldersCreated.push({ relativePath: buildPath, name: part, parent: parentOfNext });
        }

        folderCache[buildPath] = resolvedFolderId;
        currentParent = resolvedFolderId;
      }

      return currentParent;
    }

    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    async function simulateFileTransfer(file, index) {
      if (currentTransferTask.cancelled) return;

      mainWindow.webContents.send('dry-run-file-start', {
        index,
        name: file.name,
        size: file.size,
        relativePath: file.relativePath
      });

      try {
        let targetParentFolderId = destId;
        const isRecreate = config.structureOption === 'recreate' || (config.structureOption === undefined && config.recreateFolderStructure);
        if (isRecreate) {
          const relativeFolderDir = path.dirname(file.relativePath);
          targetParentFolderId = await resolveDestinationPathSimulated(relativeFolderDir);
        }

        let finalFileName = file.name;
        let finalAction = 'Move';

        // Check collision if target parent is real
        if (typeof targetParentFolderId === 'string' && !targetParentFolderId.startsWith('virtual_')) {
          try {
            const qName = file.name.replace(/'/g, "\\'");
            const safeParentId = safeDriveId(targetParentFolderId);
            const collisionResponse = await executeWithRetry(async () => {
              return await drive.files.list({
                q: `'${safeParentId}' in parents and name = '${qName}' and trashed = false`,
                fields: 'files(id, size)',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
              });
            }, 3, 1000);
            
            const collisions = collisionResponse.data.files || [];
            if (collisions.length > 0) {
              if (config.collisionSetting === 'skip') {
                finalAction = 'Skip';
                skippedCount++;
              } else if (config.collisionSetting === 'rename') {
                finalAction = 'Rename';
                finalFileName = await getUniqueFileName(drive, targetParentFolderId, file.name);
              } else if (config.collisionSetting === 'duplicate') {
                finalAction = 'Duplicate';
              }
            }
          } catch (collisionErr) {
            logger.log(`Dry-run collision check failed for "${file.name}" (ID: ${file.id}): ${collisionErr.message}`);
          }
        }
        if (finalAction !== 'Skip') {
          completedCount++;
          if (config.leaveShortcutAtSource === true) {
            const originalParentId = (file.parents && file.parents.length > 0) ? file.parents[0] : sourceId;
            if (originalParentId && originalParentId !== 'shared-with-me') {
              logger.log(`[Simulation] Would create shortcut at original source parent: ${originalParentId} pointing to moved item: ${file.id}`);
            }
          }
        }

        mainWindow.webContents.send('dry-run-file-complete', {
          index,
          success: true,
          action: finalAction,
          simulatedName: finalFileName,
          skipped: finalAction === 'Skip'
        });

      } catch (err) {
        failedCount++;
        mainWindow.webContents.send('dry-run-file-complete', {
          index,
          success: false,
          error: err.message
        });
      }
    }

    // Concurrency logic
    const activeIndices = Array.from({ length: totalFiles }, (_, i) => i);
    const maxConcurrency = Math.min(5, Math.max(1, parseInt(config.concurrentTransfers, 10) || 3));
    const workerCount = Math.min(maxConcurrency, totalFiles);

    async function worker() {
      while (activeIndices.length > 0 && !currentTransferTask.cancelled) {
        const itemIndex = activeIndices.shift();
        const file = filesToMigrate[itemIndex];
        try {
          await simulateFileTransfer(file, itemIndex);
          mainWindow.webContents.send('dry-run-progress', {
            completedCount,
            failedCount,
            skippedCount,
            totalFiles
          });
        } catch (workerErr) {
          if (currentTransferTask.cancelled) break;
        }
      }
    }

    const workers = [];
    for (let w = 0; w < workerCount; w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (currentTransferTask.cancelled) {
      mainWindow.webContents.send('dry-run-cancelled');
      currentTransferTask = null;
      return { status: 'cancelled' };
    }

    logger.log(`Dry-run complete. Folders to create: ${virtualFoldersCreated.length}, Files simulated: ${completedCount}`);
    mainWindow.webContents.send('dry-run-complete', {
      virtualFoldersCreated,
      totalFiles,
      completedCount,
      failedCount,
      skippedCount
    });

    if (Notification.isSupported()) {
      new Notification({
        title: 'Dry-Run Completed',
        body: `Simulated ${totalFiles} files: ${completedCount} eligible, ${skippedCount} skipped.`
      }).show();
    }

    currentTransferTask = null;
    return { status: 'completed' };

  } catch (err) {
    logger.log(`Dry-run failed: ${err.message}`);
    mainWindow.webContents.send('dry-run-error', err.message);
    currentTransferTask = null;
    throw err;
  }
});

ipcMain.handle('cancel-transfer', () => {
  if (currentTransferTask) {
    currentTransferTask.cancelled = true;
    logger.log('Transfer task cancelled by user.');
    return { success: true };
  }
  return { success: false };
});
