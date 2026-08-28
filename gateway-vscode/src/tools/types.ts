import type * as vscode from 'vscode';
import type { SkillManager } from '../skillManager';
import type { TerminalSessionManager } from '../terminalSessionManager';
import type { CommandRiskAssessment } from '../servers/commandRisk';

export type ToolContent = {
    type: string;
    text?: string;
    [key: string]: unknown;
};

export type ToolResult = {
    content: ToolContent[];
    isError?: boolean;
    structuredContent?: unknown;
};

export type ToolDefinition = Record<string, unknown> & {
    name: string;
    description: string;
    inputSchema?: unknown;
};

export type ToolExecutionContext = {
    workspaceRoot: string | null;
    outputChannel: vscode.OutputChannel;
    skillManager: SkillManager;
    terminalSessionManager: TerminalSessionManager;
    skillDirectories: string[];
    commandShellPath?: string;
    commandAllowedRoots?: string[];
    approvedCommandFingerprint?: string;
    listTools: () => unknown;
    getToolDefinition: (name: string) => ToolDefinition | null;
};

export type ToolDefinitionContext = {
    commandShellPath?: string;
};

export type LocalTool = {
    definition: ToolDefinition;
    getDefinition?: (context: ToolDefinitionContext) => ToolDefinition;
    serverId?: string;
    assessRisk?: (
        args: Record<string, unknown>,
        context: ToolExecutionContext
    ) => Promise<ToolRiskPreflight>;
    execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>;
};

export type ToolRiskPreflight = {
    assessment: CommandRiskAssessment;
    fingerprint: string;
};
