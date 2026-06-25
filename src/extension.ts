import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import warningDialog from "./warning-dialog.html";

const execAsync = promisify(exec);

interface LiveAppInfo {
  appPath: string;
  appName: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function getLiveAppInfo(): Promise<LiveAppInfo> {
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

  // 2. Production: Live spawns the Extension Host, so the grandparent process IS Live.
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

async function hasUnsavedChanges(appName: string): Promise<boolean> {
  // Method 1: AXModified via System Events (requires Accessibility permission).
  try {
    const { stdout } = await execAsync(
      `osascript` +
      ` -e 'tell application "System Events"'` +
      ` -e ${shellQuote(`tell process ${JSON.stringify(appName)}`)}` +
      ` -e 'value of attribute "AXModified" of window 1'` +
      ` -e 'end tell'` +
      ` -e 'end tell'`,
    );
    if (stdout.trim() === "true" || stdout.trim() === "false") {
      return stdout.trim() === "true";
    }
  } catch {}

  // Method 2: Standard Cocoa AppleScript dictionary — no Accessibility needed.
  try {
    const { stdout } = await execAsync(
      `osascript -e ${shellQuote(
        `tell application ${JSON.stringify(appName)} to (count of documents whose modified is true)`,
      )}`,
    );
    return parseInt(stdout.trim(), 10) > 0;
  } catch {}

  // Can't determine — assume unsaved. A false alarm is better than silent data loss.
  return true;
}

async function getCurrentProjectPath(appName: string): Promise<string | null> {
  // Standard Cocoa NSDocument AppleScript — most document-based apps support this.
  try {
    const { stdout } = await execAsync(
      `osascript -e ${shellQuote(
        `tell application ${JSON.stringify(appName)} to POSIX path of (path of front document as alias)`,
      )}`,
    );
    const p = stdout.trim();
    if (p.endsWith(".als")) return p;
  } catch {}
  return null;
}

function spawnRestartScript(
  appPath: string,
  appName: string,
  projectPath: string | null,
  discardChanges: boolean,
): void {
  // Reopen the exact project file if we got its path; otherwise open the app
  // (Live reopens the last project by default anyway).
  const executablePath = `${appPath}/Contents/MacOS/Live`;
  const openCmd = projectPath
    ? `open -a ${shellQuote(appPath)} -- ${shellQuote(projectPath)}`
    : `open -- ${shellQuote(appPath)}`;

  // When discarding changes, pass "saving no" so Live doesn't show its own save dialog —
  // that dialog would block the quit and we'd end up force-killing Live (crash detection fires).
  // For a clean (saved) project, plain quit is fine.
  const quitScript = discardChanges
    ? `tell application ${JSON.stringify(appName)} to quit saving no`
    : `tell application ${JSON.stringify(appName)} to quit`;

  // Wait for Live to finish its own shutdown (deletes crash-recovery marker) before reopening.
  // Only force-kill after 15 s if it never exited on its own.
  const waitAndKill = [
    `for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do`,
    `  pgrep -qf ${shellQuote(executablePath)} || break`,
    `  sleep 1`,
    `done`,
    `pgrep -qf ${shellQuote(executablePath)} && pkill -f ${shellQuote(executablePath)} 2>/dev/null || true`,
    `sleep 1`,
  ].join("\n");

  const script = [
    `osascript -e ${shellQuote(quitScript)} 2>/dev/null || true`,
    waitAndKill,
    openCmd,
  ].join("\n");

  const child = spawn("bash", ["-c", script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("restart-live.trigger", async () => {
    const { appPath, appName } = await getLiveAppInfo();

    // Check save state BEFORE opening our dialog — no polling, single fast query.
    const unsaved = await hasUnsavedChanges(appName);

    // Pass state via URL hash so the same HTML renders the correct variant.
    const url = `data:text/html,${encodeURIComponent(warningDialog)}${unsaved ? "#unsaved" : "#saved"}`;

    let result: string;
    try {
      result = await context.ui.showModalDialog(url, 460, unsaved ? 230 : 200);
    } catch {
      return;
    }

    const { action } = JSON.parse(result) as { action: "cancel" | "restart" };

    if (action === "cancel") return;

    // "Go Back & Save" also sends "cancel" — the user saves manually, then re-triggers.
    // No automated save attempt here: avoids any risk of crashing while Live's
    // native save dialog is open.

    try {
      const projectPath = await getCurrentProjectPath(appName);
      spawnRestartScript(appPath, appName, projectPath, unsaved);
    } catch (e) {
      console.error("Failed to restart:", e);
    }
  });

  (["MidiTrack", "AudioTrack", "Scene"] as const).forEach((scope) => {
    context.ui.registerContextMenuAction(scope, "Restart Ableton Live…", "restart-live.trigger");
  });
}
