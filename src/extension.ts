import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { exec, spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import warningDialog from "./warning-dialog.html";

const execAsync = promisify(exec);
const LIVE_SCRIPT_NAME = "Live";

interface LiveAppInfo {
  appPath: string;
  appName: string;
}

// ── macOS ─────────────────────────────────────────────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function getLiveAppInfoDarwin(): Promise<LiveAppInfo> {
  function infoFromPath(appPath: string): LiveAppInfo {
    const appName = appPath.split("/").pop()!.replace(/\.app$/, "");
    return { appPath, appName };
  }

  // 1. Dev mode: EXTENSION_HOST_PATH is set by extensions-cli.
  const envPath = process.env["EXTENSION_HOST_PATH"];
  if (envPath) {
    const m = envPath.match(/^(.+?\.app)\//);
    if (m?.[1]) return infoFromPath(m[1]);
  }

  // 2. Production: Live spawns the Extension Host, so the parent process IS Live.
  try {
    const myPid = process.pid;
    const { stdout: ppidOut } = await execAsync(`ps -p ${myPid} -o ppid= 2>/dev/null`);
    const parentPid = ppidOut.trim();
    const { stdout: argsOut } = await execAsync(`ps -p ${parentPid} -o args= 2>/dev/null`);
    const m = argsOut.trim().match(/^(.+?\.app)\/Contents/);
    if (m?.[1]) return infoFromPath(m[1]);
  } catch {}

  // 3. Find any running Live binary via ps.
  try {
    const { stdout } = await execAsync(
      `ps aux | grep -E "Ableton Live[^/]+\\.app/Contents/MacOS/Live" | grep -v grep | head -1`,
    );
    const m = stdout.match(/(\/.*?Ableton Live[^/]+\.app)\/Contents\/MacOS\/Live/);
    if (m?.[1]) return infoFromPath(m[1]);
  } catch {}

  return infoFromPath("/Applications/Ableton Live 12 Beta.app");
}

async function getCurrentProjectPathDarwin(): Promise<string | null> {
  // Live 12.4.5b5 no longer exposes reliable document/path state through
  // AppleScript or Accessibility. Live's Log.txt records every real document
  // load as: info: Loading document "<absolute path>.als". That line fires
  // only when Live actually opens a Set, so the last one is the front document.
  // (The Indexer log's CurrentProject is unreliable: it also records temp
  // recording projects, re-index events, and our own restarts.)
  try {
    const { stdout } = await execAsync(
      `/usr/bin/python3 -c ${shellQuote(`
import glob, os, re

files = glob.glob(os.path.expanduser('~/Library/Preferences/Ableton/Live*/Log.txt'))
files.sort(key=lambda p: os.path.getmtime(p), reverse=True)

for file_path in files:
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as handle:
            text = handle.read()
    except OSError:
        continue

    matches = re.findall(r'Loading document "([^"]+\\.als)"', text)
    for als in reversed(matches):
        # Skip Live's bundled default/template Sets (a blank, unsaved session).
        if '.app/Contents/' in als:
            continue
        if os.path.isfile(als):
            print(als)
            raise SystemExit(0)

    # Only the newest readable log reflects the running instance; if it holds
    # no real project, fall through to opening the app (Live restores the last
    # Set itself) instead of trusting an older version's stale log.
    raise SystemExit(0)
`)}`,
    );
    const projectPath = stdout.trim();
    if (projectPath.endsWith(".als")) return projectPath;
  } catch {}

  return null;
}

function spawnRestartScriptDarwin(appPath: string, projectPath: string | null): void {
  // Reopen the exact project file if we got its path; otherwise open the app
  // (Live reopens the last project by default anyway).
  const executablePath = `${appPath}/Contents/MacOS/Live`;
  const openCmd = projectPath
    ? `open -a ${shellQuote(appPath)} -- ${shellQuote(projectPath)}`
    : `open -- ${shellQuote(appPath)}`;

  const quitCommand = `osascript -e ${shellQuote(`tell application ${JSON.stringify(LIVE_SCRIPT_NAME)} to quit`)} 2>/dev/null || true`;

  // Wait up to 5 minutes for Live to finish its own shutdown before reopening.
  // Do not force-kill: if Live shows its native unsaved-changes dialog, the user
  // must stay in control. If they cancel, Live keeps running and this script exits.
  const waitForQuit = [
    `for _i in $(seq 1 300); do`,
    `  pgrep -qf ${shellQuote(executablePath)} || break`,
    `  sleep 1`,
    `done`,
    `pgrep -qf ${shellQuote(executablePath)} && exit 0`,
    `sleep 1`,
  ].join("\n");

  const script = [quitCommand, waitForQuit, openCmd].join("\n");

  const child = spawn("bash", ["-c", script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

// ── Windows ───────────────────────────────────────────────────────────────────

async function getLiveAppInfoWindows(): Promise<LiveAppInfo> {
  function infoFromPath(exePath: string): LiveAppInfo {
    const appName = exePath.split(/[\\/]/).pop()!.replace(/\.exe$/i, "");
    return { appPath: exePath, appName };
  }

  // 1. Production: Live spawns the Extension Host, so the parent process IS Live.
  try {
    const myPid = process.pid;
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "$p=(Get-CimInstance Win32_Process -Filter 'ProcessId=${myPid}').ParentProcessId; (Get-CimInstance Win32_Process -Filter \\"ProcessId=$p\\").ExecutablePath"`,
    );
    const exePath = stdout.trim();
    if (exePath && /ableton/i.test(exePath)) return infoFromPath(exePath);
  } catch {}

  // 2. Find any running Live process.
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-Process | Where-Object {$_.Name -like 'Ableton*'} | Select-Object -First 1 -ExpandProperty Path"`,
    );
    const exePath = stdout.trim();
    if (exePath) return infoFromPath(exePath);
  } catch {}

  return infoFromPath(
    "C:\\ProgramData\\Ableton\\Live 12 Beta\\Program\\Ableton Live 12 Beta.exe",
  );
}

function getCurrentProjectPathWindows(): string | null {
  // Mirrors the macOS strategy: read Live's Log.txt and find the last
  // "Loading document" line that points to an existing .als file.
  // %APPDATA%\Ableton\Live*\Preferences\Log.txt on Windows.
  try {
    const appData = process.env["APPDATA"];
    if (!appData) return null;

    const abletonDir = join(appData, "Ableton");
    const logFiles: { path: string; mtime: number }[] = [];

    const entries = readdirSync(abletonDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("Live")) continue;
      const logPath = join(abletonDir, entry.name, "Preferences", "Log.txt");
      try {
        const { mtimeMs } = statSync(logPath);
        logFiles.push({ path: logPath, mtime: mtimeMs });
      } catch {}
    }

    logFiles.sort((a, b) => b.mtime - a.mtime);

    for (const { path: logPath } of logFiles) {
      try {
        const text = readFileSync(logPath, "utf-8");
        const matches = [...text.matchAll(/Loading document "([^"]+\.als)"/g)];
        for (let i = matches.length - 1; i >= 0; i--) {
          const als = matches[i][1];
          if (existsSync(als)) return als;
        }
      } catch {}
      // Only the newest log reflects the running instance.
      break;
    }
  } catch {}

  return null;
}

function spawnRestartScriptWindows(appPath: string, projectPath: string | null): void {
  // Single-quote escape for PowerShell string literals.
  const ps = (s: string) => s.replace(/'/g, "''");

  const openLine = projectPath
    ? `Start-Process '${ps(appPath)}' -ArgumentList '${ps(projectPath)}'`
    : `Start-Process '${ps(appPath)}'`;

  // CloseMainWindow() sends WM_CLOSE, which lets Live show its native
  // unsaved-changes dialog. If the user cancels, Live keeps running and
  // the script exits without reopening. Never force-kill.
  const script = `
$target = '${ps(appPath)}'
$proc = Get-Process | Where-Object { try { $_.Path -eq $target } catch { $false } } | Select-Object -First 1
if ($proc) { $proc.CloseMainWindow() | Out-Null }
$i = 0
while ($i -lt 300) {
  if (-not (Get-Process | Where-Object { try { $_.Path -eq $target } catch { $false } })) { break }
  Start-Sleep -Seconds 1
  $i++
}
if (Get-Process | Where-Object { try { $_.Path -eq $target } catch { $false } }) { exit 0 }
Start-Sleep -Seconds 1
${openLine}
`;

  // Use -EncodedCommand (base64 UTF-16LE) to avoid all command-line quoting issues.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}

// ── Platform dispatch ─────────────────────────────────────────────────────────

async function getLiveAppInfo(): Promise<LiveAppInfo> {
  if (process.platform === "win32") return getLiveAppInfoWindows();
  return getLiveAppInfoDarwin();
}

async function getCurrentProjectPath(): Promise<string | null> {
  if (process.platform === "win32") return getCurrentProjectPathWindows();
  return getCurrentProjectPathDarwin();
}

function spawnRestartScript(appPath: string, projectPath: string | null): void {
  if (process.platform === "win32") {
    spawnRestartScriptWindows(appPath, projectPath);
  } else {
    spawnRestartScriptDarwin(appPath, projectPath);
  }
}

// ── Extension entry point ─────────────────────────────────────────────────────

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("restart-live.trigger", async () => {
    const { appPath } = await getLiveAppInfo();
    const projectPath = await getCurrentProjectPath();

    // Pass state via URL hash so the same HTML renders the correct variant.
    const url = `data:text/html,${encodeURIComponent(warningDialog)}#restart`;

    let result: string;
    try {
      result = await context.ui.showModalDialog(url, 520, 220);
    } catch {
      return;
    }

    const { action } = JSON.parse(result) as { action: "cancel" | "restart" };

    if (action === "cancel") return;

    try {
      spawnRestartScript(appPath, projectPath);
    } catch (e) {
      console.error("Failed to restart:", e);
    }
  });

  ([
    "MidiTrack",
    "AudioTrack",
    "Scene",
    "MidiClip",
    "AudioClip",
    "ClipSlot",
    "ClipSlotSelection",
    "MidiTrack.ArrangementSelection",
    "AudioTrack.ArrangementSelection",
    "Sample",
    "Simpler",
    "DrumRack",
  ] as const).forEach((scope) => {
    context.ui.registerContextMenuAction(scope, "Restart Ableton Live…", "restart-live.trigger");
  });
}
