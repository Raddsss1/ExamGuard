const $ = (s) => document.querySelector(s);
const show = (sel, on) => $(sel).classList.toggle("hidden", !on);

// ---------- Student / Teacher switch ----------
document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    show("#student-section", btn.dataset.target === "student");
    show("#teacher-section", btn.dataset.target === "teacher");
  })
);

// =====================================================
// STUDENT
// =====================================================
async function renderStudent() {
  const { studentSession: s, lastState } = await chrome.storage.local.get(["studentSession", "lastState"]);
  show("#student-join", !s);
  show("#student-active", !!s);
  if (!s) return;
  $("#st-class").textContent = s.className;
  $("#st-name").textContent = s.name;
  const away = lastState && lastState.status === "away";
  const box = $("#st-status");
  box.className = "status-big " + (away ? "away" : "active");
  box.textContent = away ? "Away from exam tab: " + lastState.detail : "On exam tab";
}

$("#join-btn").addEventListener("click", async () => {
  const err = $("#student-error");
  err.textContent = "";
  const name = $("#student-name").value.trim();
  const code = $("#class-code").value.trim().toUpperCase();
  if (name.length < 2) return (err.textContent = "Enter your full name.");
  if (!code) return (err.textContent = "Enter the class code from your teacher.");
  if (!$("#consent").checked) return (err.textContent = "Please tick the box to confirm you understand.");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("Open your exam page, then try again.");

    const rows = await SB.rpc("join_class", { p_code: code, p_name: name });
    const r = Array.isArray(rows) ? rows[0] : rows;

    await chrome.storage.local.set({
      studentSession: { participantId: r.pid, token: r.ptoken, className: r.cname, name, examTabId: tab.id },
      lastState: { status: "active", detail: "Joined" },
    });
    await chrome.runtime.sendMessage({ type: "JOINED" });
    renderStudent();
  } catch (e) {
    err.textContent = e.message;
  }
});

$("#leave-btn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "LEAVE" });
  renderStudent();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastState || changes.studentSession) renderStudent();
});

// =====================================================
// TEACHER
// =====================================================
async function renderTeacher() {
  const s = await SB.getSession();
  show("#teacher-login", !s);
  show("#teacher-panel", !!s);
  if (!s) return;
  $("#teacher-email").textContent = s.email || "Logged in";
  loadClasses(s);
}

async function authAction(fn) {
  const err = $("#teacher-error");
  err.textContent = "";
  const email = $("#t-email").value.trim();
  const pass = $("#t-pass").value;
  if (!email || pass.length < 6) return (err.textContent = "Enter your email and a password (6+ characters).");
  try {
    await fn(email, pass);
    $("#t-pass").value = "";
    renderTeacher();
  } catch (e) {
    err.textContent = e.message;
  }
}
$("#login-btn").addEventListener("click", () => authAction(SB.signIn));
$("#signup-btn").addEventListener("click", () => authAction(SB.signUp));
$("#logout-btn").addEventListener("click", async () => { await SB.signOut(); renderTeacher(); });

$("#create-btn").addEventListener("click", async () => {
  const err = $("#teacher-error2");
  err.textContent = "";
  const name = $("#class-name").value.trim();
  if (!name) return (err.textContent = "Give the class a name.");
  try {
    const s = await SB.getSession();
    await SB.rpc("create_class", { p_name: name }, s.access_token);
    $("#class-name").value = "";
    loadClasses(s);
  } catch (e) {
    err.textContent = e.message;
  }
});

async function loadClasses(s) {
  const list = $("#class-list");
  list.replaceChildren();
  try {
    const rows = await SB.select(
      "classes", "select=id,name,code&order=created_at.desc&limit=10", s.access_token
    );
    if (!rows.length) {
      list.append(el("p", { class: "muted" }, "No classes yet. Create one above."));
      return;
    }
    rows.forEach((c) => {
      const copyBtn = el("button", {}, "Copy code");
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(c.code);
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy code"), 1500);
      });
      const openBtn = el("button", { class: "primary" }, "Open dashboard");
      openBtn.addEventListener("click", () =>
        chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html?classId=" + c.id) })
      );
      list.append(
        el("div", { class: "class-item" },
          el("div", {}, c.name),
          el("div", { class: "code" }, c.code),
          el("div", { class: "actions" }, copyBtn, openBtn))
      );
    });
  } catch (e) {
    list.append(el("p", { class: "error" }, e.message));
  }
}

renderStudent();
renderTeacher();
