# G-Drive Migrator (Move to Shared Drive)

An elegant, high-performance desktop application designed to recursively scan Google Drive folders or Shared Drives, filter files by owner email, MIME type, or date range, and safely transfer them into a destination Google Shared Drive.

---

## 🌟 Quick Start for Non-Technical Users

If you received a pre-built version of this software (such as a `.dmg` file for macOS or an `.exe` file for Windows), follow these simple steps to install it. **No coding or command-line knowledge is required!**

### Installing on Windows
1. Double-click the downloaded `.exe` installer.
2. If Windows Defender shows a warning stating *"Windows protected your PC"* (common for newly compiled, independent software), click **More Info** and then click **Run anyway**.
3. Follow the installation prompts. The application will launch automatically.

### Installing on macOS
1. Double-click the downloaded `.dmg` file.
2. Drag the **GDriveMoveToShareDrive** icon into your **Applications** folder.
3. Open your Applications folder and locate **GDriveMoveToShareDrive**.
4. **Important**: Because the application is self-published and not signed with an Apple Developer account, macOS Gatekeeper may block it. To open it:
   * **Right-click** (or Control-click) the application icon and select **Open**.
   * In the confirmation dialog that appears, click **Open** again.

---

## 🔑 1. How to Setup Google Credentials (One-Time Setup)

To allow the application to connect to Google Drive securely, you need to create your own credentials using Google Cloud Platform (GCP). This is a completely free, one-time setup that takes about 5 minutes:

### Step 1: Create a Google Cloud Project
1. Open your web browser and go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Log in with your Google account.
3. Click the project dropdown at the top-left corner (next to the Google Cloud logo) and click **New Project**.
4. Give your project a name (e.g., `G-Drive Migrator`) and click **Create**.
5. Wait a few seconds for the project to be created, click the notification bell in the top-right, and click **Select Project** (or use the project dropdown at the top to select it).

### Step 2: Enable the Google Drive API
1. Click the main menu button (three horizontal lines) in the top-left corner of the console.
2. Go to **APIs & Services** > **Library**.
3. In the search bar, type `Google Drive API` and press Enter.
4. Click on **Google Drive API** in the search results.
5. Click the blue **Enable** button.

### Step 3: Configure the OAuth Consent Screen
1. Click the main menu button and go to **APIs & Services** > **OAuth consent screen** (or click **OAuth** if using the new Google Auth Platform UI).
2. Configure the Google Auth Platform by clicking **Get started** (or setup OAuth consent).
3. Fill in the required basic fields:
   * **App name**: `G-Drive Migrator`
   * **User support email**: Choose your email address.
4. Click **Next**
5. Select **User Type**:
   * Choose **External** (standard for personal Gmail accounts) and click **Create**.
     *(If you are on an enterprise Google Workspace domain, you may also choose **Internal** to skip verification screens).*
6. For **Developer contact information**: Enter your email address.
7. Agree to the Google API Services User Data Policy and click **Continue**.
8. Click **Create**.

### Step 3.5: Add Test Users (Crucial for Personal Gmail Accounts)
> [!IMPORTANT]
> If you are using a personal `@gmail.com` account (External user type), Google restricts OAuth access until you explicitly register your email as a test user. If you skip this, you will receive an *Access Blocked: Project has not been configured* error during login.
> 
> 1. In the left-hand sidebar, navigate to **APIs & Services** > **OAuth consent screen** (or click **OAuth** if using the new Google Auth Platform UI).
> 2. Click on the **Audience** tab or scroll down to the **Test users** section.
> 3. Click the **+ Add Users** button.
> 4. Enter your own Gmail address (the one you plan to log in with).
> 5. Click **Save**.

### Step 4: Generate and Download credentials
1. Navigate to **APIs & Services** > **Credentials** from the left-hand sidebar.
2. Click **+ Create Credentials** at the top of the page, then select **OAuth client ID**.
3. Set the **Application type** dropdown to **Desktop app**. 
   > [!IMPORTANT]
   > You must select **Desktop app** here. Do not choose "Web application". The application runs locally and uses dynamic redirection ports; a Web application client will reject these and cause login failures.
4. In the Name field, enter `Drive Migrator Client` (or any name you prefer).
5. Click **Create**.
6. An "OAuth client created" popup will appear. Click **Download JSON** to download the credential file.
7. It will download a file named something like `client_secret_xxxx.json`. **Keep this file safe!**

---

## ⚙️ 2. Loading Settings & Saving Configuration

Before using the migrator, you need to import your credentials and set your transfer configurations in the **Settings** module.

1. Launch the **G-Drive Migrator** application.
2. Click the **Settings** tab in the left-hand sidebar navigation.
3. Under **1. GCP OAuth Credentials**:
   * Click the **Import Credentials JSON** button.
   * Select the `client_secret_xxxx.json` file you downloaded in the steps above. The application will automatically fill in your **OAuth Client ID** and **OAuth Client Secret**!
4. Under **2. Transfer Rules Configuration**:
   * **Collision Action**: Choose how to handle files if they already exist in the target folder (*Skip Transfer*, *Rename File*, or *Create Duplicate*).
   * **Concurrent File Transfers**: Set the number of threads (1 to 5, default 3). Higher values transfer faster but risk hitting Drive rate limits.
   * **Structure Option**: Choose *Recreate source folder hierarchy* to duplicate folders or *Flat structure* to put all migrated files in a single root directory.
   * **Move & Leave Shortcut**: If checked, a shortcut is left behind in the source folder pointing to the moved file in the Shared Drive.
   * **Resolve Shortcut Folders**: Toggle whether the scanner recursively resolves and follows folder shortcuts.
   * **Copy Fallback**: If checked, if moving a file fails due to security restrictions (e.g. cross-domain restrictions), the app copies the file into the destination drive instead.
   * **Ensure Accessibility Pre-flight Check**: (Default: Enabled) Automatically checks if file owners will lose access due to destination Shared Drive sharing restrictions and prompts you before starting.
5. Click the blue **Save All Settings** button at the bottom right.

---

## 🚀 3. How to Use G-Drive Migrator

### Step 1: Connect & Paths
1. Go to the **Connect & Paths** tab.
2. Click **Sign in with Google** to open a browser window and authorize your account.
3. Select your **Source Location**:
   * **Custom ID**: Enter a Google Drive Folder ID / Shared Drive ID, or leave blank (enter `root`) for My Drive.
   * **My Shared Drives**: Select a Shared Drive from the dropdown.
   * **Shared With Me**: Select this tab to scan files shared with you.
   * Click **Verify & Set Source**.
4. Select your **Destination Location**:
   * Paste your target Shared Drive ID or Folder ID and click **Verify & Set Destination**.

### Step 2: Scan & Filter
1. Go to the **Scan & Filter** tab.
2. Input an **Owner Email Pattern** to filter for specific accounts (e.g. `user@domain.com` or `domain.com`). Select match mode (Starts with, Ends with, Exact, Contains, or Regex).
3. Toggle **Show Advanced Filters** to:
   * Filter by specific **MIME Types** (PDFs, Images, Videos, Google Workspace Files).
   * Filter by **Date Ranges** (Modified After / Modified Before).
   * Toggle **Recurse Shared Folders** (for *Shared With Me* source) to control whether the tool scans inside folders shared with you (deep scan) or just lists top-level shared files (fast scan).
4. Click **Scan Source**.
5. *Note:* If you click **Cancel Scan**, the application will safely abort the crawl but **retain and display all matching files found up to that point**.

### Step 3: Review & Transfer
1. Review the preview list of eligible items found.
2. Check/uncheck specific files to customize your migration.
3. Click **Preview Migration (Dry Run)** to test the transfer configuration, check path merges, and preview warnings.
4. Click **Start Migration** to begin transferring the files into the target Shared Drive.
5. Monitor progress, review the live log terminal, or download a final **CSV Report** showing the status of each transferred item.

---

## 🛠️ Development & Building from Source

If you want to run the project from source or compile your own installers:

### Prerequisites
* [Node.js](https://nodejs.org/) (v16 or higher recommended)
* npm (comes with Node.js)

### Installation
1. Clone the repository and navigate into it:
   ```bash
   cd moveToShareDrive
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```

### Running Locally
To launch the application in development mode:
```bash
npm start
```

### Packaging the Application
To build executable installers for your current platform (DMG for macOS, EXE for Windows, AppImage for Linux):
```bash
# Package into platform-specific directory
npm run pack

# Build distributable installer
npm run dist
```
The output installers will be created in the `dist/` directory.

---

## 📜 Third-Party Licenses & Attributions

This application uses the following open-source packages and fonts:

*   **[Electron](https://github.com/electron/electron)** (MIT License) - Cross-platform desktop application shell.
*   **[Google APIs Node.js Client (googleapis)](https://github.com/googleapis/google-api-nodejs-client)** (Apache License 2.0) - Node.js client library for using Google APIs.
*   **[electron-builder](https://github.com/electron-userland/electron-builder)** (MIT License) - Complete solution to package and build ready-for-distribution Electron apps.
*   **[Outfit Font](https://fonts.google.com/specimen/Outfit)** (SIL Open Font License 1.1) - Geometric sans-serif typeface used for branding headers.
*   **[Plus Jakarta Sans Font](https://fonts.google.com/specimen/Plus+Jakarta+Sans)** (SIL Open Font License 1.1) - Modern sans-serif font used for UI body text.

For full license agreements, please refer to the respective official repositories.
