// Runs the contract suite against the in-repo MOCK provider (see mock/mock-provider.js).
// Self-check of the harness only. Extra args are passed to `node --test`.
import { spawn } from 'node:child_process';
import { startMock } from '../mock/mock-provider.js';

const mock = await startMock();
console.log(`# MOCK provider (NOT Keycloak) at ${mock.issuer}; MOCK_BUGS=${process.env.MOCK_BUGS ?? ''}`);
const child = spawn(
  process.execPath,
  ['--test', '--test-concurrency=1', '--test-timeout=900000', ...process.argv.slice(2), 'test/*.test.js'],
  { stdio: 'inherit', env: { ...process.env, ISSUER: mock.issuer, TEST_USER: 'testuser', TEST_PASSWORD: 'Test@1234', CLIENT_ID: 'iam-web-app', REDIRECT_URI: 'http://localhost:5173/' } },
);
child.on('exit', async (code) => {
  await mock.close();
  process.exit(code ?? 1);
});
