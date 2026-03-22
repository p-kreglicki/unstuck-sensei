import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { toDisplayError } from "../lib/errors";
import {
  loadSessionHistoryPage,
  type SessionHistoryCursor,
  type SessionHistoryItem,
} from "../lib/session-records";
import { HistoryListItem } from "../components/history/HistoryListItem";

export function History() {
  const { user } = useAuth();
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<SessionHistoryCursor | null>(null);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(async (
    cursor: SessionHistoryCursor | null,
    mode: "append" | "replace",
  ) => {
    if (!user?.id) {
      return;
    }

    if (mode === "replace") {
      setIsInitialLoading(true);
      setInitialError(null);
    } else {
      setIsLoadingMore(true);
      setLoadMoreError(null);
    }

    try {
      const page = await loadSessionHistoryPage({
        cursor,
        userId: user.id,
      });

      setItems((current) => {
        if (mode === "replace") {
          return page.items;
        }

        const seen = new Set(current.map((item) => item.id));
        return current.concat(page.items.filter((item) => !seen.has(item.id)));
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      const message = toDisplayError(error, "Unable to load your saved sessions.");

      if (mode === "replace") {
        setInitialError(message);
      } else {
        setLoadMoreError(message);
      }
    } finally {
      if (mode === "replace") {
        setIsInitialLoading(false);
      } else {
        setIsLoadingMore(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setItems([]);
      setNextCursor(null);
      setInitialError(null);
      setLoadMoreError(null);
      setIsInitialLoading(false);
      return;
    }

    void loadPage(null, "replace");
  }, [loadPage, user?.id]);

  useEffect(() => {
    const node = sentinelRef.current;

    if (!node || !nextCursor || isInitialLoading || isLoadingMore) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadPage(nextCursor, "append");
      }
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [isInitialLoading, isLoadingMore, loadPage, nextCursor]);

  return (
    <section className="space-y-5">
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">History</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Past work blocks</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Review the sessions you finished or abandoned without disturbing the live
          session resume flow.
        </p>
      </div>

      {isInitialLoading ? (
        <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300">
          Loading saved sessions…
        </div>
      ) : null}

      {!isInitialLoading && initialError ? (
        <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
          <p>{initialError}</p>
          <button
            className="mt-3 rounded-full border border-white/10 px-4 py-2 text-white transition hover:bg-white/10"
            onClick={() => void loadPage(null, "replace")}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!isInitialLoading && !initialError && items.length === 0 ? (
        <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300">
          No sessions yet. Start your first work block from the Session tab.
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => (
            <HistoryListItem key={item.id} session={item} />
          ))}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">
          {isLoadingMore ? <p>Loading older sessions…</p> : null}
          {!isLoadingMore && loadMoreError ? (
            <>
              <p>{loadMoreError}</p>
              <button
                className="mt-3 rounded-full border border-white/10 px-4 py-2 text-white transition hover:bg-white/10"
                onClick={() => nextCursor && void loadPage(nextCursor, "append")}
                type="button"
              >
                Retry loading more
              </button>
            </>
          ) : null}
          {!isLoadingMore && !loadMoreError && nextCursor ? (
            <div ref={sentinelRef}>Scroll for older sessions.</div>
          ) : null}
          {!isLoadingMore && !loadMoreError && !nextCursor ? (
            <p>You’ve reached the start of your saved sessions.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
