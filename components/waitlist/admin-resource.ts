"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./shared";

function ownerDenied(error: unknown) {
  const status = (error as { status?: number })?.status;
  return status === 401 || status === 403;
}

// Refresh records in place. Abort replaced requests and ignore late responses.
export function useAdminResource<T>(path: string, revision: number, onDenied: () => void, onLoaded?: () => void, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const hasData = useRef(false);
  const callbacks = useRef({ onDenied, onLoaded, enabled });
  callbacks.current = { onDenied, onLoaded, enabled };
  const refresh = useCallback(async () => {
    if (!callbacks.current.enabled || !mounted.current || request.current || document.visibilityState !== "visible") return;
    const controller = new AbortController();
    request.current = controller;
    const current = ++sequence.current;
    const active = () => mounted.current && current === sequence.current && !controller.signal.aborted;
    setFetching(true);
    if (!hasData.current) setLoading(true);
    try {
      const result = await api<T>(path, { signal: controller.signal });
      if (active()) { hasData.current = true; setData(result); setError(""); callbacks.current.onLoaded?.(); }
    } catch (e) {
      if (active()) { if (ownerDenied(e)) callbacks.current.onDenied(); else setError(errorMessage(e)); }
    } finally {
      if (active()) { setFetching(false); setLoading(false); }
      if (request.current === controller) request.current = null;
    }
  }, [path]);
  useEffect(() => {
    mounted.current = true;
    const cancel = () => { sequence.current++; request.current?.abort(); request.current = null; };
    const visibility = () => { if (document.visibilityState !== "visible") { cancel(); setFetching(false); } };
    document.addEventListener("visibilitychange", visibility);
    void refresh();
    return () => { mounted.current = false; cancel(); document.removeEventListener("visibilitychange", visibility); };
  }, [refresh, revision, enabled]);
  return { data, loading, fetching, error, refresh };
}

