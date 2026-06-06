import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import warningDialog from "./warning-dialog.html";

const execAsync = promisify(exec);

async function getLiveAppPath(): Promise<string> {
  // 1. Best source in dev mode: EXTENSION_HOST_PATH is set by extensions-cli and always
  //    points to the exact Live version that loaded this extension.
  const envPath = process.env["EXTENSION_HOST_PATH"];
  if (envPath) {
    const m = envPath.match(/^(.+?\.app)\//);
    if (m?.[1]) return m[1];
  }

  // 2. In production Live spawns the Extension Host, so our parent process IS Live.
  try {
    const myPid = process.pid;
    const { stdout: ppidOut } = await execAsync(`ps -p ${myPid} -o ppid= 2>/dev/null`);
    const parentPid = ppidOut.trim();
    const { stdout: argsOut } = await execAsync(`ps -p ${parentPid} -o args= 2>/dev/null`);
    const m = argsOut.trim().match(/^(.+?\.app)\/Contents/);
    if (m?.[1]) return m[1];
  } catch {}

  // 3. Find any running Live that has the MacOS binary (more specific than mdfind)
  try {
    const { stdout } = await execAsync(
      `ps aux | grep -E "Ableton Live[^/]+\\.app/Contents/MacOS/Live" | grep -v grep | head -1`,
    );
    const m = stdout.match(/(\/Applications\/Ableton Live[^/]+\.app)/);
    if (m?.[1]) return m[1];
  } catch {}

  return "/Applications/Ableton Live 12 Beta.app";
}

async function hasUnsavedChanges(): Promise<boolean> {
  // Check the standard macOS AXModified accessibility attribute on Live's main window.
  // Returns true if the document has unsaved changes, false if clean.
  // On any error we default to true — the safer assumption.
  try {
    const { stdout } = await execAsync(
      `osascript` +
      ` -e 'tell application "System Events"'` +
      ` -e 'tell process "Live"'` +
      ` -e 'value of attribute "AXModified" of window 1'` +
      ` -e 'end tell'` +
      ` -e 'end tell'`,
    );
    return stdout.trim() === "true";
  } catch {
    return true;
  }
}

function spawnRestartScript(appPath: string): void {
  // Kill exactly this .app, not any other Live version the user may have open.
  const executablePath = `${appPath}/Contents/MacOS/Live`;
  const script = [
    `sleep 1`,
    `pkill -f ${JSON.stringify(executablePath)} 2>/dev/null || true`,
    `sleep 3`,
    `open ${JSON.stringify(appPath)}`,
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
    // Check save state BEFORE opening our dialog — no polling, single fast query.
    const unsaved = await hasUnsavedChanges();

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
      const appPath = await getLiveAppPath();
      spawnRestartScript(appPath);
    } catch (e) {
      console.error("Failed to restart:", e);
    }
  });

  (["MidiTrack", "AudioTrack", "Scene"] as const).forEach((scope) => {
    context.ui.registerContextMenuAction(scope, "Restart Ableton Live…", "restart-live.trigger");
  });
}
