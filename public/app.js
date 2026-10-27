import { state, api, setToken, logout, loadCommon, esc, toast, onSubmit } from "./js/core.js";

const NAV = [
  { path: "dashboard", label: "Dashboard", ico: "🏠", roles: ["admin", "teacher", "parent"] },
  { path: "attendance", label: "Attendance", ico: "✅", roles: ["admin", "teacher"] },
  { path: "grades", label: "Tests & Grades", ico: "📝", roles: ["admin", "teacher"] },
  { path: "assignments", label: "Assignments", ico: "📚", roles: ["admin", "teacher", "parent"] },
  { path: "students", label: "Students", ico: "👧", roles: ["admin", "teacher"] },
  { path: "classes", label: "Grades & WhatsApp", parentLabel: "WhatsApp groups", ico: "💬", roles: ["admin", "teacher", "parent"] },
  { path: "notes", label: "Teacher Notes", ico: "🗒️", roles: ["admin", "teacher"] },
  { path: "payments", label: "Payments", ico: "💳", roles: ["admin"] },
  { path: "reports", label: "Reports", ico: "📊", roles: ["admin", "teacher"] },
  { path: "users", label: "Staff & Logins", ico: "👥", roles: ["admin"] },
  { path: "settings", label: "Settings & Import", ico: "⚙️", roles: ["admin"] },
];

const PAGES = {
  dashboard: () => import("./js/pages/dashboard.js"),
  attendance: () => import("./js/pages/attendance.js"),
  grades: () => import("./js/pages/grades.js"),
  assignments: () => import("./js/pages/assignments.js"),
  students: () => import("./js/pages/students.js"),
  student: () => import("./js/pages/student.js"),
  classes: () => import("./js/pages/classes.js"),
  notes: () => import("./js/pages/notes.js"),
  payments: () => import("./js/pages/payments.js"),
  reports: () => import("./js/pages/reports.js"),
  users: () => import("./js/pages/users.js"),
  settings: () => import("./js/pages/settings.js"),
  account: () => import("./js/pages/account.js"),
};

const app = document.getElementById("app");

async function boot() {
  try {
    if (state.token) {
      const me = await api("GET", "/auth/me");
      state.user = me.user;
      state.settings = me.settings;
      await loadCommon();
      renderShell();
      window.addEventListener("hashchange", route);
      route();
      return;
    }
    const setup = await api("GET", "/setup");
    state.settings.schoolName = setup.schoolName;
    setup.needsSetup ? renderSetup() : renderLogin();
  } catch (err) {
    if (state.token) { setToken(""); return boot(); }
    app.innerHTML = `<div class="center-screen"><div class="auth-card"><h2>Can't reach the server</h2><p class="muted">${esc(err.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
}

function brand() {
  return `<div class="brand"><img src="/icon.svg" alt=""><div>${esc(state.settings.schoolName || "Al-Iman Saturday School")}<small>School manager</small></div></div>`;
}

function renderLogin() {
  app.innerHTML = `<div class="center-screen auth-bg"><form class="auth-card" id="login">
    ${brand()}
    <h2>Sign in</h2>
    <div class="field"><label for="u">Username or phone</label><input id="u" name="username" autocomplete="username" required></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn" style="width:100%" type="submit">Sign in</button>
    <p class="muted small">Parents: use the phone number and password the school sent you. Forgot it? Ask the school office to reset it.</p>
  </form></div>`;
  onSubmit(document.getElementById("login"), async (v) => {
    const res = await api("POST", "/auth/login", v);
    setToken(res.token);
    location.hash = "#/dashboard";
    location.reload();
  });
}

function renderSetup() {
  app.innerHTML = `<div class="center-screen auth-bg"><form class="auth-card" id="setup">
    ${brand()}
    <h2>Welcome! Let's set up</h2>
    <p class="muted small">Create the first administrator account. You can add teachers and parents after this.</p>
    <div class="field"><label>School name</label><input name="schoolName" value="Al-Iman Saturday School" required></div>
    <div class="field"><label>Your name</label><input name="name" required></div>
    <div class="field"><label>Username</label><input name="username" autocomplete="username" required></div>
    <div class="field"><label>Password (8+ characters)</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="btn" style="width:100%" type="submit">Create admin account</button>
  </form></div>`;
  onSubmit(document.getElementById("setup"), async (v) => {
    const res = await api("POST", "/setup", v);
    setToken(res.token);
    location.hash = "#/settings/import";
    location.reload();
  });
}

function renderShell() {
  const role = state.user.role;
  const roleLabel = { admin: "Administrator", teacher: "Teacher", parent: "Parent" }[role];
  app.innerHTML = `<div class="shell" id="shell">
    <aside class="sidebar">
      ${brand()}
      <nav class="nav">${NAV.filter((n) => n.roles.includes(role)).map((n) =>
        `<a href="#/${n.path}" data-path="${n.path}"><span class="ico">${n.ico}</span>${(role === "parent" && n.parentLabel) || n.label}</a>`).join("")}</nav>
      <div class="who">${esc(state.user.name)}<br><span style="opacity:.7">${roleLabel}</span><br>
        <a href="#/account">My account</a> · <a href="#" id="logout">Sign out</a></div>
    </aside>
    <div>
      <div class="topbar"><button id="menu" aria-label="Menu">☰</button><strong>${esc(state.settings.schoolName)}</strong></div>
      <main class="main" id="page"></main>
    </div>
  </div>`;
  document.getElementById("logout").onclick = (e) => { e.preventDefault(); logout(); };
  document.getElementById("menu").onclick = () => document.getElementById("shell").classList.toggle("menu-open");
  document.querySelector(".sidebar").addEventListener("click", (e) => {
    if (e.target.closest("a")) document.getElementById("shell").classList.remove("menu-open");
  });
}

async function route() {
  const [name = "dashboard", ...params] = location.hash.replace(/^#\/?/, "").split("/");
  const page = document.getElementById("page");
  const navItem = NAV.find((n) => n.path === name);
  if ((navItem && !navItem.roles.includes(state.user.role)) || !PAGES[name]) {
    location.hash = "#/dashboard";
    return;
  }
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.path === (name === "student" ? "students" : name)));
  page.innerHTML = `<div class="center-screen" style="min-height:40vh"><div class="spinner"></div></div>`;
  try {
    const mod = await PAGES[name]();
    await mod.render(page, params.map(decodeURIComponent));
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    page.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p></div>`;
    toast(err.message, "error");
  }
}

// Re-render the current page (used after saving data).
window.refreshPage = route;

boot();
