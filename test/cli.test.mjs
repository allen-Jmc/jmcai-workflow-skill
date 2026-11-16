import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const skillRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = join(skillRoot, 'scripts', 'jmcai-workflow.mjs');
const txtFixture = join(skillRoot, 'test', 'fixtures', 'txt-basic.json');
const imgFixture = join(skillRoot, 'test', 'fixtures', 'img-qwen-like.json');

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env,
    },
  });
  const output = result.stdout.trim();
  let json;
  try {
    json = JSON.parse(output);
  } catch {
    throw new Error(
      `CLI did not return JSON.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return {
    ...result,
    json,
  };
}

async function temporaryRoot() {
  return mkdtemp(join(tmpdir(), 'jmcai-workflow-skill-test-'));
}

async function waitForFile(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test('analyze reports confirmation state and writes an optional plan', async () => {
  const temp = await temporaryRoot();
  try {
    const planPath = join(temp, 'plan.json');
    const result = runCli(['analyze', txtFixture, '--out', planPath]);
    assert.equal(result.status, 0);
    assert.equal(result.json.status, 'needs_confirmation');
    assert.equal(result.json.modeConfirmationRequired, true);
    assert.deepEqual(result.json.readyModes, ['txt']);
    assert.equal(result.json.planPath, planPath);
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    assert.equal(plan.workflowSourceHash, result.json.workflowSourceHash);
    assert.equal(plan.proposals.txt.ready, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('prepare refuses to run without an explicit mode', () => {
  const result = runCli(['prepare', txtFixture, '--name', 'Missing mode']);
  assert.equal(result.status, 1);
  assert.equal(result.json.status, 'failed');
  assert.equal(result.json.errorCode, 'E_MODE_REQUIRED');
});

test('prepare, validate and compile work for TXT and extra controls', async () => {
  const temp = await temporaryRoot();
  try {
    const extraPath = join(temp, 'extra-controls.json');
    await writeFile(extraPath, JSON.stringify([
      {
        nodeId: '50',
        fieldPath: 'inputs.ckpt_name',
        label: '模型文件',
        group: '高级参数',
      },
    ]), 'utf8');
    const intentPath = join(temp, 'intent.json');
    const prepared = runCli([
      'prepare',
      txtFixture,
      '--name',
      'CLI TXT',
      '--mode',
      'txt',
      '--category',
      'generate',
      '--extra-controls',
      extraPath,
      '--out',
      intentPath,
    ]);
    assert.equal(prepared.status, 0);
    assert.equal(prepared.json.status, 'prepared');
    assert.equal(prepared.json.presetSummary.validation.valid, true);
    assert.equal(prepared.json.presetSummary.controlCount, 6);
    const intent = JSON.parse(await readFile(intentPath, 'utf8'));
    assert.equal(intent.preset.mode, 'txt');
    assert.equal(intent.controls.some(control => control.label === '模型文件'), true);

    const validated = runCli(['validate', intentPath]);
    assert.equal(validated.status, 0);
    assert.equal(validated.json.status, 'valid');

    const compiled = runCli(['compile', intentPath]);
    assert.equal(compiled.status, 0);
    assert.equal(compiled.json.status, 'compiled');
    assert.equal(compiled.json.presetName, 'CLI TXT');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('prepare supports IMG and fork without changing the public contract', async () => {
  const temp = await temporaryRoot();
  try {
    const intentPath = join(temp, 'img-intent.json');
    const result = runCli([
      'prepare',
      imgFixture,
      '--name',
      'CLI IMG',
      '--mode',
      'img',
      '--category',
      'edit',
      '--fork',
      '--out',
      intentPath,
    ]);
    assert.equal(result.status, 0);
    assert.equal(result.json.status, 'prepared');
    assert.match(result.json.jobId, /^jmcai-fork-/);
    const intent = JSON.parse(await readFile(intentPath, 'utf8'));
    assert.equal(intent.preset.mode, 'img');
    assert.equal(intent.preset.category, 'edit');
    assert.equal(intent.preset.fork, true);
    assert.deepEqual(intent.core.imageInputNode1, {
      nodeId: '46',
      fieldPath: 'inputs.image',
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('install writes a queued job and verify reads a matching terminal result', async () => {
  const temp = await temporaryRoot();
  try {
    const intentPath = join(temp, 'intent.json');
    const prepared = runCli([
      'prepare',
      txtFixture,
      '--name',
      'Bridge TXT',
      '--mode',
      'txt',
      '--category',
      'generate',
      '--out',
      intentPath,
    ]);
    assert.equal(prepared.status, 0);
    const bridgeDir = join(temp, 'bridge');
    const installed = runCli([
      'install',
      intentPath,
      '--bridge-dir',
      bridgeDir,
      '--timeout-ms',
      '100',
    ]);
    assert.equal(installed.status, 1);
    assert.equal(installed.json.errorCode, 'E_TIMEOUT');
    const intent = JSON.parse(await readFile(intentPath, 'utf8'));
    const queued = JSON.parse(await readFile(
      join(bridgeDir, 'queue', `${intent.jobId}.json`),
      'utf8',
    ));
    assert.equal(queued.jobId, intent.jobId);

    const result = {
      status: 'applied',
      jobId: intent.jobId,
      intentHash: prepared.json.intentHash,
      presetId: prepared.json.presetSummary.presetId,
      presetName: prepared.json.presetSummary.presetName,
      processedAt: new Date().toISOString(),
    };
    await writeFile(
      join(bridgeDir, 'outbox', `${intent.jobId}.json`),
      JSON.stringify(result),
      'utf8',
    );
    await writeFile(
      join(bridgeDir, 'processed', `${intent.jobId}.json`),
      JSON.stringify(result),
      'utf8',
    );
    const verified = runCli([
      'verify',
      intent.jobId,
      '--bridge-dir',
      bridgeDir,
    ]);
    assert.equal(verified.status, 0);
    assert.equal(verified.json.status, 'applied');
    assert.equal(verified.json.intentHash, prepared.json.intentHash);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('install reports app-side queued state instead of a false timeout', async () => {
  const temp = await temporaryRoot();
  try {
    const intentPath = join(temp, 'intent.json');
    const prepared = runCli([
      'prepare',
      txtFixture,
      '--name',
      'Bridge queued TXT',
      '--mode',
      'txt',
      '--category',
      'generate',
      '--out',
      intentPath,
    ]);
    assert.equal(prepared.status, 0);
    const intent = JSON.parse(await readFile(intentPath, 'utf8'));
    const bridgeDir = join(temp, 'bridge');
    const child = spawn(process.execPath, [
      cliPath,
      'install',
      intentPath,
      '--bridge-dir',
      bridgeDir,
      '--timeout-ms',
      '5000',
    ], {
      cwd: skillRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    await waitForFile(
      join(bridgeDir, 'queue', `${intent.jobId}.json`),
    );
    await writeFile(
      join(bridgeDir, 'outbox', `${intent.jobId}.json`),
      JSON.stringify({
        status: 'queued',
        jobId: intent.jobId,
        intentHash: prepared.json.intentHash,
        queuedReason: 'lab_open',
        processedAt: new Date().toISOString(),
      }),
      'utf8',
    );

    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    assert.equal(exitCode, 0, stderr || stdout);
    const result = JSON.parse(stdout.trim());
    assert.equal(result.status, 'queued');
    assert.equal(result.queuedReason, 'lab_open');
    assert.equal(result.jobId, intent.jobId);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('queued bridge results without a reason remain queued and verifiable', async () => {
  const temp = await temporaryRoot();
  try {
    const intentPath = join(temp, 'intent.json');
    const prepared = runCli([
      'prepare',
      txtFixture,
      '--name',
      'Bridge queued legacy TXT',
      '--mode',
      'txt',
      '--category',
      'generate',
      '--out',
      intentPath,
    ]);
    assert.equal(prepared.status, 0);
    const intent = JSON.parse(await readFile(intentPath, 'utf8'));
    const bridgeDir = join(temp, 'bridge');
    const child = spawn(process.execPath, [
      cliPath,
      'install',
      intentPath,
      '--bridge-dir',
      bridgeDir,
      '--timeout-ms',
      '5000',
    ], {
      cwd: skillRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    await waitForFile(
      join(bridgeDir, 'queue', `${intent.jobId}.json`),
    );
    await writeFile(
      join(bridgeDir, 'outbox', `${intent.jobId}.json`),
      JSON.stringify({
        status: 'queued',
        jobId: intent.jobId,
        intentHash: prepared.json.intentHash,
        processedAt: new Date(Date.now() + 1000).toISOString(),
      }),
      'utf8',
    );

    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    assert.equal(exitCode, 0, stderr || stdout);
    const installed = JSON.parse(stdout.trim());
    assert.equal(installed.status, 'queued');
    assert.equal(installed.jobId, intent.jobId);
    assert.match(installed.nextStep, /Close Workflow Lab/);

    const verified = runCli([
      'verify',
      intent.jobId,
      '--bridge-dir',
      bridgeDir,
    ]);
    assert.equal(verified.status, 0);
    assert.equal(verified.json.status, 'queued');
    assert.equal(verified.json.jobId, intent.jobId);
    assert.match(verified.json.nextStep, /Close Workflow Lab/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('doctor verifies the bundled runtime and bridge writability', async () => {
  const temp = await temporaryRoot();
  try {
    const result = runCli([
      'doctor',
      '--bridge-dir',
      join(temp, 'bridge-doctor'),
    ]);
    assert.equal(result.status, 0);
    assert.equal(result.json.status, 'ok');
    assert.match(result.json.runtimeSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.json.bridgeWritable, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
