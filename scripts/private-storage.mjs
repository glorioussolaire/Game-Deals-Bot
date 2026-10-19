import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, rename, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SourceError } from "../src/http.js";

const execute = promisify(execFile);
const windowsCheck = `
$ErrorActionPreference = 'Stop'
$broad = @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-32-546')
$acl = [System.IO.Directory]::GetAccessControl($env:WISHLIST_PRIVATE_DIRECTORY)
$unsafe = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -in $broad })
if ($unsafe.Count -gt 0) { exit 42 }
`;

export async function assertPrivateDirectory(directory) {
  if (process.platform === "win32") {
    try {
      await execute(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsCheck],
        { env: { ...process.env, WISHLIST_PRIVATE_DIRECTORY: directory }, timeout: 10000, maxBuffer: 4096 });
    } catch { throw new SourceError("config", "private_workspace_permissions_required_see_README_md"); }
  } else if ((await stat(directory)).mode & 0o022) {
    throw new SourceError("config", "private_workspace_permissions_required_see_README_md");
  }
}

export async function writePrivateFile(file, content) {
  await assertPrivateDirectory(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.dev.vars.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
