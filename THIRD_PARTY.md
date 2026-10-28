# 第三方组件与来源说明 / Third-party notices

## 网页 play/（下载后双击即玩的部分）

| 内容 | 说明 |
|---|---|
| three.js r128（`play/vendor/three.min.js`） | 3D 渲染库，<https://github.com/mrdoob/three.js>，MIT License，Copyright © 2010-2021 three.js authors。原样复制，未修改（603,445 字节，SHA-256 `9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2`，与 `results/result.json` 中的记录一致）。许可证全文在同目录的 `three.js-LICENSE.txt` |
| 其他 JavaScript 库 | **没有**。其余代码全部在 `play/js/` |
| 字体 | **不内嵌任何字体**。只按名字引用操作系统自带字体：Windows 为 Microsoft YaHei，macOS 为 PingFang SC，其余回退到 `system-ui`。3D 场景里的“北 / 南 / 东 / 西”标牌也是用系统字体实时画的。字体文件本身不随本仓库分发 |
| 表情符号（⛰ 等） | Unicode 字符，由操作系统的表情字体显示，不随本仓库分发 |
| 图片、音效、模型 | 没有。所有物体都由代码用基本几何体实时生成；页面没有声音；没有任何机器学习模型 |
| 网络请求 | 没有。不用 CDN、不用 fetch / XHR、不用 service worker，`file://` 下即可运行 |

## 完整版 app/index_full.html

- 和网页版共用同一份 three.js（`../play/vendor/three.min.js`），没有其他第三方代码。
- 它会按使用者自己的设置，连接本机的大模型服务（例如 Ollama）或使用者填写的 OpenAI 兼容在线接口。这些服务和模型不随本仓库分发，使用时请遵守各自的许可和服务条款。

## 测试与构建工具（不随仓库分发）

| 工具 | 用途 | 许可证 |
|---|---|---|
| pytest | Python 测试 | MIT |
| Node.js | `tests/js/*.test.js`：在 Node 里运行 `play/js/*.js`，并和原版页面的代码逐项对照；`tools/plan_report.js` 生成 `results/result.json` | MIT（另含第三方组件，见 Node.js 的 LICENSE） |
| Playwright（Python 包） | `tools/browser_check.py`、`tools/mobile_check.py`、`tools/mobile_check_ttw.py`：驱动本机已装的 Edge / Chrome（channel 模式），用 DevTools 协议模拟手机尺寸和触屏；不下载任何浏览器 | Apache-2.0 |
| 本机已安装的 Microsoft Edge 或 Google Chrome | 无头打开页面跑自检、手机验收和截图；不下载任何浏览器 | — |

## 文本

- `LICENSE-docs` 中的 CC BY 4.0 法律文本来自 Creative Commons（creativecommons.org），按其规定原样附上。

## 代码来源

- 除 three.js 外，全部代码为作者原创（由 Claude Code 辅助编写，经作者审阅），没有从外部项目复制代码。
- `play/js/world.js` 里的随机数生成器是公开的 mulberry32 算法（一个小型伪随机数生成器），按算法描述重新实现。
- 拒绝采样、关键词匹配（最长匹配）都是通用方法，只用了思想。

## 名称与商标

- 网页里不出现任何商业产品或服务的名称；引擎和模型只用中性的叫法（“关键词规则引擎”“大语言模型”），集中在 `play/js/config.js`。
- README 的「完整版」一节为了说明用法，提到了 Ollama（开源的本机模型服务软件）和 OpenAI 兼容接口（一种通用的接口格式）；这只是说明性的提及，本项目与这些项目和公司没有关联。
- 学校名称只以文字形式出现在署名中；没有使用学校校标（logo）图片。
