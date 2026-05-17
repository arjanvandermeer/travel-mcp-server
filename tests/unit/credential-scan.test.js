import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isAllowedSecretValue, scanText } from '../../scripts/credential-scan.js';

describe('credential scan', () => {
  it('allows placeholders and GitHub secret references', () => {
    assert.equal(isAllowedSecretValue('<password>'), true);
    assert.equal(isAllowedSecretValue('${DATABASE_URL}'), true);
    assert.equal(isAllowedSecretValue('${{ secrets.ANTHROPIC_API_KEY }}'), true);
    assert.equal(isAllowedSecretValue('test-fake-api-key'), true);
  });

  it('flags hardcoded secret assignments', () => {
    const findings = scanText('const apiKey = "sk_live_1234567890abcdef";\n', 'sample.js'); // credential-scan: allow

    assert.equal(findings.length, 1);
    assert.equal(findings[0].detector, 'Quoted secret assignment');
    assert.equal(findings[0].filePath, 'sample.js');
    assert.equal(findings[0].line, 1);
  });

  it('flags docker-style environment defaults with real fallback values', () => {
    const findings = scanText('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-travelpass}\n', 'docker-compose.yml');

    assert.equal(findings.length, 1);
    assert.equal(findings[0].detector, 'Environment fallback secret');
  });

  it('allows required environment values without defaults', () => {
    const findings = scanText('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD before running}\n', 'docker-compose.yml');

    assert.deepEqual(findings, []);
  });

  it('flags credentialed urls', () => {
    const findings = scanText('DATABASE_URL=postgresql://traveluser:travelpass@localhost:5432/travel\n', '.env'); // credential-scan: allow

    assert.equal(findings.length, 1);
    assert.equal(findings[0].detector, 'Credentialed URL');
  });

  it('flags private key headers without grep option parsing pitfalls', () => {
    const findings = scanText('-----BEGIN RSA PRIVATE KEY-----\n', 'key.pem'); // credential-scan: allow

    assert.equal(findings.length, 1);
    assert.equal(findings[0].detector, 'Private key header');
  });

  it('flags fine-grained GitHub tokens', () => {
    const findings = scanText('github_pat_1234567890abcdef1234567890abcdef1234567890\n', 'sample.txt'); // credential-scan: allow

    assert.equal(findings.length, 1);
    assert.equal(findings[0].detector, 'GitHub fine-grained token');
  });
});
