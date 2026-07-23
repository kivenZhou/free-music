import { useEffect, useState } from "react";
import { api } from "../api";
import type { SearchHistoryItem } from "../types";

interface Props {
  onSearch: (query: string) => void;
}

export function HistoryView({ onSearch }: Props) {
  const [items, setItems] = useState<SearchHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSearchHistory(50)
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, []);

  async function clearAll() {
    await api.clearSearchHistory();
    setItems([]);
  }

  return (
    <section className="panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">History</p>
          <h1>搜索历史</h1>
          <p>仅存本机 · 最多 50 条</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void clearAll()}>
          清空
        </button>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      {items.length === 0 ? (
        <div className="empty">还没有搜索记录</div>
      ) : (
        <ul className="history-list">
          {items.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onSearch(h.query)}>
                <span>{h.query}</span>
                <small>{new Date(h.searchedAt).toLocaleString()}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
