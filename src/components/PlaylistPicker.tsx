import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import type { Playlist, Track } from "../types";

interface Props {
  track: Track | null;
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

export function PlaylistPicker({ track, open, onClose, onAdded }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setToast(null);
    setCreating(false);
    setNewName("");
    api
      .listPlaylists()
      .then(setPlaylists)
      .catch((e) => setError(String(e)));
  }, [open]);

  if (!open || !track) return null;

  async function addTo(id: number, name: string) {
    if (!track) return;
    setBusyId(id);
    setError(null);
    try {
      await api.addToPlaylist(id, track);
      setToast(`已加入「${name}」`);
      onAdded?.();
      window.setTimeout(onClose, 700);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function createAndAdd() {
    if (!track) return;
    const name = newName.trim() || "未命名歌单";
    setBusyId(-1);
    try {
      const created = await api.createPlaylist(name);
      await api.addToPlaylist(created.id, track);
      setToast(`已加入「${created.name}」`);
      onAdded?.();
      window.setTimeout(onClose, 700);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="playlist-picker-backdrop" onClick={onClose}>
      <div
        className="playlist-picker"
        role="dialog"
        aria-label="加入歌单"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="playlist-picker-head">
          <div>
            <strong>加入歌单</strong>
            <p>
              {track.title} · {track.artist}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {toast ? <div className="settings-toast">{toast}</div> : null}

        <ul className="playlist-picker-list">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void addTo(p.id, p.name)}
              >
                <span>{p.name}</span>
                <small>{busyId === p.id ? "添加中…" : `${p.trackCount} 首`}</small>
              </button>
            </li>
          ))}
        </ul>

        {playlists.length === 0 && !creating ? (
          <div className="playlist-picker-empty">还没有歌单</div>
        ) : null}

        {creating ? (
          <form
            className="playlist-create"
            onSubmit={(e) => {
              e.preventDefault();
              void createAndAdd();
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新歌单名称"
            />
            <button type="submit" className="ghost-btn" disabled={busyId !== null}>
              创建并加入
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="ghost-btn playlist-picker-new"
            onClick={() => setCreating(true)}
          >
            <Plus size={14} />
            新建歌单
          </button>
        )}
      </div>
    </div>
  );
}
