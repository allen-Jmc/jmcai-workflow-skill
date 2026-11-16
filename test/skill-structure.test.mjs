import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const skillUrl = new URL('../SKILL.md', import.meta.url);
const skillManifestUrl = new URL('../agents/openai.yaml', import.meta.url);
const readmeUrl = new URL('../README.md', import.meta.url);
const licenseUrl = new URL('../LICENSE', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

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

test('README documents a GitHub-root installation that works with the official installer', async () => {
  const readme = await readFile(readmeUrl, 'utf8');
  assert.match(readme, /--repo allen-Jmc\/jmcai-workflow-skill/);
  assert.match(readme, /--path \./);
  assert.match(readme, /--name jmcai-workflow-skill/);
  assert.match(readme, /--bridge-dir/);
  assert.doesNotMatch(readme, /仓库发布到 GitHub 后|首次发布前仓库尚不存在/);
});

test('public distribution metadata declares the MIT license', async () => {
  const license = await readFile(licenseUrl, 'utf8');
  assert.match(license, /^MIT License\n/);
  assert.match(license, /Copyright \(c\) 2026 allen-Jmc/);

  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(manifest.license, 'MIT');
});
