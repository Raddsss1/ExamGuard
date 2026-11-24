const $ = (s) => document.querySelector(s);
const classId = new URLSearchParams(location.search).get("classId") || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFLINE_AFTER_SECONDS = 75;   // heartbeat is every 30s
const POLL_MS = 3000;

let selected = null;   // {id, name}
let busy = false;

function banner(msg) {
  const b = $("#banner");
  b.textContent = msg || "";
  b.classList.toggle("hidden", !msg);
}

function statusOf(p) {
  if (p.status === "left") return { text: "Left", cls: "left" };
  if (p.seconds_since_seen > OFFLINE_AFTER_SECONDS) return { text: "Offline", cls: "offline" };
  if (p.status === "away") return { text: "Changing tabs", cls: "away" };
  return { text: "Active", cls: "active" };
}

function fmtJoined(iso) {
  const d = new Date(iso);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return t + "  (" + (mins < 1 ? "just now" : mins + " min ago") + ")";
}

function render(rows) {
  let active = 0, away = 0, off = 0;
  const tbody = $("#rows");
  tbody.replaceChildren();

  rows.forEach((p) => {
    const st = statusOf(p);
    if (st.cls === "active") active++;
    else if (st.cls === "away") away++;
    else off++;

    const tr = el("tr", { class: (st.cls === "away" ? "is-away " : "") + (selected && selected.id === p.id ? "sel" : "") },
      el("td", {}, p.name),
      el("td", {}, el("span", { class: "pill " + st.cls }, st.text)),
      el("td", {}, fmtJoined(p.joined_at)),
      el("td", { class: "hide-sm" }, String(p.away_count)),
      el("td", { class: "hide-sm" }, p.last_event || "—")
    );
    tr.addEventListener("click", () => { selected = { id: p.id, name: p.name }; loadLog(); render(rows); });
    tbody.append(tr);
  });

  $("#n-joined").textContent = rows.length;
  $("#n-active").textContent = active;
  $("#n-away").textContent = away;
  $("#n-off").textContent = off;
  $("#empty").classList.toggle("hidden", rows.length > 0);
  $("#roster").classList.toggle("hidden", rows.length === 0);
}

async function loadLog() {
  if (!selected) return;
  const s = await SB.getSession();
  const logs = await SB.rpc("participant_log", { p_participant: selected.id }, s.access_token);
  $("#log-title").textContent = "Recent activity: " + selected.name;
  const ul = $("#log-list");
  ul.replaceChildren();
  if (!logs.length) ul.append(el("li", { class: "muted" }, "No status changes yet."));
  logs.forEach((l) =>
    ul.append(el("li", {}, new Date(l.created_at).toLocaleTimeString() + " - " + (l.detail || l.status)))
  );
  $("#log").classList.remove("hidden");
}

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const s = await SB.getSession();
    if (!s) { banner("You are logged out. Log in from the extension popup, then reopen this dashboard."); return; }
    const rows = await SB.rpc("class_roster", { p_class_id: classId }, s.access_token);
    banner("");
    render(rows);
    if (selected) loadLog();
    $("#updated").textContent = "Live: updated " + new Date().toLocaleTimeString();
  } catch (e) {
    banner("Connection problem: " + e.message);
  } finally {
    busy = false;
  }
}

async function init() {
  if (!UUID.test(classId)) { $("#class-title").textContent = "Class not found"; return; }
  const s = await SB.getSession();
  if (!s) { $("#class-title").textContent = "Please log in"; banner("Log in from the extension popup (Teacher tab), then open the dashboard again."); return; }
  try {
    const rows = await SB.select("classes", "id=eq." + classId + "&select=name,code", s.access_token);
    if (!rows.length) { $("#class-title").textContent = "Class not found"; return; }
    $("#class-title").textContent = rows[0].name;
    $("#class-code").textContent = rows[0].code;
    document.title = rows[0].name + " - ExamGuard";
  } catch (e) { banner(e.message); }
  refresh();
  setInterval(refresh, POLL_MS);
}
init();
