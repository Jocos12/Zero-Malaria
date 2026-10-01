import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LiveWireEvent } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import {
  buildEventsUrl,
  nextBackoffMs,
  shouldFallBackToPollOnly,
} from './sseReconnect';

export const LIVE_EVENT_BUS = 'zm-live-event';

export type LiveEvent = LiveWireEvent;

type EventContextValue = {
  lastEvent: LiveEvent | null;
  unreadCount: number;
  clearUnread: () => void;
  subscribe: (fn: (ev: LiveEvent) => void) => () => void;
};

const EventCtx = createContext<EventContextValue | null>(null);

function dispatchBus(ev: LiveEvent) {
  window.dispatchEvent(new CustomEvent(LIVE_EVENT_BUS, { detail: ev }));
}

export function EventProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const { offlineSim } = useTheme();
  const { push } = useToast();
  const { t } = useTranslation();
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const sinceRef = useRef<string>(new Date(Date.now() - 5000).toISOString());
  const listenersRef = useRef(new Set<(ev: LiveEvent) => void>());

  const subscribe = useCallback((fn: (ev: LiveEvent) => void) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  const handleEvent = useCallback(
    (ev: LiveEvent) => {
      if (ev.type === 'heartbeat') return;
      setLastEvent(ev);
      setUnreadCount((n) => n + 1);
      dispatchBus(ev);
      listenersRef.current.forEach((fn) => fn(ev));
      if (ev.type === 'referral.created') {
        push(t('events.newReferral'), ev.payload?.decision === 'urgent_refer' ? 'warning' : 'info');
      } else if (ev.type === 'referral.status_changed') {
        push(t('events.statusChanged', { status: String(ev.payload?.new_status || '') }), 'success');
      } else if (ev.type === 'referral.message') {
        push(t('events.newMessage'), 'info');
      }
    },
    [push, t],
  );

  useEffect(() => {
    if (!user || !token || offlineSim) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let pollId = 0;
    let reconnectTimer = 0;
    let attempt = 0;
    let pollOnly = false;

    const tick = async () => {
      try {
        const data = await api.pollEvents(sinceRef.current);
        if (cancelled) return;
        for (const ev of data.events) {
          handleEvent(ev);
          if (ev.at && ev.at > sinceRef.current) sinceRef.current = ev.at;
        }
        if (data.server_at && data.server_at > sinceRef.current) {
          sinceRef.current = data.server_at;
        }
      } catch {
        /* offline / auth — silent */
      }
    };

    const startPoll = (intervalMs: number) => {
      if (pollId) window.clearInterval(pollId);
      void tick();
      pollId = window.setInterval(() => void tick(), intervalMs);
    };

    const closeEs = () => {
      if (es) {
        es.onerror = null;
        es.onmessage = null;
        es.close();
        es = null;
      }
    };

    const connectSse = async () => {
      if (cancelled || pollOnly) return;
      closeEs();
      try {
        const { ticket } = await api.createEventTicket();
        if (cancelled) return;
        const base = import.meta.env.VITE_API_BASE || '/api';
        const url = buildEventsUrl(base, ticket, sinceRef.current);
        es = new EventSource(url);
        es.onmessage = (msg) => {
          try {
            const ev = JSON.parse(msg.data) as LiveEvent;
            handleEvent(ev);
            if (ev.at && ev.at > sinceRef.current) sinceRef.current = ev.at;
            attempt = 0;
          } catch {
            /* ignore malformed */
          }
        };
        es.onerror = () => {
          // Expected on API reload (ECONNRESET). No console.error — reconnect or poll.
          closeEs();
          if (cancelled) return;
          attempt += 1;
          if (shouldFallBackToPollOnly(attempt)) {
            pollOnly = true;
            startPoll(4000);
            return;
          }
          startPoll(8000);
          const delay = nextBackoffMs(attempt - 1);
          reconnectTimer = window.setTimeout(() => {
            if (!cancelled && !pollOnly) void connectSse();
          }, delay);
        };
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        // Old API / missing route: stop retry storm, use poll only
        if (status === 404 || status === 501) {
          pollOnly = true;
          startPoll(4000);
          return;
        }
        attempt += 1;
        if (shouldFallBackToPollOnly(attempt)) {
          pollOnly = true;
          startPoll(4000);
          return;
        }
        startPoll(8000);
        const delay = nextBackoffMs(attempt - 1);
        reconnectTimer = window.setTimeout(() => {
          if (!cancelled && !pollOnly) void connectSse();
        }, delay);
      }
    };

    void connectSse();
    // Slow safety-net poll while SSE is healthy
    startPoll(15000);

    return () => {
      cancelled = true;
      closeEs();
      if (pollId) window.clearInterval(pollId);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [user, token, offlineSim, handleEvent]);

  const value = useMemo(
    () => ({ lastEvent, unreadCount, clearUnread, subscribe }),
    [lastEvent, unreadCount, clearUnread, subscribe],
  );

  return <EventCtx.Provider value={value}>{children}</EventCtx.Provider>;
}

export function useLiveEvents() {
  const ctx = useContext(EventCtx);
  if (!ctx) throw new Error('useLiveEvents outside EventProvider');
  return ctx;
}

export function useLiveEventRefresh(onRefresh: () => void, types?: string[]) {
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = (e as CustomEvent<LiveEvent>).detail;
      if (types && !types.includes(ev.type)) return;
      onRefresh();
    };
    window.addEventListener(LIVE_EVENT_BUS, handler);
    return () => window.removeEventListener(LIVE_EVENT_BUS, handler);
  }, [onRefresh, types]);
}
