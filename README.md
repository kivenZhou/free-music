# 音栈 (YinZhan)

国内优先的桌面音乐客户端（Tauri 2 + React）。

## 功能

- 搜索音乐（可按音源筛选；历史本地 SQLite）
- 收藏（本地）
- 多音源榜单：网易云官方榜 / B站金曲分类 / 酷狗·酷我关键词榜等
- 应用内嵌播放，不跳转外部浏览器
- 可插拔音源 Provider（默认：网易云；另有 B站 / 酷狗 / 酷我；YouTube 按需）
- 队列、随机/循环、音量、系统媒体键、本地音频缓存（2GB 软上限，可手动清除）
- 逐行歌词（网易云接口，其它音源按歌名匹配）
- 迷你置顶窗、队列本地持久化（重启后保留，不自动开播）

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
- 音频缓存：`~/Library/Caches/com.zzy.yinzhan/audio/`（macOS），侧栏可清除。
