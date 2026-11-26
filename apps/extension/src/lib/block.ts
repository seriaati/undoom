export function blockPageUrl(pageUrl: string, targetId: string, url: string): string {
  return `${pageUrl}?${new URLSearchParams({ target: targetId, url })}`;
}

export function parseBlockPage(search: string): { targetId: string; url: string | null } {
  const params = new URLSearchParams(search);
  const url = params.get("url");
  // Only web pages are offered as a way back, so a crafted link can't point elsewhere.
  return { targetId: params.get("target") ?? "", url: url !== null && /^https?:\/\//.test(url) ? url : null };
}
