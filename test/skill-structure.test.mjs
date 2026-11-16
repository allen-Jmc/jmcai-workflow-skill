import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const skillUrl = new URL('../SKILL.md', import.meta.url);
const skillManifestUrl = new URL('../agents/openai.yaml', import.meta.url);

test('Skill metadata has the required name and narrow invocation language', async () => {
  const skill = await readFile(skillUrl, 'utf8');
  assert.match(skill, /^---\nname: jmcai-workflow-skill\n/);
  assert.match(skill, /Always ask the user to confirm `TXT` or `IMG`/);
  assert.match(skill, /Install only after the confirmation/);
  assert.match(skill, /Never edit `localStorage`, IndexedDB, browser profiles, or `AppSettings`/);
  assert.doesNotMatch(skill, /TODO|TBD|placeholder/i);

  const manifest = await readFile(skillManifestUrl, 'utf8');
  assert.match(manifest, /display_name: "JMCAI 工作流配置助手"/);
  assert.match(manifest, /\$jmcai-workflow-skill/);
});
