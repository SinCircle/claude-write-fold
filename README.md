# Claude Write Fold

Windows x64 上的 Claude Code 显示补丁：将普通 `Write`、`Edit`、`NotebookEdit` 纳入原生工具合并块，工作中只显示最后一项的原生结果预览。

- Write 保留代码预览，Edit 保留红绿差异，NotebookEdit 保留单元格内容。
- 标题栏沿用原生逻辑，不额外添加工具标题。
- 失败的 Write、Update（Edit）、NotebookEdit 也留在合并块中，摘要标红显示 `failed N file operation(s)`；失败项不计入成功修改数和增删行数。活动时复用原生简短错误预览，Ctrl+O 查看完整原因。
- 后续操作接替或整组结束时预览收起；保留 `Ctrl+O`、错误提示和长内容截断。
- 修订 11 直接复用原生布局订阅，修正外层圆点可见后未恢复动画订阅的问题。此前绕过可见性测量、重建圆点的临时处理已删除；原生圆点组件、闪烁周期、焦点和减少动画规则保持不变。
- 修订 8 将成功或失败的后台 shell 通知收进包含原始命令的当前合并块，分别显示 `completed 1 background task` 和 `failed 1 background task`，失败数量标红，不重复增加命令数。Ctrl+O 保留完整通知和退出码；取消、其他任务类型、格式不符或无法对应到当前组的通知保持原样。
- 修订 10 以 v0.1.3 为基线，仅接入原生子任务运行状态，修正工具调用间隙过早显示完成样式的问题。这项状态修正继续保留，标题和原生展开逻辑不变。

非官方项目。仓库仅提供补丁脚本，不包含 Claude Code 可执行文件、原版备份或提取出的完整源码；补丁在本机已有安装上生成。

## 环境

Windows x64、原生 `claude.exe`、fullscreen 终端界面；Python 3.10+ 和 Node.js 20+ 均能在终端运行。

已检查 2.1.311、2.1.316 的两套分组结构；最新真实界面验证版本为 **2.1.316**。

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

测试临时提取本机原版的两个目标模块，验证变量改名、空白变化、重复补丁、歧义匹配、结构变化处理、原生圆点状态以及后台通知识别、归属和计数，结束后清理临时文件。可对不同版本的原版分别执行，不调用模型服务或安装补丁。

注入不调用模型服务、不下载依赖；官方升级需要联网。供应商设置、权限规则和模型请求逻辑保持原样。

## 参考

原生 Bun 容器布局研究参考了 [tweakcc](https://github.com/Piebald-AI/tweakcc)，本项目不依赖它。官方安装升级说明见 [Claude Code setup](https://code.claude.com/docs/en/setup)。
