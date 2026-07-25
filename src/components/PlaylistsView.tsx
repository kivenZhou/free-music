import { useCallback, useEffect, useState } from "react";
import { ListMusic, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import type { Playlist, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  playing?: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onTogglePlay?: () => void;
  onPlayAll: (tracks: Track[]) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  refreshToken?: number;
  active?: boolean;
}

export function PlaylistsView({
  favoriteKeys,
  currentKey,
  playing,
  onPlay,
  onTogglePlay,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  onAddToPlaylist,
  refreshToken = 0,
  active = true,
}: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  /** Inline rename — window.prompt is unavailable in Tauri WebView. */
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  /** Two-step delete confirm — window.confirm also unavailable. */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refreshPlaylists = useCallback(async () => {
    const list = await api.listPlaylists();
    setPlaylists(list);
    return list;
  }, []);

  const loadTracks = useCallback(async (id: number) => {
    const items = await api.listPlaylistTracks(id);
    setTracks(items.map((i) => i.track));
  }, []);

  useEffect(() => {
    if (!active) return;
    setError(null);
    void refreshPlaylists()
      .then((list) => {
        setActiveId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch((e) => setError(String(e)));
  }, [active, refreshToken, refreshPlaylists]);

  useEffect(() => {
    if (!activeId) {
      setTracks([]);
      return;
    }
    setRenaming(false);
    setConfirmDelete(false);
    void loadTracks(activeId).catch((e) => setError(String(e)));
  }, [activeId, loadTracks, refreshToken]);

  const activePlaylist = playlists.find((p) => p.id === activeId) ?? null;

  async function createPlaylist() {
    const name = newName.trim() || "未命名歌单";
    try {
      const created = await api.createPlaylist(name);
      setNewName("");
      setCreating(false);
      const list = await refreshPlaylists();
      setActiveId(created.id);
      if (!list.some((p) => p.id === created.id)) {
        setPlaylists((prev) => [created, ...prev]);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  function startRename() {
    if (!activePlaylist) return;
    setConfirmDelete(false);
    setRenameValue(activePlaylist.name);
    setRenaming(true);
  }

  async function submitRename() {
    if (!activePlaylist) return;
    const name = renameValue.trim();
    if (!name || name === activePlaylist.name) {
      setRenaming(false);
      return;
    }
    try {
      await api.renamePlaylist(activePlaylist.id, name);
      setRenaming(false);
      await refreshPlaylists();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteActive() {
    if (!activePlaylist) return;
    if (!confirmDelete) {
      setRenaming(false);
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deletePlaylist(activePlaylist.id);
      setConfirmDelete(false);
      const list = await refreshPlaylists();
      setActiveId(list[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeTrack(track: Track) {
    if (!activeId) return;
    try {
      await api.removeFromPlaylist(activeId, track.provider, track.id);
      await loadTracks(activeId);
      await refreshPlaylists();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="panel playlists-panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Playlists</p>
          <h1>歌单</h1>
          <p>本地多歌单 · 与收藏相互独立</p>
        </div>
        {tracks.length > 0 ? (
          <button
            type="button"
            className="play-all-btn"
            onClick={() => onPlayAll(tracks)}
          >
            <Play size={14} fill="currentColor" />
            全部播放
          </button>
        ) : null}
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="playlists-layout">
        <aside className="playlist-rail">
          <div className="playlist-rail-head">
            <span>我的歌单</span>
            <button
              type="button"
              className="icon-btn"
              title="新建歌单"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
            </button>
          </div>

          {creating ? (
            <form
              className="playlist-create"
              onSubmit={(e) => {
                e.preventDefault();
                void createPlaylist();
              }}
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="歌单名称"
              />
              <button type="submit" className="ghost-btn">
                创建
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                取消
              </button>
            </form>
          ) : null}

          {playlists.length === 0 ? (
            <div className="playlist-rail-empty">还没有歌单，点 + 新建</div>
          ) : (
            <ul className="playlist-rail-list">
              {playlists.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`playlist-rail-item ${p.id === activeId ? "on" : ""}`}
                    onClick={() => setActiveId(p.id)}
                  >
                    <ListMusic size={15} />
                    <span className="playlist-rail-name">{p.name}</span>
                    <span className="playlist-rail-count">{p.trackCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="playlist-main">
          {activePlaylist ? (
            <>
              <div className="playlist-main-head">
                <div className="playlist-main-title">
                  {renaming ? (
                    <form
                      className="playlist-create playlist-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submitRename();
                      }}
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setRenaming(false);
                        }}
                        placeholder="歌单名称"
                        aria-label="歌单名称"
                      />
                      <button type="submit" className="ghost-btn">
                        保存
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setRenaming(false)}
                      >
                        取消
                      </button>
                    </form>
                  ) : (
                    <>
                      <h2>{activePlaylist.name}</h2>
                      <p>{tracks.length} 首</p>
                    </>
                  )}
                  {confirmDelete ? (
                    <p className="playlist-delete-hint">
                      确认删除「{activePlaylist.name}」？此操作不可恢复。
                    </p>
                  ) : null}
                </div>
                <div className="playlist-main-actions">
                  {!renaming ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={startRename}
                    >
                      <Pencil size={14} />
                      重命名
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-btn danger"
                    onClick={() => void deleteActive()}
                  >
                    <Trash2 size={14} />
                    {confirmDelete ? "确认删除" : "删除"}
                  </button>
                  {confirmDelete ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="playlist-main-scroll">
                <SongList
                  tracks={tracks}
                  currentKey={currentKey}
                  playing={playing}
                  favoriteKeys={favoriteKeys}
                  onPlay={onPlay}
                  onTogglePlay={onTogglePlay}
                  onPlayNext={onPlayNext}
                  onAddToQueue={onAddToQueue}
                  onToggleFavorite={onToggleFavorite}
                  onAddToPlaylist={onAddToPlaylist}
                  onRemoveTrack={(t) => void removeTrack(t)}
                />
              </div>
            </>
          ) : (
            <div className="empty">
              <strong>选择或新建一个歌单</strong>
              <span>可在曲目列表里把歌加进歌单</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
