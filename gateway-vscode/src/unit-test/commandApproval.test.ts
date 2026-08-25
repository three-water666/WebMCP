import * as assert from 'assert';

import { CommandApprovalManager } from '../gateway/commandApproval';
import { assessCommandToolRisk } from '../servers/commandToolRisk';

suite('Command approval', () => {
  test('issues a one-time grant bound to the assessed command fingerprint', () => {
    const manager = new CommandApprovalManager();
    const challenge = manager.issueChallenge('fingerprint-a');
    const grant = manager.approveChallenge(challenge.challengeId);

    assert.ok(grant);
    assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint-b'), false);
    assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint-a'), true);
    assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint-a'), false);
  });

  test('expires pending challenges and grants', () => {
    let now = 1000;
    const manager = new CommandApprovalManager(100, () => now);
    const challenge = manager.issueChallenge('fingerprint');
    now += 101;
    assert.strictEqual(manager.approveChallenge(challenge.challengeId), null);

    const nextChallenge = manager.issueChallenge('fingerprint');
    const grant = manager.approveChallenge(nextChallenge.challengeId);
    assert.ok(grant);
    now += 101;
    assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint'), false);
  });

  test('binds command fingerprints to the tool, path, and shell profile', () => {
    const base = {
      command: 'git reset --hard',
      commandPath: '.',
      profileId: 'git-bash',
      shellKind: 'posix' as const,
      toolName: 'execute_command' as const,
      riskContext: {}
    };
    const initial = assessCommandToolRisk(base);
    const otherPath = assessCommandToolRisk({ ...base, commandPath: 'packages/app' });
    const otherProfile = assessCommandToolRisk({
      ...base,
      profileId: 'pwsh',
      shellKind: 'powershell'
    });

    assert.strictEqual(initial.assessment.level, 'requires_confirmation');
    assert.notStrictEqual(initial.fingerprint, otherPath.fingerprint);
    assert.notStrictEqual(initial.fingerprint, otherProfile.fingerprint);
  });
});
