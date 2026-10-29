import { state, api, setToken, logout, loadCommon, esc, toast, onSubmit, can } from "./js/core.js";

const NAV = [
  { path: "dashboard", label: "Dashboard", ico: "🏠", roles: ["admin", "teacher", "assistant", "parent"] },
  { path: "calendar", label: "Calendar", ico: "📅", roles: ["admin", "teacher", "assistant", "parent"] },
  { path: "messages", module: "messages", label: "Messages", ico: "✉️", roles: ["admin", "teacher", "assistant", "parent"] },
  { path: "attendance", module: "attendance", label: "Attendance", ico: "✅", roles: ["admin", "teacher", "assistant"] },
  { path: "grades", module: "grades", label: "Tests & Grades", ico: "📝", roles: ["admin", "teacher", "assistant"] },
  { path: "assignments", module: "assignments", label: "Assignments", ico: "📚", roles: ["admin", "teacher", "assistant", "parent"] },
  { path: "lessonplans", module: "lessonplans", label: "Lesson Plans", ico: "🗂️", roles: ["admin", "teacher", "assistant"] },
  { path: "students", module: "students", label: "Students", ico: "👧", roles: ["admin", "teacher", "assistant"] },
  { path: "classes", module: "classes", label: "Grades & WhatsApp", parentLabel: "WhatsApp groups", teacherLabel: "My class & WhatsApp", ico: "💬", roles: ["admin", "teacher", "assistant", "parent"] },
  { path: "documents", module: "documents", label: "Documents", ico: "📄", roles: ["admin", "teacher", "assistant", "parent"] },
  { path: "mynotes", module: "mynotes", label: "My Notes", ico: "📒", roles: ["admin", "teacher", "assistant"] },
  { path: "notes", module: "notes", label: "Teacher Notes", ico: "🗒️", roles: ["admin", "teacher", "assistant"] },
  { path: "registrations", module: "registrations", label: "Registrations", ico: "✍️", roles: ["admin"] },
  { path: "payments", module: "payments", label: "Payments", ico: "💳", roles: ["admin"] },
  { path: "reports", module: "reports", label: "Reports", ico: "📊", roles: ["admin", "teacher", "assistant"] },
  { path: "users", module: "users", label: "Staff & Logins", ico: "👥", roles: ["admin"] },
  { path: "settings", module: "settings", label: "Settings & Import", ico: "⚙️", roles: ["admin"] },
];

// Parents aren't limited by modules; staff see only the modules the admin gave them.
const allowed = (n, role) => n.roles.includes(role) && (role === "parent" || !n.module || can(n.module));

const PAGES = {
  dashboard: () => import("./js/pages/dashboard.js"),
  calendar: () => import("./js/pages/calendar.js"),
  registrations: () => import("./js/pages/registrations.js"),
  documents: () => import("./js/pages/documents.js"),
  messages: () => import("./js/pages/messages.js"),
  mynotes: () => import("./js/pages/mynotes.js"),
  attendance: () => import("./js/pages/attendance.js"),
  grades: () => import("./js/pages/grades.js"),
  assignments: () => import("./js/pages/assignments.js"),
  students: () => import("./js/pages/students.js"),
  student: () => import("./js/pages/student.js"),
  classes: () => import("./js/pages/classes.js"),
  lessonplans: () => import("./js/pages/lessonplans.js"),
  notes: () => import("./js/pages/notes.js"),
  payments: () => import("./js/pages/payments.js"),
  reports: () => import("./js/pages/reports.js"),
  users: () => import("./js/pages/users.js"),
  settings: () => import("./js/pages/settings.js"),
  account: () => import("./js/pages/account.js"),
};

const app = document.getElementById("app");

async function boot() {
  // The registration form is public: families open /register without signing in.
  if (location.pathname.replace(/\/$/, "") === "/register" || /^#\/register\/?$/.test(location.hash)) {
    try {
      const { renderPublic } = await import("./js/pages/register.js");
      await renderPublic(app);
    } catch (err) {
      app.innerHTML = `<div class="center-screen"><div class="auth-card"><h2>Can't load the form</h2><p class="muted">${esc(err.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
    }
    return;
  }
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
  return `<div class="brand"><img src="/logo.png" alt="Al-Iman logo"><div>${esc(state.settings.schoolName || "Al-Iman Saturday School")}<small>School manager</small></div></div>`;
}

function renderLogin() {
  app.innerHTML = `<div class="center-screen auth-bg"><form class="auth-card" id="login">
    ${brand()}
    <h2>Sign in</h2>
    <div class="field"><label for="u">Username, email or phone</label><input id="u" name="username" autocomplete="username" required></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn" style="width:100%" type="submit">Sign in</button>
    <p class="muted small">Parents: use the phone number and password the school sent you. Forgot it? Ask the school office to reset it.</p>
    <p class="small"><a href="/register"><strong>New or returning family? Register here</strong></a></p>
    <p class="small"><a href="#" id="recover">Admin locked out?</a></p>
  </form></div>`;
  document.getElementById("recover").onclick = (e) => { e.preventDefault(); renderRecover(); };
  onSubmit(document.getElementById("login"), async (v) => {
    const res = await api("POST", "/auth/login", v);
    setToken(res.token);
    location.hash = "";
    location.reload();
  });
}

function renderRecover() {
  app.innerHTML = `<div class="center-screen auth-bg"><form class="auth-card" id="rec">
    ${brand()}
    <h2>Reset the admin login</h2>
    <ol class="small muted" style="padding-left:18px">
      <li>In Netlify, open the site → <strong>Site configuration → Environment variables</strong>.</li>
      <li>Add <code>ADMIN_RECOVERY_CODE</code> with a secret of 12+ characters only you know.</li>
      <li>Go to <strong>Deploys → Trigger deploy</strong>, wait a minute, then fill this in.</li>
    </ol>
    <div class="field"><label>Recovery code</label><input name="code" type="password" required></div>
    <div class="field"><label>Admin username (existing, or a new one to create)</label><input name="username" autocapitalize="none" required></div>
    <div class="field"><label>New password (8+ characters)</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="btn" style="width:100%" type="submit">Reset and sign in</button>
    <p class="small"><a href="/">Back to sign in</a></p>
  </form></div>`;
  onSubmit(document.getElementById("rec"), async (v) => {
    const res = await api("POST", "/auth/recover", v);
    setToken(res.token);
    toast(`Signed in. Admin usernames: ${res.admins.join(", ")}`);
    setTimeout(() => { location.hash = ""; location.reload(); }, 1500);
  });
}

function renderSetup() {
  app.innerHTML = `<div class="center-screen auth-bg"><form class="auth-card" id="setup">
    ${brand()}
    <h2>Welcome! Let's set up</h2>
    <p class="muted small">Create the first administrator account. You can add teachers and parents after this.</p>
    <div class="field"><label>School name</label><input name="schoolName" value="Al-Iman Saturday School" required></div>
    <div class="field"><label>Your name</label><input name="name" required></div>
    <div class="field"><label>Username (you'll type this to sign in)</label><input name="username" autocomplete="username" autocapitalize="none" required></div>
    <div class="field"><label>Email (you can also sign in with this)</label><input name="email" type="email" autocomplete="email"></div>
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
  const teaching = role === "teacher" || role === "assistant";
  const roleLabel = { admin: "Administrator", teacher: "Teacher", assistant: "Assistant teacher", parent: "Parent" }[role];
  app.innerHTML = `<div class="shell" id="shell">
    <aside class="sidebar">
      ${brand()}
      <nav class="nav">${NAV.filter((n) => allowed(n, role)).map((n) =>
        `<a href="#/${n.path}" data-path="${n.path}"><span class="ico">${n.ico}</span>${(role === "parent" && n.parentLabel) || (teaching && n.teacherLabel) || n.label}</a>`).join("")}</nav>
      <div class="who">${esc(state.user.name)}<br><span style="opacity:.7">${roleLabel}</span><br>
        ${teaching ? `<span style="opacity:.9">${state.classes.length ? `Your class: <strong>${esc(state.classes.map((c) => c.name).join(", "))}</strong>` : "No class assigned yet"}</span><br>` : ""}
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
  if (!location.hash.replace(/^#\/?/, "") && ["teacher", "assistant"].includes(state.user.role) && state.classes.length && can("attendance")) {
    location.replace("#/attendance");
    return;
  }
  const [name = "dashboard", ...params] = location.hash.replace(/^#\/?/, "").split("/");
  const page = document.getElementById("page");
  const navItem = NAV.find((n) => n.path === name);
  if ((navItem && !allowed(navItem, state.user.role)) || !PAGES[name]) {
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
