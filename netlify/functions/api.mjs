// All server endpoints live here, under /api/*.
import { db, all, saveAll, findById, upsert, remove, newId } from "./lib/store.mjs";
import { hashPassword, checkPassword, signToken, verifyToken, randomPassword } from "./lib/auth.mjs";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const STATUSES = ["P", "A", "L", "E"]; // present, absent, late, excused

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

const DEFAULT_SETTINGS = {
  schoolName: "Al-Iman Saturday School",
  academicYear: "2026-2027",
  currency: "$",
  defaultFee: 0,
  passMark: 60,
  contactPhone: "",
  countryCode: "1",
};

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await (await db()).getJSON("settings")) || {}) };
}

// ---------- helpers ----------

const publicUser = ({ passHash, tokenVersion, ...u }) => u;
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const STUDENT_FIELDS = [
  "firstName", "lastName", "classId", "gender", "dob", "studentCode", "active", "enrolledOn",
  "fatherName", "fatherPhone", "fatherEmail", "motherName", "motherPhone", "motherEmail",
  "guardianName", "guardianPhone", "address", "emergencyContact", "emergencyPhone",
  "medical", "allergies", "photoConsent", "pickupAuthorized", "adminNote", "fee",
];
const FEE_FIELDS = ["fee", "adminNote"];

// Teachers and assistant teachers work the same way, limited to the grades they're assigned to.
const TEACHING = ["teacher", "assistant"];
const isTeaching = (user) => TEACHING.includes(user.role);
const staffOf = (cls) => [...(cls.teacherIds || []), ...(cls.assistantIds || [])];

function requireRole(user, ...roles) {
  if (roles.includes("teacher")) roles.push("assistant");
  if (!roles.includes(user.role)) fail(403, "You don't have access to this.");
}

async function teacherClassIds(user) {
  const classes = await all("classes");
  return classes.filter((c) => staffOf(c).includes(user.id)).map((c) => c.id);
}

async function visibleStudents(user) {
  const students = await all("students");
  if (user.role === "admin") return students;
  if (isTeaching(user)) {
    const ids = await teacherClassIds(user);
    return students.filter((s) => ids.includes(s.classId)).map((s) => stripFields(s, FEE_FIELDS));
  }
  const mine = user.studentIds || [];
  return students.filter((s) => mine.includes(s.id)).map((s) => stripFields(s, ["adminNote"]));
}

function stripFields(obj, keys) {
  const copy = { ...obj };
  keys.forEach((k) => delete copy[k]);
  return copy;
}

async function assertStudentAccess(user, studentId) {
  const s = (await visibleStudents(user)).find((x) => x.id === studentId);
  if (!s) fail(404, "Student not found.");
  return s;
}

async function assertClassAccess(user, classId, { write = false } = {}) {
  const cls = await findById("classes", classId);
  if (!cls) fail(404, "Class not found.");
  if (user.role === "admin") return cls;
  if (isTeaching(user) && staffOf(cls).includes(user.id)) return cls;
  if (!write && user.role === "parent") {
    const kids = (await all("students")).filter((s) => (user.studentIds || []).includes(s.id));
    if (kids.some((k) => k.classId === classId)) return cls;
  }
  fail(403, "You don't have access to this class.");
}

function feeFor(student, classes, settings) {
  if (student.fee !== undefined && student.fee !== null && student.fee !== "") return Number(student.fee);
  const cls = classes.find((c) => c.id === student.classId);
  if (cls && cls.fee !== undefined && cls.fee !== null && cls.fee !== "") return Number(cls.fee);
  return Number(settings.defaultFee) || 0;
}

async function attendanceRecords(prefix) {
  const store = await db();
  const keys = await store.list(prefix);
  return Promise.all(keys.map((k) => store.getJSON(k)));
}

async function testScores(testId) {
  return (await (await db()).getJSON(`scores:${testId}`)) || {};
}

function attendanceSummary(records, studentId) {
  const counts = { P: 0, A: 0, L: 0, E: 0 };
  const history = [];
  for (const r of records) {
    const st = r?.records?.[studentId];
    if (st) { counts[st]++; history.push({ date: r.date, status: st, classId: r.classId }); }
  }
  const total = counts.P + counts.A + counts.L + counts.E;
  const rate = total ? Math.round(((counts.P + counts.L) / total) * 100) : null;
  history.sort((a, b) => b.date.localeCompare(a.date));
  return { counts, total, rate, history };
}

// Files arrive as base64 inside JSON and are kept under "file:<id>".
async function saveUpload(id, file) {
  const buf = Buffer.from(file.data, "base64");
  if (buf.length > MAX_FILE_BYTES) fail(400, "Files must be 4 MB or smaller.");
  const name = String(file.name || "file").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  const type = file.type || "application/octet-stream";
  await (await db()).setFile(`file:${id}`, buf, { name, type });
  return { name, type, size: buf.length };
}

async function sendFile(id) {
  const f = await (await db()).getFile(`file:${id}`);
  if (!f) fail(404, "File not found.");
  return new Response(f.data, { headers: {
    "content-type": f.metadata?.type || "application/octet-stream",
    "content-disposition": `attachment; filename="${encodeURIComponent(f.metadata?.name || "file")}"`,
  } });
}

async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) => {
  const keys = [];
  const regex = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  routes.push({ method, regex, keys, handler, auth });
};

// Setup & auth
route("GET", "/setup", async () => {
  const users = await all("users");
  const settings = await getSettings();
  return { needsSetup: users.length === 0, schoolName: settings.schoolName };
}, { auth: false });

route("POST", "/setup", async ({ body }) => {
  if ((await all("users")).length) fail(400, "Setup has already been completed.");
  const { name, username, password, schoolName } = body;
  if (!name || !username || !password || password.length < 8) fail(400, "Name, username and a password of at least 8 characters are required.");
  if (schoolName) await (await db()).setJSON("settings", { ...(await getSettings()), schoolName });
  const user = await upsert("users", { name, username: username.toLowerCase().trim(), role: "admin", passHash: hashPassword(password), active: true });
  return { token: await signToken(user), user: publicUser(user) };
}, { auth: false });

route("POST", "/auth/login", async ({ body }) => {
  const username = String(body.username || "").toLowerCase().trim();
  const user = (await all("users")).find((u) => u.username === username);
  if (!user || user.active === false || !checkPassword(body.password, user.passHash)) fail(401, "Wrong username or password.");
  return { token: await signToken(user), user: publicUser(user) };
}, { auth: false });

route("GET", "/auth/me", async ({ user }) => ({ user: publicUser(user), settings: await getSettings() }));

route("POST", "/auth/password", async ({ user, body }) => {
  if (!checkPassword(body.current, user.passHash)) fail(400, "Your current password is wrong.");
  if (!body.next || body.next.length < 8) fail(400, "New password must be at least 8 characters.");
  await upsert("users", { id: user.id, passHash: hashPassword(body.next), tokenVersion: (user.tokenVersion || 0) + 1 });
  const fresh = await findById("users", user.id);
  return { token: await signToken(fresh) };
});

// Settings
route("GET", "/settings", async () => getSettings());
route("PUT", "/settings", async ({ user, body }) => {
  requireRole(user, "admin");
  const next = { ...(await getSettings()), ...pick(body, Object.keys(DEFAULT_SETTINGS)) };
  await (await db()).setJSON("settings", next);
  return next;
});

// Users
route("GET", "/users", async ({ user }) => {
  requireRole(user, "admin");
  return (await all("users")).map(publicUser);
});
route("GET", "/teachers", async () => (await all("users")).filter((u) => u.role !== "parent" && u.active !== false).map((u) => ({ id: u.id, name: u.name, role: u.role, phone: u.phone || "" })));
route("POST", "/users", async ({ user, body }) => {
  requireRole(user, "admin");
  const username = String(body.username || "").toLowerCase().trim();
  if (!body.name || !username || !["admin", "teacher", "assistant", "parent"].includes(body.role)) fail(400, "Name, username and role are required.");
  const users = await all("users");
  if (users.some((u) => u.username === username && u.id !== body.id)) fail(400, "That username is already taken.");
  const record = { ...pick(body, ["id", "name", "role", "phone", "email", "studentIds", "active"]), username };
  let tempPassword;
  if (!body.id || body.resetPassword) {
    tempPassword = body.password || randomPassword();
    record.passHash = hashPassword(tempPassword);
    if (body.id) record.tokenVersion = ((users.find((u) => u.id === body.id) || {}).tokenVersion || 0) + 1;
  }
  const saved = await upsert("users", record);
  return { user: publicUser(saved), tempPassword };
});
route("DELETE", "/users/:id", async ({ user, params }) => {
  requireRole(user, "admin");
  if (params.id === user.id) fail(400, "You can't delete your own account.");
  await remove("users", params.id);
  const classes = await all("classes");
  classes.forEach((c) => {
    c.teacherIds = (c.teacherIds || []).filter((t) => t !== params.id);
    c.assistantIds = (c.assistantIds || []).filter((t) => t !== params.id);
  });
  await saveAll("classes", classes);
  return { ok: true };
});

// Create parent logins for students' families in one go (one login per family phone number).
route("POST", "/users/parents/generate", async ({ user, body }) => {
  requireRole(user, "admin");
  const students = (await all("students")).filter((s) => s.active !== false);
  const users = await all("users");
  const created = [];
  const families = new Map();
  for (const s of students) {
    const phone = String(s.fatherPhone || s.motherPhone || s.guardianPhone || "").replace(/\D/g, "");
    if (!phone) continue;
    if (!families.has(phone)) families.set(phone, { phone, name: s.fatherName || s.motherName || s.guardianName || `${s.lastName} family`, ids: [] });
    families.get(phone).ids.push(s.id);
  }
  const onlyIds = body.studentIds;
  for (const fam of families.values()) {
    if (onlyIds && !fam.ids.some((id) => onlyIds.includes(id))) continue;
    const existing = users.find((u) => u.role === "parent" && u.username === fam.phone);
    if (existing) {
      existing.studentIds = [...new Set([...(existing.studentIds || []), ...fam.ids])];
      continue;
    }
    const tempPassword = randomPassword();
    users.push({ id: newId(), username: fam.phone, name: fam.name, role: "parent", phone: fam.phone, studentIds: fam.ids, passHash: hashPassword(tempPassword), active: true, createdAt: new Date().toISOString() });
    created.push({ name: fam.name, username: fam.phone, tempPassword, studentIds: fam.ids });
  }
  await saveAll("users", users);
  return { created };
});

// Classes (grades)
route("GET", "/classes", async ({ user }) => visibleClasses(user));

async function visibleClasses(user) {
  const classes = (await all("classes")).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  const students = await all("students");
  const count = (id) => students.filter((s) => s.classId === id && s.active !== false).length;
  let visible = classes;
  if (isTeaching(user)) visible = classes.filter((c) => staffOf(c).includes(user.id));
  if (user.role === "parent") {
    const kidClasses = students.filter((s) => (user.studentIds || []).includes(s.id)).map((s) => s.classId);
    visible = classes.filter((c) => kidClasses.includes(c.id));
  }
  return visible.map((c) => ({ ...(user.role === "admin" ? c : stripFields(c, ["fee"])), studentCount: count(c.id) }));
}
route("POST", "/classes", async ({ user, body }) => {
  requireRole(user, "admin");
  if (!body.name) fail(400, "Class name is required.");
  return upsert("classes", pick(body, ["id", "name", "order", "teacherIds", "assistantIds", "whatsappLink", "room", "fee", "schedule"]));
});
route("PUT", "/classes/:id/whatsapp", async ({ user, params, body }) => {
  await assertClassAccess(user, params.id, { write: true });
  const link = String(body.whatsappLink || "").trim();
  if (link && !/^https:\/\/chat\.whatsapp\.com\//.test(link)) fail(400, "That doesn't look like a WhatsApp group invite link (https://chat.whatsapp.com/...).");
  return upsert("classes", { id: params.id, whatsappLink: link });
});
route("DELETE", "/classes/:id", async ({ user, params }) => {
  requireRole(user, "admin");
  if ((await all("students")).some((s) => s.classId === params.id)) fail(400, "Move the students out of this class before deleting it.");
  await remove("classes", params.id);
  return { ok: true };
});

// Students
route("GET", "/students", async ({ user }) => visibleStudents(user));
route("POST", "/students", async ({ user, body }) => {
  requireRole(user, "admin");
  if (!body.firstName) fail(400, "First name is required.");
  return upsert("students", { ...pick(body, ["id", ...STUDENT_FIELDS]), active: body.active !== false });
});
route("DELETE", "/students/:id", async ({ user, params }) => {
  requireRole(user, "admin");
  await remove("students", params.id);
  return { ok: true };
});
route("POST", "/students/import", async ({ user, body }) => {
  requireRole(user, "admin");
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const classes = await all("classes");
  const students = await all("students");
  const now = new Date().toISOString();
  const payments = [];
  let createdClasses = 0, added = 0, updated = 0;
  const classIdFor = (name) => {
    if (!name) return "";
    const clean = String(name).trim();
    let c = classes.find((x) => x.name.toLowerCase() === clean.toLowerCase());
    if (!c) {
      c = { id: newId(), name: clean, teacherIds: [], whatsappLink: "", order: classes.length + 1, createdAt: now };
      classes.push(c); createdClasses++;
    }
    return c.id;
  };
  for (const row of rows) {
    if (!row.firstName) continue;
    const record = pick(row, STUDENT_FIELDS);
    if (row.className) record.classId = classIdFor(row.className);
    if (record.fee !== undefined) record.fee = record.fee === "" ? undefined : Number(String(record.fee).replace(/[^\d.]/g, "")) || 0;
    const existing = students.find((s) =>
      (row.studentCode && s.studentCode === row.studentCode) ||
      (s.firstName.toLowerCase() === row.firstName.toLowerCase() && (s.lastName || "").toLowerCase() === (row.lastName || "").toLowerCase()));
    if (existing) { Object.assign(existing, record, { updatedAt: now }); updated++; }
    else { students.push({ ...record, id: newId(), active: true, createdAt: now }); added++; }
    const paid = Number(String(row.paid || "").replace(/[^\d.]/g, ""));
    if (body.importPayments && paid > 0) {
      const s = existing || students[students.length - 1];
      payments.push({ id: newId(), studentId: s.id, amount: paid, date: now.slice(0, 10), method: "Imported", note: "Imported from spreadsheet", recordedBy: user.name, createdAt: now });
    }
  }
  await saveAll("classes", classes);
  await saveAll("students", students);
  if (payments.length) await saveAll("payments", [...(await all("payments")), ...payments]);
  return { added, updated, createdClasses, payments: payments.length };
});

route("GET", "/students/:id/profile", async ({ user, params }) => {
  const student = await assertStudentAccess(user, params.id);
  const [classes, tests, records, settings] = await Promise.all([all("classes"), all("tests"), attendanceRecords("att:"), getSettings()]);
  const cls = classes.find((c) => c.id === student.classId) || null;
  const attendance = attendanceSummary(records.filter(Boolean), student.id);
  const grades = [];
  for (const t of tests.filter((t) => t.classId === student.classId)) {
    const sc = (await testScores(t.id))[student.id];
    if (sc && sc.score !== "" && sc.score !== null && sc.score !== undefined) grades.push({ test: t, score: Number(sc.score), comment: sc.comment || "", percent: Math.round((Number(sc.score) / Number(t.maxScore || 100)) * 100) });
  }
  grades.sort((a, b) => (b.test.date || "").localeCompare(a.test.date || ""));
  let notes = (await all("notes")).filter((n) => n.studentId === student.id);
  if (user.role === "parent") notes = notes.filter((n) => n.visibleToParent);
  notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let finance = null;
  if (!isTeaching(user)) {
    const payments = (await all("payments")).filter((p) => p.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date));
    const fee = feeFor(student, classes, settings);
    const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    finance = { fee, paid, balance: fee - paid, payments };
  }
  const avg = grades.length ? Math.round(grades.reduce((s, g) => s + g.percent, 0) / grades.length) : null;
  return { student, class: cls ? stripFields(cls, user.role === "admin" ? [] : ["fee"]) : null, attendance, grades, average: avg, notes, finance };
});

// Attendance
route("GET", "/attendance", async ({ user, url }) => {
  const classId = url.searchParams.get("classId");
  const date = url.searchParams.get("date");
  await assertClassAccess(user, classId);
  const rec = await (await db()).getJSON(`att:${classId}:${date}`);
  return rec || { classId, date, records: {} };
});
route("PUT", "/attendance", async ({ user, body }) => {
  const { classId, date, records } = body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) fail(400, "Pick a valid date.");
  await assertClassAccess(user, classId, { write: true });
  const clean = {};
  for (const [id, st] of Object.entries(records || {})) if (STATUSES.includes(st)) clean[id] = st;
  const rec = { classId, date, records: clean, takenBy: user.name, updatedAt: new Date().toISOString() };
  await (await db()).setJSON(`att:${classId}:${date}`, rec);
  return rec;
});
route("GET", "/attendance/report", async ({ user, url }) => {
  const classId = url.searchParams.get("classId");
  await assertClassAccess(user, classId);
  const from = url.searchParams.get("from") || "0000";
  const to = url.searchParams.get("to") || "9999";
  const records = (await attendanceRecords(`att:${classId}:`)).filter((r) => r && r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  return { dates: records.map((r) => r.date), records };
});

// Tests & grades
route("GET", "/tests", async ({ user, url }) => {
  const classId = url.searchParams.get("classId");
  if (classId) await assertClassAccess(user, classId);
  let tests = await all("tests");
  if (classId) tests = tests.filter((t) => t.classId === classId);
  else if (user.role !== "admin") {
    const allowed = (await visibleClasses(user)).map((c) => c.id);
    tests = tests.filter((t) => allowed.includes(t.classId));
  }
  return tests.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
});
route("POST", "/tests", async ({ user, body }) => {
  await assertClassAccess(user, body.classId, { write: true });
  if (!body.title) fail(400, "Test name is required.");
  const max = Number(body.maxScore);
  if (!(max > 0)) fail(400, "Max score must be more than 0.");
  return upsert("tests", { ...pick(body, ["id", "classId", "title", "subject", "date", "type"]), maxScore: max, createdBy: body.id ? undefined : user.name });
});
route("DELETE", "/tests/:id", async ({ user, params }) => {
  const t = await findById("tests", params.id);
  if (!t) fail(404, "Test not found.");
  await assertClassAccess(user, t.classId, { write: true });
  await remove("tests", t.id);
  await (await db()).del(`scores:${t.id}`);
  return { ok: true };
});
route("GET", "/tests/:id/scores", async ({ user, params }) => {
  const t = await findById("tests", params.id);
  if (!t) fail(404, "Test not found.");
  await assertClassAccess(user, t.classId, { write: true });
  return { test: t, scores: await testScores(t.id) };
});
route("PUT", "/tests/:id/scores", async ({ user, params, body }) => {
  const t = await findById("tests", params.id);
  if (!t) fail(404, "Test not found.");
  await assertClassAccess(user, t.classId, { write: true });
  const scores = {};
  for (const [id, v] of Object.entries(body.scores || {})) {
    if (v.score === "" || v.score === null || v.score === undefined) { if (v.comment) scores[id] = { score: "", comment: v.comment }; continue; }
    const n = Number(v.score);
    if (Number.isNaN(n) || n < 0 || n > t.maxScore) fail(400, `Scores must be between 0 and ${t.maxScore}.`);
    scores[id] = { score: n, comment: v.comment || "" };
  }
  await (await db()).setJSON(`scores:${t.id}`, scores);
  return { ok: true, scores };
});
route("GET", "/grades/class/:classId", async ({ user, params }) => {
  await assertClassAccess(user, params.classId, { write: true });
  const tests = (await all("tests")).filter((t) => t.classId === params.classId).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const scores = {};
  for (const t of tests) scores[t.id] = await testScores(t.id);
  return { tests, scores };
});

// Assignments (with optional file upload, sent as base64 inside JSON)
route("GET", "/assignments", async ({ user, url }) => {
  const classId = url.searchParams.get("classId");
  let list = await all("assignments");
  if (classId) { await assertClassAccess(user, classId); list = list.filter((a) => a.classId === classId); }
  else if (user.role !== "admin") {
    const allowed = (await visibleClasses(user)).map((c) => c.id);
    list = list.filter((a) => allowed.includes(a.classId));
  }
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
route("POST", "/assignments", async ({ user, body }) => {
  await assertClassAccess(user, body.classId, { write: true });
  if (body.id) await assertClassAccess(user, (await findById("assignments", body.id))?.classId, { write: true });
  if (!body.title) fail(400, "Title is required.");
  const record = { ...pick(body, ["id", "classId", "title", "description", "dueDate", "subject", "link"]) };
  if (!body.id) { record.createdBy = user.name; record.createdById = user.id; }
  record.id = body.id || newId();
  if (body.file?.data) record.file = await saveUpload(record.id, body.file);
  return upsert("assignments", record);
});
route("DELETE", "/assignments/:id", async ({ user, params }) => {
  const a = await findById("assignments", params.id);
  if (!a) fail(404, "Assignment not found.");
  await assertClassAccess(user, a.classId, { write: true });
  await remove("assignments", a.id);
  await (await db()).del(`file:${a.id}`);
  return { ok: true };
});
route("GET", "/assignments/:id/file", async ({ user, params }) => {
  const a = await findById("assignments", params.id);
  if (!a || !a.file) fail(404, "File not found.");
  await assertClassAccess(user, a.classId);
  return sendFile(a.id);
});

// Lesson plans: teachers write them for their grade; the admin reviews them. Parents never see them.
const PLAN_FIELDS = ["classId", "weekOf", "subject", "title", "objectives", "activities", "resources", "homework", "assessment", "notes", "link"];
route("GET", "/lessonplans", async ({ user, url }) => {
  requireRole(user, "admin", "teacher");
  const classId = url.searchParams.get("classId");
  const allowed = (await visibleClasses(user)).map((c) => c.id);
  return (await all("lessonplans"))
    .filter((p) => allowed.includes(p.classId) && (!classId || p.classId === classId))
    .sort((a, b) => (b.weekOf || "").localeCompare(a.weekOf || "") || b.createdAt.localeCompare(a.createdAt));
});
route("POST", "/lessonplans", async ({ user, body }) => {
  requireRole(user, "admin", "teacher");
  await assertClassAccess(user, body.classId, { write: true });
  const existing = body.id ? await findById("lessonplans", body.id) : null;
  if (body.id && !existing) fail(404, "Lesson plan not found.");
  if (existing) await assertClassAccess(user, existing.classId, { write: true });
  if (!body.title) fail(400, "Give the lesson a title.");
  const record = { ...pick(body, PLAN_FIELDS), id: existing?.id || newId() };
  record.status = body.status === "draft" ? "draft" : "submitted";
  // An admin tidying up an approved plan shouldn't send it back for review.
  if (user.role === "admin" && existing && record.status === "submitted" && existing.status !== "draft") record.status = existing.status;
  if (!existing) { record.authorId = user.id; record.authorName = user.name; }
  if (body.file?.data) record.file = await saveUpload(`plan:${record.id}`, body.file);
  return upsert("lessonplans", record);
});
route("POST", "/lessonplans/:id/review", async ({ user, params, body }) => {
  requireRole(user, "admin");
  const plan = await findById("lessonplans", params.id);
  if (!plan) fail(404, "Lesson plan not found.");
  const status = body.status === "approved" ? "approved" : "changes";
  return upsert("lessonplans", { id: plan.id, status, feedback: String(body.feedback || ""), reviewedBy: user.name, reviewedAt: new Date().toISOString() });
});
route("DELETE", "/lessonplans/:id", async ({ user, params }) => {
  const plan = await findById("lessonplans", params.id);
  if (!plan) fail(404, "Lesson plan not found.");
  await assertClassAccess(user, plan.classId, { write: true });
  await remove("lessonplans", plan.id);
  await (await db()).del(`file:plan:${plan.id}`);
  return { ok: true };
});
route("GET", "/lessonplans/:id/file", async ({ user, params }) => {
  requireRole(user, "admin", "teacher");
  const plan = await findById("lessonplans", params.id);
  if (!plan || !plan.file) fail(404, "File not found.");
  await assertClassAccess(user, plan.classId, { write: true });
  return sendFile(`plan:${plan.id}`);
});

// Teacher notes on students
route("GET", "/notes", async ({ user, url }) => {
  const studentId = url.searchParams.get("studentId");
  let notes = await all("notes");
  if (studentId) {
    await assertStudentAccess(user, studentId);
    notes = notes.filter((n) => n.studentId === studentId);
    if (user.role === "parent") notes = notes.filter((n) => n.visibleToParent);
  } else {
    requireRole(user, "admin", "teacher");
    if (isTeaching(user)) {
      const ids = (await visibleStudents(user)).map((s) => s.id);
      notes = notes.filter((n) => ids.includes(n.studentId));
    }
  }
  return notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
route("POST", "/notes", async ({ user, body }) => {
  requireRole(user, "admin", "teacher");
  await assertStudentAccess(user, body.studentId);
  if (!body.text) fail(400, "Write a note first.");
  if (body.id) {
    const existing = await findById("notes", body.id);
    if (!existing || (existing.authorId !== user.id && user.role !== "admin")) fail(403, "You can only edit your own notes.");
  }
  return upsert("notes", {
    ...pick(body, ["id", "studentId", "text", "category", "visibleToParent", "followUp"]),
    ...(body.id ? {} : { authorId: user.id, authorName: user.name }),
  });
});
route("DELETE", "/notes/:id", async ({ user, params }) => {
  const n = await findById("notes", params.id);
  if (!n) fail(404, "Note not found.");
  if (n.authorId !== user.id && user.role !== "admin") fail(403, "You can only delete your own notes.");
  await remove("notes", n.id);
  return { ok: true };
});

// Payments
route("GET", "/payments", async ({ user, url }) => {
  requireRole(user, "admin");
  const studentId = url.searchParams.get("studentId");
  const list = (await all("payments")).filter((p) => !studentId || p.studentId === studentId);
  return list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
});
route("GET", "/payments/summary", async ({ user }) => {
  requireRole(user, "admin");
  const [students, classes, payments, settings] = await Promise.all([all("students"), all("classes"), all("payments"), getSettings()]);
  const rows = students.filter((s) => s.active !== false).map((s) => {
    const paid = payments.filter((p) => p.studentId === s.id).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const fee = feeFor(s, classes, settings);
    return { studentId: s.id, fee, paid, balance: fee - paid };
  });
  const totals = rows.reduce((t, r) => ({ fee: t.fee + r.fee, paid: t.paid + r.paid, balance: t.balance + Math.max(r.balance, 0) }), { fee: 0, paid: 0, balance: 0 });
  return { rows, totals };
});
route("POST", "/payments", async ({ user, body }) => {
  requireRole(user, "admin");
  if (!(await findById("students", body.studentId))) fail(400, "Pick a student.");
  const amount = Number(body.amount);
  if (!amount) fail(400, "Enter an amount.");
  const settings = await getSettings();
  const count = (await all("payments")).length + 1;
  return upsert("payments", {
    ...pick(body, ["id", "studentId", "date", "method", "reference", "note", "period"]),
    amount,
    date: body.date || new Date().toISOString().slice(0, 10),
    ...(body.id ? {} : { recordedBy: user.name, receiptNo: `${(settings.academicYear || "").slice(0, 4)}-${String(count).padStart(4, "0")}` }),
  });
});
route("DELETE", "/payments/:id", async ({ user, params }) => {
  requireRole(user, "admin");
  await remove("payments", params.id);
  return { ok: true };
});

// Announcements
route("GET", "/announcements", async ({ user }) => {
  const list = await all("announcements");
  if (user.role === "admin") return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const classIds = (await visibleClasses(user)).map((c) => c.id);
  return list.filter((a) => !a.classId || classIds.includes(a.classId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
route("POST", "/announcements", async ({ user, body }) => {
  requireRole(user, "admin", "teacher");
  if (body.classId) await assertClassAccess(user, body.classId, { write: true });
  else requireRole(user, "admin");
  if (!body.title) fail(400, "Title is required.");
  return upsert("announcements", { ...pick(body, ["title", "body", "classId"]), authorName: user.name, authorId: user.id });
});
route("DELETE", "/announcements/:id", async ({ user, params }) => {
  const a = await findById("announcements", params.id);
  if (!a) fail(404, "Not found.");
  if (user.role !== "admin" && a.authorId !== user.id) fail(403, "You can only delete your own announcements.");
  await remove("announcements", params.id);
  return { ok: true };
});

// Dashboard numbers
route("GET", "/dashboard", async ({ user }) => {
  const students = (await visibleStudents(user)).filter((s) => s.active !== false);
  const classes = await visibleClasses(user);
  const classIds = classes.map((c) => c.id);
  const records = (await attendanceRecords("att:")).filter((r) => r && classIds.includes(r.classId));
  const lastDate = records.map((r) => r.date).sort().pop() || null;
  let lastDay = null;
  if (lastDate) {
    const day = records.filter((r) => r.date === lastDate);
    const statuses = day.flatMap((r) => Object.entries(r.records)).filter(([id]) => students.some((s) => s.id === id)).map(([, s]) => s);
    lastDay = {
      date: lastDate,
      present: statuses.filter((s) => s === "P" || s === "L").length,
      absent: statuses.filter((s) => s === "A" || s === "E").length,
      classesTaken: day.length,
    };
  }
  const assignments = (await all("assignments")).filter((a) => classIds.includes(a.classId));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = assignments.filter((a) => a.dueDate && a.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const out = { studentCount: students.length, classCount: classes.length, lastDay, upcoming, classes };
  if (user.role === "admin") {
    const summary = await routeFor("GET", "/payments/summary").handler({ user });
    out.finance = { ...summary.totals, unpaidCount: summary.rows.filter((r) => r.balance > 0).length };
    out.teacherCount = (await all("users")).filter(isTeaching).length;
    out.noTeacher = classes.filter((c) => !(c.teacherIds || []).length).map((c) => c.name);
    out.noWhatsapp = classes.filter((c) => !c.whatsappLink).map((c) => c.name);
    out.plansWaiting = (await all("lessonplans")).filter((p) => p.status === "submitted").length;
  }
  return out;
});

// One-time starter data (built from the school's original spreadsheet). Safe to load twice.
route("POST", "/seed", async ({ user, body }) => {
  requireRole(user, "admin");
  const now = new Date().toISOString();
  const classes = await all("classes");
  const students = await all("students");
  const classId = (name) => {
    if (!name) return "";
    let c = classes.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!c) { c = { id: newId(), name, teacherIds: [], whatsappLink: "", createdAt: now }; classes.push(c); }
    return c.id;
  };
  (body.classes || []).forEach((c) => { const id = classId(c.name); Object.assign(classes.find((x) => x.id === id), pick(c, ["order", "fee"])); });
  const idByKey = {};
  for (const s of body.students || []) {
    const record = { ...pick(s, STUDENT_FIELDS), classId: classId(s.className) };
    const existing = students.find((x) => x.firstName.toLowerCase() === s.firstName.toLowerCase() && (x.lastName || "").toLowerCase() === (s.lastName || "").toLowerCase());
    if (existing) { Object.assign(existing, record, { updatedAt: now }); idByKey[s.key] = existing.id; }
    else { const id = newId(); students.push({ ...record, id, active: s.active !== false, createdAt: now }); idByKey[s.key] = id; }
  }
  await saveAll("classes", classes);
  await saveAll("students", students);

  const store = await db();
  let sheets = 0;
  for (const a of body.attendance || []) {
    const cid = classId(a.className);
    const key = `att:${cid}:${a.date}`;
    const rec = (await store.getJSON(key)) || { classId: cid, date: a.date, records: {}, takenBy: "Imported from Google Form" };
    for (const [k, st] of Object.entries(a.records || {})) if (idByKey[k] && STATUSES.includes(st)) rec.records[idByKey[k]] = st;
    await store.setJSON(key, rec);
    sheets++;
  }

  const payments = await all("payments");
  let paymentCount = 0;
  for (const p of body.payments || []) {
    const sid = idByKey[p.key];
    if (!sid || payments.some((x) => x.studentId === sid && x.importRef === p.importRef)) continue;
    payments.push({ ...pick(p, ["amount", "date", "method", "note", "importRef"]), id: newId(), studentId: sid, recordedBy: user.name, receiptNo: "Imported", createdAt: now });
    paymentCount++;
  }
  await saveAll("payments", payments);

  const users = await all("users");
  const teachers = [];
  for (const t of body.teachers || []) {
    const username = String(t.username || t.name).toLowerCase().replace(/[^a-z0-9.]/g, "");
    if (!username || users.some((u) => u.username === username || (t.email && u.email?.toLowerCase() === t.email.toLowerCase()))) continue;
    const tempPassword = randomPassword();
    users.push({ id: newId(), username, name: t.name, email: t.email || "", phone: t.phone || "", role: "teacher", passHash: hashPassword(tempPassword), active: true, createdAt: now });
    teachers.push({ name: t.name, username, tempPassword });
  }
  await saveAll("users", users);
  if (body.settings) await store.setJSON("settings", { ...(await getSettings()), ...pick(body.settings, Object.keys(DEFAULT_SETTINGS)) });
  return { students: (body.students || []).length, attendance: sheets, payments: paymentCount, teachers };
});

// Backup & restore (admin)
const BACKUP_COLLECTIONS = ["users", "classes", "students", "tests", "assignments", "lessonplans", "notes", "payments", "announcements"];
route("GET", "/backup", async ({ user }) => {
  requireRole(user, "admin");
  const store = await db();
  const data = { exportedAt: new Date().toISOString(), settings: await getSettings() };
  for (const c of BACKUP_COLLECTIONS) data[c] = await all(c);
  data.attendance = (await attendanceRecords("att:")).filter(Boolean);
  data.scores = {};
  for (const k of await store.list("scores:")) data.scores[k.slice(7)] = await store.getJSON(k);
  return data;
});
route("POST", "/restore", async ({ user, body }) => {
  requireRole(user, "admin");
  if (!Array.isArray(body.users) || !body.users.some((u) => u.role === "admin")) fail(400, "This doesn't look like a valid backup file.");
  const store = await db();
  for (const c of BACKUP_COLLECTIONS) if (Array.isArray(body[c])) await saveAll(c, body[c]);
  if (body.settings) await store.setJSON("settings", body.settings);
  for (const r of body.attendance || []) await store.setJSON(`att:${r.classId}:${r.date}`, r);
  for (const [id, s] of Object.entries(body.scores || {})) await store.setJSON(`scores:${id}`, s);
  return { ok: true };
});

// ---------- dispatcher ----------

function routeFor(method, path) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.regex);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  try {
    const match = routeFor(req.method, path);
    if (!match) fail(404, "Not found.");
    let user = null;
    if (match.auth) {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
      const claims = await verifyToken(token);
      if (!claims) fail(401, "Please sign in again.");
      user = await findById("users", claims.sub);
      if (!user || user.active === false || (user.tokenVersion || 0) !== claims.ver) fail(401, "Please sign in again.");
    }
    const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
    const result = await match.handler({ req, url, user, body, params: match.params });
    return result instanceof Response ? result : json(result);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong on the server." }, 500);
  }
};

export const config = { path: "/api/*" };
