// Tiny Supabase client (REST + Auth) shared by popup, dashboard and background worker.
// No build step or external libraries needed.

const SB = {
  headers(token) {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + (token || SUPABASE_ANON_KEY),
      "Content-Type": "application/json",
    };
  },

  async call(path, { method = "GET", body, token } = {}) {
    const res = await fetch(SUPABASE_URL + path, {
      method,
      headers: SB.headers(token),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      const msg = data && (data.message || data.msg || data.error_description || data.error);
      throw new Error(msg || "Request failed (" + res.status + ")");
    }
    return data;
  },

  rpc(fn, args, token) {
    return SB.call("/rest/v1/rpc/" + fn, { method: "POST", body: args || {}, token });
  },

  select(table, query, token) {
    return SB.call("/rest/v1/" + table + "?" + query, { token });
  },

  // ---------- Teacher auth ----------
  async saveSession(d) {
    const s = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Date.now() + Math.max(d.expires_in - 30, 10) * 1000,
      email: d.user && d.user.email,
    };
    await chrome.storage.local.set({ teacherSession: s });
    return s;
  },

  async signIn(email, password) {
    const d = await SB.call("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email, password },
    });
    return SB.saveSession(d);
  },

  async signUp(email, password) {
    const d = await SB.call("/auth/v1/signup", { method: "POST", body: { email, password } });
    if (!d.access_token) {
      throw new Error("Account created. Confirm your email, then log in.");
    }
    return SB.saveSession(d);
  },

  async getSession() {
    const { teacherSession: s } = await chrome.storage.local.get("teacherSession");
    if (!s) return null;
    if (Date.now() < s.expires_at) return s;
    try {
      const d = await SB.call("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: s.refresh_token },
      });
      return await SB.saveSession(d);
    } catch (_) {
      await chrome.storage.local.remove("teacherSession");
      return null;
    }
  },

  async signOut() {
    await chrome.storage.local.remove("teacherSession");
  },
};

// Small DOM helper (uses textContent, so names typed by students can never inject HTML).
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().forEach((c) => n.append(c));
  return n;
}
