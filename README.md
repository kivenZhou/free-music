# 音栈 (YinZhan)

国内优先的桌面音乐客户端（Tauri 2 + React）。

## 功能

- 搜索音乐（历史本地 SQLite）
- 收藏（本地）
- 榜单：热歌榜 / 新歌榜 / 飙升榜 / 抖音热歌 / 韩国流行 / 日本流行
- 应用内嵌播放，不跳转外部浏览器
- 可插拔音源 Provider（当前默认：网易云）

## 开发

需要：Node 18+、Rust（rustup）、macOS 上 Xcode CLT。

```bash
export N_PREFIX="$HOME/.n"
export PATH="$HOME/.n/bin:$HOME/.cargo/bin:$PATH"
# 若 Node 过旧：n 22

cd client-music
npm install
npm run tauri dev
```

## 说明

- 播放依赖各站免费可播音源；会员/下架曲目会提示无法完整播放。
- 搜索记录与收藏仅存本机：`~/Library/Application Support/com.zzy.yinzhan/`（macOS）。
