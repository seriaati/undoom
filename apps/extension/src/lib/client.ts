import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { Request, Response, View } from "./messages.ts";

export function send<R extends Request>(request: R): Promise<Response<R>> {
  return browser.runtime.sendMessage(request);
}

/** The background's view, refreshed every second so countdowns stay live. */
export function useView(): [View | null, () => void] {
  const [view, setView] = useState<View | null>(null);
  const refresh = () => void send({ type: "view" }).then(setView);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, []);
  return [view, refresh];
}
