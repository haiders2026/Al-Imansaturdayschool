// Shared helpers: API calls, formatting, modals, toasts, WhatsApp links, CSV.

export const state = {
  token: localStorage.getItem("token") || "",
  user: null,
  settings: {},
  classes: [],
  students: [],
};

export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && state.token) {
    logout();
    throw new Error("Please sign in again.");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.blob();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export function setToken(token) {
  state.token = token;
  if (token) localStorage.setItem("token", token); else localStorage.removeItem("token");
}

export function logout() {
  setToken("");
  state.user = null;
  location.hash = "#/";
  location.reload();
}

export async function loadCommon() {
  [state.classes, state.students] = await Promise.all([api("GET", "/classes"), api("GET", "/students")]);
}

export const isAdmin = () => state.user?.role === "admin";
export const isTeacher = () => ["teacher", "assistant"].includes(state.user?.role);
export const isParent = () => state.user?.role === "parent";
export const isStaff = () => isAdmin() || isTeacher();
// Modules this staff member may use (set per person under Staff & Logins).
export const can = (module) => (state.user?.access || []).includes(module);

// ---------- formatting ----------

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// Today if it's Saturday, otherwise the most recent Saturday.
export const lastSaturday = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export const fmtMoney = (n) => {
  const cur = state.settings.currency ?? "$";
  const v = Number(n || 0);
  return (v < 0 ? "-" : "") + cur + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

export const studentName = (s) => (s ? `${s.firstName || ""} ${s.lastName || ""}`.trim() : "Unknown student");
export const className = (id) => state.classes.find((c) => c.id === id)?.name || "No class";
export const studentById = (id) => state.students.find((s) => s.id === id);
export const parentPhone = (s) => s?.fatherPhone || s?.motherPhone || s?.guardianPhone || "";
// Siblings share a family: matched by a parent's phone number, falling back to last name.
export const familyKey = (s) => String(s?.fatherPhone || s?.motherPhone || s?.guardianPhone || "").replace(/\D/g, "") || `name:${(s?.lastName || s?.firstName || "").toLowerCase()}`;
export const parentName = (s) => s?.fatherName || s?.motherName || s?.guardianName || "Parent";

export function letterGrade(percent) {
  if (percent === null || percent === undefined) return "";
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}

export const STATUS_LABEL = { P: "Present", A: "Absent", L: "Late", E: "Excused" };

// ---------- WhatsApp ----------

export function waNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (String(phone).trim().startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  const cc = String(state.settings.countryCode || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (cc && !digits.startsWith(cc)) return cc + digits;
  if (cc === "1" && digits.length === 10) return "1" + digits;
  return digits;
}

export const waChat = (phone, text = "") => {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}` : "";
};
// The "sign in to the app" line in messages to parents. From a teacher it's about their child's
// classwork; from the office it's a general nudge to read school messages.
export const appInviteLine = () => (isTeacher()
  ? `You can now follow your child's attendance, grades, assignments and teacher comments at ${location.origin}`
  : `Please log in to see important messages from the school at ${location.origin}`);

// Opens WhatsApp with a message ready to send; the user picks the group or person.
export const waShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

// ---------- UI ----------

export function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById("toast").appendChild(el);
  setTimeout(() => el.remove(), type === "error" ? 5000 : 2800);
}

export function modal({ title, body, wide = false, onMount }) {
  const root = document.getElementById("modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
    <div class="modal-head no-print"><h2 style="margin:0">${esc(title)}</h2><button aria-label="Close" data-close>&times;</button></div>
    <div class="modal-body">${body}</div></div>`;
  const close = () => { wrap.remove(); document.body.classList.remove("printing-modal"); };
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
  root.appendChild(wrap);
  const el = wrap.querySelector(".modal");
  onMount?.(el, close);
  el.querySelector("input, select, textarea")?.focus();
  return { el, close };
}

export function confirmBox(message, { okText = "Delete", danger = true } = {}) {
  return new Promise((resolve) => {
    const { el, close } = modal({
      title: "Are you sure?",
      body: `<p>${esc(message)}</p><div class="modal-foot"><button class="btn secondary" data-close>Cancel</button><button class="btn ${danger ? "danger" : ""}" data-ok>${esc(okText)}</button></div>`,
    });
    el.querySelector("[data-ok]").onclick = () => { close(); resolve(true); };
    el.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => resolve(false)));
  });
}

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
    else if (el.multiple) out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else out[el.name] = el.value.trim();
  }
  return out;
}

// Wire a form's submit to an async action with button disabling and error toasts.
export function onSubmit(form, action) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    if (btn) btn.disabled = true;
    try { await action(formValues(form)); }
    catch (err) { toast(err.message, "error"); }
    finally { if (btn) btn.disabled = false; }
  });
}

export const classOptions = (selected, { includeAll = false, allLabel = "All classes" } = {}) =>
  (includeAll && state.classes.length > 1 ? `<option value="">${esc(allLabel)}</option>` : "") +
  state.classes.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("");

export function rememberClass(id) { if (id) localStorage.setItem("lastClass", id); }
export function defaultClassId() {
  const saved = localStorage.getItem("lastClass");
  return state.classes.some((c) => c.id === saved) ? saved : state.classes[0]?.id || "";
}

export const emptyState = (text) => `<div class="empty">${esc(text)}</div>`;

// ---------- files ----------

export function download(filename, content, type = "text/csv") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}

export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function downloadAuthed(path, filename) {
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${state.token}` } });
  if (!res.ok) { toast("Couldn't download that file.", "error"); return; }
  download(filename, await res.blob());
}

// Opens a protected file (e.g. a PDF) in a new tab. The tab is opened first so pop-up blockers allow it.
export async function openAuthed(path, filename) {
  const tab = window.open("", "_blank");
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${state.token}` } });
  if (!res.ok) { tab?.close(); toast("Couldn't open that file.", "error"); return; }
  const blob = await res.blob();
  if (!tab || !/pdf|image/.test(blob.type)) { tab?.close(); download(filename, blob); return; }
  tab.location.href = URL.createObjectURL(blob);
}
