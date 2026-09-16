# Application icon family / 应用图标族

Original “Sliding Models” geometry: two offset model cards and an explicit switching arrow.
原创「滑移卡片」：两层模型卡片与明确的切换箭头。无字体、第三方素材或上游代码移植；沿用项目 MIT 许可。

## Source and regeneration / 源与重建

`icon.svg` is the only editable production geometry. Do not edit raster outputs.
`icon.svg` 是唯一可编辑生产图形；不要手工修改派生文件。

Run from the repository root / 在仓库根目录执行：

```text
node scripts/generate-icons.mjs
node scripts/generate-icons.mjs --check
corepack pnpm exec vitest run tests/desktop/icon-family.test.ts
powershell -NoProfile -File scripts/check-icons.ps1 -Preview
```

The generator uses the existing locked Tauri CLI SVG renderer and Node built-ins. It changes only palette/arrow visibility for monochrome variants, then renders every size from the SVG. Temporary renders and the optional review board stay in `.workspace/tmp/icon-family/`.
生成器复用已锁定 Tauri CLI 和 Node 内置库，仅改变配色与单色版箭头填充；每个尺寸都直接来自 SVG。临时图与可选检查板保存在本机过程目录。

## Resources / 资源

| Resource | Purpose / 用途 |
| --- | --- |
| `app-{size}.png` | Blue accent, usable on light and dark backgrounds / 蓝色强调版，适用明暗背景 |
| `mono-dark-{size}.png` | Dark ink on light surfaces / 浅色背景单色版 |
| `mono-light-{size}.png` | White ink on dark surfaces / 深色背景反白版 |
| `icon.ico` | All eight accent sizes; 256px first for Tauri's window decoding / 全部八个强调版尺寸，256px 首帧用于 Tauri 窗口解码 |

Sizes / 尺寸：16, 20, 24, 32, 48, 64, 128, 256 pixels. Transparent margins and separation remain at every size. The two monochrome versions use transparent arrow cutouts. Blue is identity, never a promise that a model is active.
每个尺寸保留透明边距和层间间隔；单色版箭头为镂空。蓝色只代表产品标识，不表示模型正在运行。

## Windows entry points / Windows 入口

| Entry | Resource path |
| --- | --- |
| Installer / 安装程序 | `bundle.windows.nsis.installerIcon → icons/icon.ico` |
| Uninstaller / 卸载程序 | `bundle.windows.nsis.uninstallerIcon → icons/icon.ico` |
| Executable / 应用程序 | `bundle.icon → icons/icon.ico → Windows PE resources` |
| Shortcut / 快捷方式 | Generated NSIS shortcuts target the application executable / NSIS 快捷方式使用应用可执行文件 |
| Window and taskbar / 窗口与任务栏 | Tauri default window icon from the first ICO entry; Explorer uses executable resources / Tauri 首帧窗口图标及 Explorer 应用资源 |
| Tray / 托盘 | `tray.rs → tauri::include_image!("icons/app-32.png")`; embedded in dev and packaged builds / 开发及生产构建均内嵌 |

These PNG/ICO files are required build inputs, not release executables. Checks of decoded resources and offline previews do not establish installed shortcut caches, OS theme/DPI behavior, native tray appearance, or real LM Studio GUI acceptance.
PNG/ICO 是构建必需资源，不是发布可执行制品。资源解码与离线预览不能代替安装后快捷方式缓存、系统主题/DPI、原生托盘或真实 LM Studio GUI 验收。
