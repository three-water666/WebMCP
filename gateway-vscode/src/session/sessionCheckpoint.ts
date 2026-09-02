export interface SessionCheckpointData {
    currentGoal: string;
    completedWork: string[];
    changedFiles: string[];
    verification: string;
    nextStep: string;
}

export class SessionCheckpointService {
    generateContent(data: SessionCheckpointData): string {
        return [
            '# Session Checkpoint',
            '',
            '## Current Goal',
            data.currentGoal,
            '',
            '## Completed Work',
            ...data.completedWork.map(item => `- ${item}`),
            '',
            '## Changed Files',
            ...data.changedFiles.map(file => `- ${file}`),
            '',
            '## Verification',
            data.verification,
            '',
            '## Next Step',
            data.nextStep
        ].join('\n');
    }
}
