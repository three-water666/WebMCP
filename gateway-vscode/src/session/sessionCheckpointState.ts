export interface SessionCheckpointState {
    currentGoal: string;
    completedWork: string[];
    changedFiles: string[];
    verification: string;
    nextStep: string;
}

export class SessionCheckpointStateStore {
    private state: SessionCheckpointState = {
        currentGoal: '',
        completedWork: [],
        changedFiles: [],
        verification: '',
        nextStep: ''
    };

    getState(): SessionCheckpointState {
        return {
            ...this.state,
            completedWork: [...this.state.completedWork],
            changedFiles: [...this.state.changedFiles]
        };
    }

    updateGoal(goal: string): void {
        this.state.currentGoal = goal;
    }

    recordCompletedWork(item: string): void {
        this.state.completedWork.push(item);
    }

    recordChangedFile(file: string): void {
        if (!this.state.changedFiles.includes(file)) {
            this.state.changedFiles.push(file);
        }
    }

    setVerification(result: string): void {
        this.state.verification = result;
    }

    setNextStep(step: string): void {
        this.state.nextStep = step;
    }

    reset(): void {
        this.state = {
            currentGoal: '',
            completedWork: [],
            changedFiles: [],
            verification: '',
            nextStep: ''
        };
    }
}
