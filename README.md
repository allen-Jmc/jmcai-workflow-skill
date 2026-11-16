# jmcai-workflow-skill

[![CI](https://github.com/allen-Jmc/jmcai-workflow-skill/actions/workflows/test.yml/badge.svg)](https://github.com/allen-Jmc/jmcai-workflow-skill/actions/workflows/test.yml)

面向用户的 Codex Skill：把 ComfyUI API-format workflow JSON 分析并配置成 JMCAI 工作流实验室预设。

GitHub 仓库：`https://github.com/allen-Jmc/jmcai-workflow-skill`

## 安装

在 Codex 中发送下面的请求：

```text
使用 $skill-installer 从 GitHub 安装 allen-Jmc/jmcai-workflow-skill。
仓库根目录就是 Skill 本体，安装时使用 --path . 和 --name jmcai-workflow-skill。
```

这个仓库只有根目录一个 Skill。官方安装器默认会把路径最后一段当作目录名，因此根目录安装必须显式指定 `--name jmcai-workflow-skill`。

也可以直接运行安装器：

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
python3 "$CODEX_HOME/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo allen-Jmc/jmcai-workflow-skill \
  --path . \
  --name jmcai-workflow-skill
```

安装完成后，新开一个 Codex 回合即可使用。安装器不会覆盖已有目录；更新时先备份并移除 `$CODEX_HOME/skills/jmcai-workflow-skill`，再重新安装。

如果无法使用 GitHub 安装器，也可以克隆仓库后把整个目录复制到 `$CODEX_HOME/skills/jmcai-workflow-skill`。普通使用不需要执行 `npm install`。

## 前置条件

- Node.js 20 或更新版本。
- 已发布包含 Workflow Lab Agent bridge 的 JMCAI 应用。
- 应用与 CLI 挂载同一个 bridge 目录，默认是 `~/JMCAI/workflow-lab-agent-bridge`。

Web 端在“算力中心 → 存储系统 → 挂载目录”授权；桌面端选择同一目录。

如果应用使用了其他目录，请把同一个路径通过 `--bridge-dir` 传给所有会访问 bridge 的命令。例如 Windows 应用挂载 `D:\test\jmcai目录挂载`、Codex 在 WSL 中运行时：

```bash
node scripts/jmcai-workflow.mjs doctor --bridge-dir "/mnt/d/test/jmcai目录挂载"
```

## 首次使用

在 Codex 中调用 `$jmcai-workflow-skill`，上传或提供 ComfyUI API-format workflow JSON，并说明你想配置成 `TXT` 还是 `IMG`。Skill 会分析节点、提出预设名称和控件方案，等你确认后才写入工作流实验室。

如果工作流实验室正打开或存在未部署草稿，安装任务会进入 `queued` 状态。先关闭实验室或处理草稿，再按规定检查任务结果。

## 本地检查

```bash
npm test
node scripts/jmcai-workflow.mjs doctor --bridge-dir "/path/to/bridge"
```

## 维护

运行时的契约与编译器来自 JMCAI Core。更新 Core 后，在维护机上执行：

```bash
JMCAI_CORE_ROOT="/path/to/JMCAI-CORE-V10" node scripts/sync-core-runtime.mjs
node --test
```

`scripts/lib/core-agent-runtime.mjs` 是生成文件，不手工编辑。`runtime-manifest.json` 记录契约版本、源文件指纹和 bundle 哈希。

## 兼容性

当前 Skill 只支持 `TXT` 和 `IMG`、ComfyUI API workflow、已挂载的 Agent bridge。`PLUGIN`、ComfyUI UI-format 转换、URL 下载和直接修改应用存储不在首版范围内。

## 许可证

[MIT](LICENSE)
