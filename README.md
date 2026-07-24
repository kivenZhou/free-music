# 音栈 (YinZhan)

**聚合免费可播音源的桌面音乐客户端**，支持 macOS / Windows。

不依赖单一平台账号，侧栏切换网易云、B站、酷狗、酷我等音源，榜单浏览、搜索、收藏、歌单与播放都在本地完成，不跳转外部浏览器。

> 仅聚合各站**可免费完整播放**的曲目；会员专属 / 下架内容无法播放。数据全部存在本机，无账号体系、无社交功能。

## 特点

- **多音源一体**：榜单与搜索按音源切换，同一套播放器体验
- **只听完整曲**：过滤试听截断与会员曲，减少点了播不了
- **本地优先**：收藏、多歌单、搜索历史、播放队列都在本机
- **听歌闭环**：队列 / 随机循环、歌词、迷你窗、系统媒体键、菜单栏托盘
- **轻量桌面端**：Tauri 2 + React，体积与内存占用相对 Electron 更小
- **开箱即用**：无需登录、无需自建服务端

## 功能

| 模块 | 说明 |
|------|------|
| 榜单 | 各音源热歌 / 新歌等分类；分页「加载更多」 |
| 搜索 | 可按音源筛选；历史本地保存 |
| 收藏 / 歌单 | 多歌单管理，曲目可加入指定歌单 |
| 播放 | 内嵌播放；流式开播（部分源后台缓存） |
| 歌词 | 网易云 LRC；其它源按歌名歌手匹配 |
| 其它 | 迷你置顶窗、队列持久化、设置（默认音源 / 自动跳过 / 清缓存） |

## 下载安装

从本仓库 [Releases](https://github.com/kivenZhou/free-music/releases) 下载适合你系统的安装包。

| 平台 | 推荐文件 |
|------|----------|
| macOS（Intel / Apple Silicon） | `音栈_*_universal.dmg` 或 `.zip` |
| Windows | `.exe`（NSIS）或 `.msi` |

### macOS

1. 打开 `.dmg`，将「音栈」拖到「应用程序」；或解压 `.zip`
2. 首次打开：对「音栈」**右键 → 打开**（不要直接双击），弹窗再点「打开」

### Windows

安装后直接运行即可。若 SmartScreen 提示，选择「仍要运行」（开源未签名包常见）。

### 打不开？（补充）

未做 Apple 公证的个人 / 开源包，经**微信**等渠道转发后，macOS 可能提示「已损坏」并移到垃圾桶，且不一定出现在「隐私与安全性」。

可依次尝试：

1. 改用隔空投送 / 网盘 / 邮件获取安装包（避免微信）
2. 确认使用 `universal` 通用包，并把 App 放进「应用程序」
3. 终端执行后再右键打开：

```bash
xattr -cr /Applications/音栈.app
```

## 本地数据

| 内容 | macOS 路径 |
|------|------------|
| 搜索历史、收藏、歌单 | `~/Library/Application Support/com.zzy.yinzhan/` |
| 音频缓存 | `~/Library/Caches/com.zzy.yinzhan/audio/` |

Windows 对应 `%APPDATA%` / `%LOCALAPPDATA%` 下 `com.zzy.yinzhan`。可在应用「设置」中清除音频缓存。

## 参与开发

需要：Node 18+、Rust（rustup）；macOS 还需 Xcode CLT。

```bash
export N_PREFIX="$HOME/.n"
export PATH="$HOME/.n/bin:$HOME/.cargo/bin:$PATH"

git clone https://github.com/kivenZhou/free-music.git
cd free-music
npm install
npm run tauri dev
```

修改 Rust / `capabilities` 后需完整重启 Tauri。

### 自行打包

```bash
# macOS 通用包
npm run tauri build -- --target universal-apple-darwin

# Windows（请在 Windows 本机，或使用仓库 GitHub Actions）
npm run tauri build
```

CI：推送 tag（如 `v0.1.0`）或手动运行 `.github/workflows/release.yml`，可产出 macOS / Windows 产物。

## 技术栈

- 前端：React 19 + Vite + TypeScript
- 桌面：Tauri 2
- 本地存储：SQLite
- 后端：Rust（可插拔 Provider）

## 说明与免责

- 仅供学习与个人使用；请遵守各音源服务条款与当地法律法规
- 不提供破解会员、绕过版权的能力；播放成败取决于源站是否开放免费完整流
- B站等接口可能限流，榜单变少或失败时可稍后重试

## License

MIT — 见 [LICENSE](./LICENSE)
