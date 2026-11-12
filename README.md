# Claude Write Fold

Windows x64 上的 Claude Code 显示补丁：将普通 `Write`、`Edit`、`NotebookEdit`、`WebFetch`、`WebSearch` 纳入原生工具合并块，工作中只显示最后一项的原生结果预览。

- Write 保留代码预览，Edit 保留红绿差异，NotebookEdit 保留单元格内容。
- Fetch、Web Search 复用原生结果预览，完成后汇总网页和查询次数；Ctrl+O 保留各条原生记录，不混入文件读取数。
- 修订 14 让详情提示与最新工具调用同步切换，避免文件预览结束后短暂露出上一工具的提示。同一工具内的进度仍使用原生 700 ms 节流。
- 修订 15 补齐流式参数结束到正式记录出现之间的交接，避免 `Edit()` 后闪回旧预览或思考提示。等待时显示 `Editing…`、`Writing…` 等状态，接到结果后直接显示原生预览；取消、结束和切换会话时清理等待状态。
- 标题栏沿用原生逻辑，不额外添加工具标题。
- 修订 16 适配 2.1.322 的分组合并、提示节流调用位置和下载详情分支；保留新版原生状态处理及独立的圆点组件。未修改 Git、进程启动或 Bun 打包逻辑。
- 失败的 Write、Update（Edit）、NotebookEdit 在外层隐藏，不显示失败预览或失败数量，也不计入成功修改数和增删行数；Ctrl+O 保留完整错误。只有失败操作的空组不会占一行。
- 后续操作接替或整组结束时预览收起；保留 `Ctrl+O`、完整错误记录和长内容截断。
- 修订 11 直接复用原生布局订阅，修正外层圆点可见后未恢复动画订阅的问题。此前绕过可见性测量、重建圆点的临时处理已删除；原生圆点组件、闪烁周期、焦点和减少动画规则保持不变。
- 成功后台 shell 通知继续合并显示 `completed N background task(s)`。失败通知不再显示外层计数；独立的原生 task 失败通知也只在展开记录中显示，保留完整内容和退出码。
- 修订 10 以 v0.1.3 为基线，仅接入原生子任务运行状态，修正工具调用间隙过早显示完成样式的问题。这项状态修正继续保留，标题和原生展开逻辑不变。

非官方项目。仓库仅提供补丁脚本，不包含 Claude Code 可执行文件、原版备份或提取出的完整源码；补丁在本机已有安装上生成。

## 环境

Windows x64、原生 `claude.exe`、fullscreen 终端界面；Python 3.10+ 和 Node.js 20+ 均能在终端运行。

已检查 2.1.311、2.1.316、2.1.322 的分组结构；最新真实界面验证版本为 **2.1.322**。这表示对应功能测试通过，不表示所有启动卡顿已经修复；具体启动对照和限制见 `VERIFICATION.md`。

## 安装

下载仓库 ZIP 并解压，或克隆仓库：

```powershell
git clone https://github.com/SinCircle/claude-write-fold.git
cd claude-write-fold
.\inject.cmd
```

也可以双击 `inject.cmd`。脚本通过官方命令升级 Claude Code 到 latest 通道，保存未修改原版到 `backup_org`，构建并验证补丁后替换主程序。完成后重新启动 Claude Code，在项目终端照常运行 `claude` 或 `claude --resume`。

仅给当前已安装版本打补丁，不先升级：

```powershell
python .\inject.py --install
```

恢复对应原版：

```powershell
.\restore-original.cmd
```

若主程序已被其他更新或修改替换，恢复脚本会停止，避免覆盖未知版本。

## 独立副本与检查

构建并启动独立副本，不替换主程序：

```powershell
.\claude-write-fold.cmd --resume
```

保留当前工作目录，沿用现有配置，仅对启动的子进程关闭自动更新。

只检查兼容性：

```powershell
python .\inject.py --check
```

自动查找用户目录下的 `.local/bin/claude.exe` 及 PATH 中的原生安装。也可指定源程序：

```powershell
python .\inject.py --source 'C:\path\to\claude.exe' --check
```

## 更新与兼容范围

补丁脚本更新后再次运行 `inject.cmd` 即可；Git 用户可先执行 `git pull --ff-only`。脚本能识别已安装的自身补丁，并从对应原版备份重新构建。

主程序自动更新设置保持不变，后续 Claude Code 更新可能覆盖补丁，届时重新注入。请保留安装时的目录及其中的 `install.json`、`backup_org`，重复注入和恢复依赖这些本机记录。

脚本解析 JavaScript 并按 token 结构匹配分组、计数、错误处理和预览入口，不固定上游版本号、模块文件名或压缩变量名。每个位置必须唯一匹配。仅变量改名或空白变化时可自动重定位；若上游修改 Bun 容器布局或相关逻辑，脚本会停止并写入 `last-error.txt`，需要适配后再使用。

每次构建均检查 JavaScript 语法、其他模块载荷与原生程序段未变，并对照原版的 `--version`、`--help`。自动检查不等于对所有未来版本完成真实界面验证。补丁副本不保留原可执行文件的数字签名。

## 文件与验证

- `inject.py`：安装检测、备份、容器重建、验证、安装和恢复。
- `adapter.mjs`：两套分组结构适配、结果预览、圆点可见性修复和后台命令结果通知合并。
- 三个 `.cmd`：升级注入、独立启动、恢复入口。
- `vendor/acorn.mjs`：随包提供的解析器，许可见 `vendor/ACORN-LICENSE`。
- `tests/`：对本机原版进行结构适配、变量改名及拒绝条件测试。
- `VERIFICATION.md`：测试范围及边界；`verification/animation-validation.json`：闪烁对照结果。

```powershell
python .\tests\check_adapter.py --source 'C:\path\to\unmodified\claude.exe'
```

测试临时提取本机原版的四个目标模块，验证变量改名、空白变化、重复补丁、歧义匹配、结构变化处理、原生圆点状态、后台通知、网页分组和详情切换，结束后清理临时文件。可对不同版本的原版分别执行，不调用模型服务或安装补丁。

注入不调用模型服务、不下载依赖；官方升级需要联网。供应商设置、权限规则和模型请求逻辑保持原样。

## 参考

原生 Bun 容器布局研究参考了 [tweakcc](https://github.com/Piebald-AI/tweakcc)，本项目不依赖它。官方安装升级说明见 [Claude Code setup](https://code.claude.com/docs/en/setup)。
