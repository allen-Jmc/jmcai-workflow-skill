import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  WorkflowLabAgentError,
  compileWorkflowLabAgentIntent,
  computeValidatedWorkflowLabAgentIntentHash,
  computeWorkflowSourceHash,
  validateWorkflowLabAgentIntent,
} from '../scripts/lib/core-agent-runtime.mjs';

const fixture = name => new URL(`./fixtures/${name}`, import.meta.url);
const manifestUrl = new URL('../runtime-manifest.json', import.meta.url);
const runtimeUrl = new URL('../scripts/lib/core-agent-runtime.mjs', import.meta.url);

async function loadFixture(name) {
  return JSON.parse(await readFile(fixture(name), 'utf8'));
}

test('runtime bundle matches its manifest fingerprint', async () => {
  const runtime = await readFile(runtimeUrl);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const digest = createHash('sha256').update(runtime).digest('hex');
  const runtimeText = runtime.toString('utf8');
  assert.equal(digest, manifest.bundle.sha256);
  assert.equal(manifest.runtime.intentType, 'JMCAI_WORKFLOW_INTENT_V1');
  assert.equal(manifest.bundle.path, 'scripts/lib/core-agent-runtime.mjs');
  assert.ok(manifest.sources.files.length > 0);
  assert.ok(manifest.sources.files.every(file => file.path.startsWith('src/')));
  assert.equal(manifest.sources.shims.length, 1);
  assert.equal(
    manifest.sources.shims[0].path,
    'scripts/runtime-shims/comfyMetadataService.mjs',
  );
  assert.doesNotMatch(runtimeText, /node_modules\/@sentry/);
  assert.doesNotMatch(JSON.stringify(manifest), /node_modules/);
  assert.ok(runtime.length < 100_000);
});

test('fixture source hashes are stable and compiler produces a valid preset', async () => {
  const workflow = await loadFixture('txt-basic.json');
  assert.equal(
    computeWorkflowSourceHash(workflow),
    'deb0e1aee74fedb705ebf07b3d54e98d6a2032b2aeeffd12bed9f61e7827b61e',
  );
  const intent = {
    type: 'JMCAI_WORKFLOW_INTENT_V1',
    jobId: 'runtime-contract-txt',
    sourceHash: computeWorkflowSourceHash(workflow),
    workflow,
    preset: {
      name: 'Runtime TXT',
      mode: 'txt',
      category: 'generate',
    },
    core: {
      promptNode: { nodeId: '2', fieldPath: 'inputs.text' },
      negativePromptNode: { nodeId: '1', fieldPath: 'inputs.text' },
      seedNode: { nodeId: '4', fieldPath: 'inputs.seed' },
      widthNode: { nodeId: '3', fieldPath: 'inputs.width' },
      heightNode: { nodeId: '3', fieldPath: 'inputs.height' },
      batchSizeNode: { nodeId: '3', fieldPath: 'inputs.batch_size' },
    },
    controls: [
      { nodeId: '4', fieldPath: 'inputs.steps', label: '采样步数' },
      { nodeId: '4', fieldPath: 'inputs.sampler_name', label: '采样器' },
    ],
    outputNodeIds: ['6'],
  };
  const validated = validateWorkflowLabAgentIntent(intent);
  const compiled = compileWorkflowLabAgentIntent(validated.intent);
  assert.equal(compiled.validation.valid, true);
  assert.equal(compiled.preset.mapping.promptNode.nodeId, '2');
  assert.equal(compiled.preset.mapping.outputs[0].nodeId, '6');
  assert.equal(compiled.preset.ui_config.length, 2);
  assert.equal(
    compiled.preset.ui_config.find(
      control => control.fieldPath === 'inputs.sampler_name',
    ).type,
    'dropdown',
  );
  assert.equal(
    computeValidatedWorkflowLabAgentIntentHash(validated.intent),
    computeValidatedWorkflowLabAgentIntentHash(
      validateWorkflowLabAgentIntent(intent).intent,
    ),
  );
});

test('bundled runtime keeps nested Power Lora controls as dropdown, switch and slider', () => {
  const workflow = {
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'hello' },
    },
    '2': {
      class_type: 'Power Lora Loader (rgthree)',
      inputs: {
        model: ['1', 0],
        lora_1: {
          on: true,
          lora: 'detail.safetensors',
          strength: 0.7,
        },
      },
    },
    '3': {
      class_type: 'SaveImage',
      inputs: { images: ['2', 0] },
    },
  };
  const intent = {
    type: 'JMCAI_WORKFLOW_INTENT_V1',
    jobId: 'runtime-contract-power-lora',
    sourceHash: computeWorkflowSourceHash(workflow),
    workflow,
    preset: {
      name: 'Runtime Power Lora',
      mode: 'txt',
      category: 'generate',
    },
    core: {
      promptNode: { nodeId: '1', fieldPath: 'inputs.text' },
    },
    controls: [
      {
        nodeId: '2',
        fieldPath: 'inputs.lora_1.lora',
        preferredType: 'dropdown',
      },
      {
        nodeId: '2',
        fieldPath: 'inputs.lora_1.on',
        preferredType: 'switch',
      },
      {
        nodeId: '2',
        fieldPath: 'inputs.lora_1.strength',
        preferredType: 'slider',
      },
    ],
    outputNodeIds: ['3'],
  };
  const compiled = compileWorkflowLabAgentIntent(
    validateWorkflowLabAgentIntent(intent).intent,
  );
  assert.equal(
    compiled.preset.ui_config.find(control => control.fieldPath === 'inputs.lora_1.lora')?.type,
    'dropdown',
  );
  assert.equal(
    compiled.preset.ui_config.find(control => control.fieldPath === 'inputs.lora_1.on')?.type,
    'switch',
  );
  assert.equal(
    compiled.preset.ui_config.find(control => control.fieldPath === 'inputs.lora_1.strength')?.type,
    'slider',
  );
});

test('plugin, unsafe metadata and non-scalar fields are rejected by the bundled contract', async () => {
  const workflow = await loadFixture('txt-basic.json');
  const base = {
    type: 'JMCAI_WORKFLOW_INTENT_V1',
    jobId: 'runtime-contract-errors',
    sourceHash: computeWorkflowSourceHash(workflow),
    workflow,
    preset: { name: 'Unsafe', mode: 'txt', category: 'generate' },
    core: {
      promptNode: { nodeId: '2', fieldPath: 'inputs.text' },
    },
    controls: [],
  };
  assert.throws(
    () => validateWorkflowLabAgentIntent({
      ...base,
      preset: { name: 'Unsafe', mode: 'plugin', category: 'generate' },
    }),
    error => (
      error instanceof WorkflowLabAgentError &&
      error.code === 'E_UNSUPPORTED_MODE'
    ),
  );
  assert.throws(
    () => validateWorkflowLabAgentIntent({
      ...base,
      evidence: { apiKey: 'not-a-secret-value' },
    }),
    error => (
      error instanceof WorkflowLabAgentError &&
      error.code === 'E_SECRET_FIELD'
    ),
  );
  assert.throws(
    () => validateWorkflowLabAgentIntent({
      ...base,
      core: {
        promptNode: { nodeId: '2', fieldPath: 'inputs.clip' },
      },
    }),
    error => (
      error instanceof WorkflowLabAgentError &&
      error.code === 'E_FIELD_PATH_NOT_SCALAR'
    ),
  );
});
