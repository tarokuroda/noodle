export async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("/api" + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).detail || msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return r.json();
}

// false: show the old Friends preview page (sample data) instead of real sharing
export const REAL_FRIENDS = true;

export const TAGS = ["lecture", "tutorial", "past paper", "assignment", "reading", "other"];

export const tagColor = (tag) => `var(--tag-${(tag || "other").replace(" ", "-")})`;
