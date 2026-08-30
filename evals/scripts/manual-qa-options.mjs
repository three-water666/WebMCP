import path from 'node:path';

export function parseManualQaArguments(args, options) {
  if (args.includes('--help') || args.includes('-h')) {
    return { help: true };
  }
  if (args.length > 1) {
    throw new Error('qa:manual accepts at most one workspace folder.');
  }

  const workspaceArgument = args[0]?.trim();
  return {
    help: false,
    workspacePath: workspaceArgument
      ? path.resolve(options.baseDirectory, workspaceArgument)
      : path.resolve(options.defaultWorkspace),
  };
}

export function buildManualVsCodeArguments(options) {
  return [
    '--new-window',
    '--wait',
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
    `--extensions-dir=${options.extensionsDirectory}`,
    `--user-data-dir=${options.userDataDirectory}`,
    `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
    options.workspacePath,
  ];
}

export function createManualVsCodeSettings(browserProfileRoot) {
  return {
    'git.openRepositoryInParentFolders': 'never',
    'webcodeGateway.browser': 'isolated-edge',
    'webcodeGateway.isolatedBrowser.profileRoot': browserProfileRoot,
  };
}
