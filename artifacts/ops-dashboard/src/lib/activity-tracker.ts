import { useEffect } from "react";

let currentSessionId: number | null = null;

async function send(path: string, body: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch(`/api/auth/activity/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    return null;
  }
}

export async function trackActivityAction(name: string): Promise<void> {
  if (currentSessionId === null) return;
  await send("event", { sessionId: currentSessionId, kind: "action", name, route: window.location.pathname });
}

export function ActivityTracker({ app = "ops-dashboard" }: { app?: "ops-dashboard" }) {
  useEffect(() => {
    let disposed = false;
    let sessionId: number | null = null;
    let lastInteraction = Date.now();
    let lastRoute = window.location.pathname;
    const markInteraction = () => { lastInteraction = Date.now(); };
    const emitPage = () => {
      const route = window.location.pathname;
      if (route === lastRoute && sessionId !== null) return;
      lastRoute = route;
      if (sessionId !== null) void send("event", { sessionId, kind: "page", name: "page_view", route });
    };
    const start = async () => {
      const response = await send("session", { app, route: lastRoute });
      if (!response?.ok || disposed) return;
      const body = await response.json() as { sessionId?: number };
      if (!body.sessionId) return;
      sessionId = body.sessionId;
      currentSessionId = sessionId;
      await send("event", { sessionId, kind: "action", name: "signed_in", route: lastRoute });
      await send("event", { sessionId, kind: "page", name: "page_view", route: lastRoute });
    };
    const heartbeat = () => {
      if (sessionId === null) return;
      const visible = document.visibilityState === "visible";
      void send("heartbeat", {
        sessionId,
        route: window.location.pathname,
        visible,
        active: visible && Date.now() - lastInteraction < 120_000,
      });
      emitPage();
    };
    const interval = window.setInterval(heartbeat, 30_000);
    const routeInterval = window.setInterval(emitPage, 1_000);
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach((event) =>
      window.addEventListener(event, markInteraction, { passive: true }),
    );
    document.addEventListener("visibilitychange", markInteraction);
    void start();
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearInterval(routeInterval);
      ["pointerdown", "keydown", "scroll", "touchstart"].forEach((event) =>
        window.removeEventListener(event, markInteraction),
      );
      document.removeEventListener("visibilitychange", markInteraction);
      if (sessionId !== null) {
        void send("event", { sessionId, kind: "action", name: "signed_out", route: window.location.pathname });
        void send("end", {
          sessionId,
          route: window.location.pathname,
          visible: document.visibilityState === "visible",
          active: Date.now() - lastInteraction < 120_000,
        });
      }
      if (currentSessionId === sessionId) currentSessionId = null;
    };
  }, [app]);
  return null;
}