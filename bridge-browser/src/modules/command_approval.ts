export type CommandApprovalScope = false | "exact" | "executable" | "prefix";

const EXPLICIT_DEFAULT_EXECUTE_COMMAND_PROFILE = "__webcode_vscode_default__";
const UNSPECIFIED_EXECUTE_COMMAND_PROFILE = "__webcode_legacy_posix__";

const BROAD_COMMAND_EXECUTABLES = new Set([
  "bash",
  "bun",
  "cmd",
  "corepack",
  "deno",
  "fish",
  "node",
  "npm",
  "npx",
  "perl",
  "php",
  "pip",
  "pip3",
  "pipx",
  "pnpm",
  "pnpx",
  "powershell",
  "pwsh",
  "py",
  "python",
  "python3",
  "ruby",
  "sh",
  "uv",
  "yarn",
  "zsh",
]);

export function normalizeCommandValue(command: unknown): string | null {
  if (typeof command !== "string") {return null;}
  const normalized = command.trim();
  return normalized || null;
}

export function getCommandApprovalContext(
  toolName: string,
  args: Record<string, unknown> | undefined
): string {
  const path = typeof args?.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const requestedProfile = typeof args?.profile === "string" ? args.profile.trim() : "";
  const profile = getCommandApprovalProfile(toolName, requestedProfile);
  return `${encodeURIComponent(path)}:${encodeURIComponent(profile)}`;
}

function getCommandApprovalProfile(toolName: string, requestedProfile: string): string {
  if (toolName !== "execute_command") {
    return requestedProfile || "default";
  }
  if (!requestedProfile) {
    return UNSPECIFIED_EXECUTE_COMMAND_PROFILE;
  }

  return requestedProfile === "default"
    ? EXPLICIT_DEFAULT_EXECUTE_COMMAND_PROFILE
    : requestedProfile;
}

export function getCommandExecutable(command: string): string | null {
  const tokens = tokenizeCommandLine(command);
  return tokens[0] || null;
}

export function getCommandPrefix(command: string): string | null {
  if (hasCommandControlSyntax(command)) {return null;}
  const tokens = tokenizeCommandLine(command);
  if (tokens.length < 2) {return null;}
  return `${tokens[0]} ${tokens[1]}`;
}

export function isBroadCommandExecutable(executable: string): boolean {
  return BROAD_COMMAND_EXECUTABLES.has(normalizeExecutableName(executable));
}

export function isCommandApprovalScopeAllowed(
  command: string,
  scope: Exclude<CommandApprovalScope, false>
): boolean {
  if (scope !== "executable") {
    return scope !== "prefix" || !hasCommandControlSyntax(command);
  }

  const executable = getCommandExecutable(command);
  return Boolean(
    executable
    && !isBroadCommandExecutable(executable)
    && !hasCommandControlSyntax(command)
  );
}

export function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeExecutableName(executable: string): string {
  const baseName = executable.split(/[\\/]/).pop() ?? executable;
  return baseName.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

function hasCommandControlSyntax(command: string): boolean {
  return /\$\(|[`{}"';&|\r\n]/.test(command);
}
