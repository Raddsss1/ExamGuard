// Service worker: watches the student's browser and reports whether they stay on the exam tab.
// It reports ONLY "on exam tab / left exam tab". No URLs, titles, screenshots or keystrokes.
importScripts("config.js", "api.js");

const GRACE_MS = 1200;      // ignore very brief focus flickers (e.g. opening this extension's popup)
let timer = null;

async function getSession() {
  const { studentSession } = await chrome.storage.local.get("studentSession");
  return studentSession || null;
}

async function computeState(s) {
  let tab;
  try { tab = await chrome.tabs.get(s.examTabId); }
  catch (_) { return { status: "away", detail: "Exam tab was closed" }; }

  const win = await chrome.windows.getLastFocused();
  if (!win.focused) return { status: "away", detail: "Browser window lost focus" };
  if (win.id !== tab.windowId) return { status: "away", detail: "Switched to another window" };

  const [active] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!active || active.id !== s.examTabId) return { status: "away", detail: "Switched to another tab" };

  return { status: "active", detail: "Returned to the exam tab" };
}

function setBadge(status) {
  if (status === "active") {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#1a7f4b" });
  } else if (status === "away") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c4380b" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

async function evaluate() {
  const s = await getSession();
  if (!s) return;
  const st = await computeState(s);
  setBadge(st.status);
  await chrome.storage.local.set({ lastState: st });
  try {
    await SB.rpc("report_status", {
      p_participant: s.participantId,
      p_token: s.token,
      p_status: st.status,
      p_detail: st.detail,
    });
  } catch (e) {
    console.warn("ExamGuard: could not report status", e.message);
  }
}

function scheduleEvaluate() {
  clearTimeout(timer);
  timer = setTimeout(evaluate, GRACE_MS);
}

// ---- Events that can mean the student left the exam ----
chrome.tabs.onActivated.addListener(scheduleEvaluate);
chrome.tabs.onRemoved.addListener(scheduleEvaluate);
chrome.tabs.onAttached.addListener(scheduleEvaluate);
chrome.tabs.onDetached.addListener(scheduleEvaluate);
chrome.windows.onFocusChanged.addListener(scheduleEvaluate);

// ---- Heartbeat: keeps "last seen" fresh so the teacher can spot a disabled/closed extension ----
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "heartbeat") evaluate(); });

async function resumeIfJoined() {
  const s = await getSession();
  if (s) {
    chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 });
    scheduleEvaluate();
  }
}
chrome.runtime.onStartup.addListener(resumeIfJoined);
chrome.runtime.onInstalled.addListener(resumeIfJoined);

// ---- Messages from the popup ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "JOINED") {
      chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 });
      scheduleEvaluate();
    }
    if (msg.type === "LEAVE") {
      const s = await getSession();
      if (s) {
        try {
          await SB.rpc("report_status", {
            p_participant: s.participantId, p_token: s.token,
            p_status: "left", p_detail: "Left the session",
          });
        } catch (_) {}
      }
      await chrome.storage.local.remove(["studentSession", "lastState"]);
      chrome.alarms.clear("heartbeat");
      setBadge("none");
    }
    sendResponse({ ok: true });
  })();
  return true; // async response
});
