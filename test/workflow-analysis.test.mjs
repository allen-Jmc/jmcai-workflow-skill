import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  ANALYSIS_VERSION,
  WorkflowAnalysisError,
  analyzeWorkflow,
} from '../scripts/lib/workflow-analysis.mjs';

const fixture = name => new URL(`./fixtures/${name}`, import.meta.url);

async function loadFixture(name) {
  return JSON.parse(await readFile(fixture(name), 'utf8'));
}

test('TXT fixture produces a ready text-to-image proposal and safe common controls', async () => {
  const workflow = await loadFixture('txt-basic.json');
  const analysis = analyzeWorkflow(workflow);

  assert.equal(analysis.version, ANALYSIS_VERSION);
  assert.equal(analysis.modeConfirmationRequired, true);
  assert.equal(analysis.suggestedMode, 'txt');
  assert.deepEqual(analysis.readyModes, ['txt']);
  assert.equal(analysis.status, 'needs_confirmation');
  assert.deepEqual(analysis.proposals.txt.core.promptNode, {
    nodeId: '2',
    fieldPath: 'inputs.text',
  });
  assert.deepEqual(analysis.proposals.txt.core.negativePromptNode, {
    nodeId: '1',
    fieldPath: 'inputs.text',
  });
  assert.deepEqual(analysis.proposals.txt.core.seedNode, {
    nodeId: '4',
    fieldPath: 'inputs.seed',
  });
  assert.deepEqual(analysis.proposals.txt.core.widthNode, {
    nodeId: '3',
    fieldPath: 'inputs.width',
  });
  assert.deepEqual(analysis.proposals.txt.outputNodeIds, ['6']);
  assert.equal(analysis.proposals.txt.ready, true);
  assert.equal(analysis.proposals.img.ready, false);
  assert.deepEqual(
    analysis.ambiguities.find(item => item.kind === 'image_input').modes,
    ['img'],
  );
  assert.deepEqual(
    analysis.proposals.txt.controls.map(control => control.fieldPath),
    [
      'inputs.steps',
      'inputs.cfg',
      'inputs.denoise',
      'inputs.sampler_name',
      'inputs.scheduler',
      'inputs.ckpt_name',
    ],
  );
  assert.deepEqual(analysis.summary.optionalControls, []);
});

test('analysis surfaces ratio, model and nested LoRA controls with type hints', async () => {
  const workflow = await loadFixture('txt-basic.json');
  workflow['3'].inputs.width = ['51', 0];
  workflow['3'].inputs.height = ['51', 1];
  workflow['51'] = {
    class_type: 'ResolutionSelector',
    _meta: { title: '自定义出图尺寸' },
    inputs: { aspect_ratio: '3:4 (Portrait Standard)', megapixels: 2, multiple: 32 },
  };
  workflow['52'] = {
    class_type: 'Power Lora Loader (rgthree)',
    _meta: { title: '权重Lora加载器' },
    inputs: {
      lora_1: { on: true, lora: 'detail.safetensors', strength: 0.7 },
      model: ['50', 0],
    },
  };
  workflow['4'].inputs.model = ['52', 0];

  const analysis = analyzeWorkflow(workflow);
  const controls = analysis.proposals.txt.controls;
  const findControl = (nodeId, fieldPath) => controls.find(
    control => control.nodeId === nodeId && control.fieldPath === fieldPath,
  );

  assert.equal(findControl('51', 'inputs.aspect_ratio')?.preferredType, 'dropdown');
  assert.equal(findControl('50', 'inputs.ckpt_name')?.preferredType, 'dropdown');
  assert.equal(findControl('52', 'inputs.lora_1.lora')?.preferredType, 'dropdown');
  assert.equal(findControl('52', 'inputs.lora_1.on')?.preferredType, 'switch');
  assert.equal(findControl('52', 'inputs.lora_1.strength')?.preferredType, 'slider');
});

test('semantic boolean nodes surface as named switches', async () => {
  const workflow = await loadFixture('txt-basic.json');
  workflow['7'] = {
    class_type: 'ComfySwitchNode',
    _meta: { title: '提示词优化开关' },
    inputs: {
      switch: false,
      on_false: ['2', 0],
      on_true: ['8', 0],
    },
  };
  workflow['8'] = {
    class_type: 'PrimitiveBoolean',
    _meta: { title: '自定义尺寸（开关）' },
    inputs: { value: false },
  };
  workflow['4'].inputs.positive = ['7', 0];

  const analysis = analyzeWorkflow(workflow);
  const controls = analysis.proposals.txt.controls;
  const promptSwitch = controls.find(
    control => control.nodeId === '7' && control.fieldPath === 'inputs.switch',
  );
  const sizeSwitch = controls.find(
    control => control.nodeId === '8' && control.fieldPath === 'inputs.value',
  );

  assert.equal(promptSwitch?.label, '提示词优化');
  assert.equal(promptSwitch?.preferredType, 'switch');
  assert.equal(promptSwitch?.group, '常用参数');
  assert.equal(sizeSwitch?.label, '自定义尺寸');
  assert.equal(sizeSwitch?.preferredType, 'switch');
  assert.equal(sizeSwitch?.group, '尺寸参数');
});

test('advanced samplers resolve guider prompts and ordered image links', () => {
  const workflow = {
    '1': {
      class_type: 'PrimitiveStringMultiline',
      _meta: { title: '这里写提示词' },
      inputs: { value: 'replace the outfit' },
    },
    '2': {
      class_type: 'PrimitiveStringMultiline',
      _meta: { title: 'Text (System Prompt)' },
      inputs: { value: 'system instructions' },
    },
    '3': {
      class_type: 'ComfySwitchNode',
      inputs: { switch: false, on_false: ['1', 0], on_true: ['1', 0] },
    },
    '4': {
      class_type: 'TextEncodeQwenImage21',
      _meta: { title: '文本编码' },
      inputs: {
        prompt: ['3', 0],
        negative_prompt: '',
        'images.image_1': ['10', 0],
        'images.image_2': ['11', 0],
      },
    },
    '5': {
      class_type: 'CFGGuider',
      inputs: { cfg: 1, positive: ['4', 0], negative: ['4', 1] },
    },
    '6': { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    '7': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '8': { class_type: 'ManualSigmas', inputs: { sigmas: '1, 0.5, 0' } },
    '9': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
    },
    '10': {
      class_type: 'LoadImage',
      _meta: { title: '主图' },
      inputs: { image: 'main.png' },
    },
    '11': {
      class_type: 'LoadImage',
      _meta: { title: '参考图' },
      inputs: { image: 'reference.png' },
    },
    '12': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['6', 0],
        guider: ['5', 0],
        sampler: ['7', 0],
        sigmas: ['8', 0],
        latent_image: ['9', 0],
      },
    },
    '13': { class_type: 'SaveImage', inputs: { images: ['12', 0] } },
  };

  const analysis = analyzeWorkflow(workflow);
  assert.equal(analysis.status, 'needs_confirmation');
  assert.deepEqual(analysis.readyModes, ['txt', 'img']);
  assert.equal(analysis.summary.primarySampler?.nodeId, '12');
  assert.deepEqual(analysis.proposals.img.core.promptNode, {
    nodeId: '1',
    fieldPath: 'inputs.value',
  });
  assert.deepEqual(analysis.proposals.img.core.seedNode, {
    nodeId: '6',
    fieldPath: 'inputs.noise_seed',
  });
  assert.deepEqual(analysis.proposals.img.core.imageInputNode1, {
    nodeId: '10',
    fieldPath: 'inputs.image',
  });
  assert.deepEqual(
    analysis.summary.extraImages.map(candidate => candidate.nodeId),
    ['11'],
  );
});

test('Qwen-style IMG fixture maps custom prompt, image1 and extra reference images', async () => {
  const workflow = await loadFixture('img-qwen-like.json');
  const analysis = analyzeWorkflow(workflow);

  assert.equal(analysis.suggestedMode, 'img');
  assert.equal(analysis.suggestedCategory, 'edit');
  assert.deepEqual(analysis.readyModes, ['txt', 'img']);
  assert.deepEqual(analysis.proposals.img.core.promptNode, {
    nodeId: '48',
    fieldPath: 'inputs.prompt',
  });
  assert.deepEqual(analysis.proposals.img.core.negativePromptNode, {
    nodeId: '53',
    fieldPath: 'inputs.prompt',
  });
  assert.deepEqual(analysis.proposals.img.core.imageInputNode1, {
    nodeId: '46',
    fieldPath: 'inputs.image',
  });
  assert.deepEqual(analysis.summary.extraImages, [
    {
      nodeId: '47',
      label: '加载参考图 (#47)',
      classType: 'LoadImage',
      fieldPath: 'inputs.image',
    },
  ]);
  assert.ok(
    analysis.proposals.img.controls.some(
      control => control.nodeId === '47' && control.label === '参考图 2',
    ),
  );
  assert.ok(
    analysis.proposals.img.controls.some(
      control => control.fieldPath === 'inputs.sampler_name',
    ),
  );
  assert.ok(
    analysis.summary.optionalControls.some(
      control => control.fieldPath === 'inputs.resolution_steps',
    ),
  );
  assert.deepEqual(analysis.proposals.img.outputNodeIds, ['36']);
});

test('single-image IMG workflow does not invent a second reference image', async () => {
  const workflow = await loadFixture('img-qwen-like.json');
  delete workflow['47'];
  delete workflow['48'].inputs.image2;

  const analysis = analyzeWorkflow(workflow);
  assert.equal(analysis.suggestedMode, 'img');
  assert.deepEqual(analysis.proposals.img.core.imageInputNode1, {
    nodeId: '46',
    fieldPath: 'inputs.image',
  });
  assert.deepEqual(analysis.summary.extraImages, []);
  assert.equal(
    analysis.proposals.img.controls.some(
      control => control.nodeId === '47',
    ),
    false,
  );
});

test('equally plausible samplers are reported instead of guessed', async () => {
  const workflow = await loadFixture('ambiguous-samplers.json');
  const analysis = analyzeWorkflow(workflow);

  assert.equal(analysis.status, 'needs_input');
  assert.deepEqual(analysis.readyModes, []);
  const samplerAmbiguity = analysis.ambiguities.find(
    ambiguity => ambiguity.kind === 'sampler',
  );
  assert.ok(samplerAmbiguity);
  assert.deepEqual(
    samplerAmbiguity.candidates.map(candidate => candidate.nodeId),
    ['4', '14'],
  );
});

test('UI-format workflow is rejected with an actionable export error', async () => {
  const workflow = await loadFixture('ui-format.json');
  assert.throws(
    () => analyzeWorkflow(workflow),
    error => (
      error instanceof WorkflowAnalysisError &&
      error.code === 'E_UI_WORKFLOW_FORMAT'
    ),
  );
});

test('empty workflow object is rejected', () => {
  assert.throws(
    () => analyzeWorkflow({}),
    error => (
      error instanceof WorkflowAnalysisError &&
      error.code === 'E_WORKFLOW_EMPTY'
    ),
  );
});
