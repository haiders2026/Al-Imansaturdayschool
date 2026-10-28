// Exercises the main API flows against a throwaway local data folder.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "school-"));
const { default: api } = await import("../netlify/functions/api.mjs");
let token = "";
async function call(method, p, body, expect = 200) {
  const res = await api(new Request(`http://x/api${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }));
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (res.status !== expect) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const ok = (cond, msg) => { if (!cond) throw new Error("FAILED: " + msg); console.log("✓", msg); };

// Data saved before fees and codes existed, to check the one-time migration.
const { db } = await import("../netlify/functions/lib/store.mjs");
await (await db()).setJSON("settings", { schoolName: "Old", defaultFee: 0 });
await (await db()).setJSON("students", [{ id: "old1", firstName: "Old", lastName: "Student", adminNote: "Status in original sheet: R" }]);
ok((await call("GET", "/setup")).needsSetup, "fresh install needs setup");
token = (await call("POST", "/setup", { name: "Admin", username: "admin", email: "Admin@Example.com", password: "password123" })).token;
await call("POST", "/auth/login", { username: "admin@example.com", password: "password123" });
ok(true, "admin can sign in with their email");
await call("POST", "/auth/recover", { code: "x", username: "admin", password: "whatever12" }, 400);
process.env.ADMIN_RECOVERY_CODE = "correct-horse-battery";
await call("POST", "/auth/recover", { code: "wrong-code-here", username: "admin", password: "whatever12" }, 401);
const rec = await call("POST", "/auth/recover", { code: "correct-horse-battery", username: "admin", password: "recovered12" });
ok(rec.admins.includes("admin"), "recovery code resets the admin password");
await call("GET", "/auth/me", null, 401);
token = rec.token;
await call("POST", "/auth/password", { current: "recovered12", next: "password123" });
token = (await call("POST", "/auth/login", { username: "admin", password: "password123" })).token;
delete process.env.ADMIN_RECOVERY_CODE;
await call("POST", "/setup", { name: "X", username: "x", password: "password123" }, 400);
const old = (await call("GET", "/students")).find((x) => x.id === "old1");
ok(old.code === "R" && old.adminNote === undefined, "old R/C status notes become the private code");
const fees = await call("GET", "/settings");
ok(fees.defaultFee === 150 && fees.bookFee === 25, "fee settings filled in for existing schools");
ok((await call("GET", "/payments/summary")).rows.find((r) => r.studentId === "old1").fee === 175, "fee is $150 + one $25 book by default");
await call("PUT", "/students/old1/books", { books: 2 });
ok((await call("GET", "/payments/summary")).rows.find((r) => r.studentId === "old1").fee === 200, "a second book adds $25");
await call("PUT", "/students/old1/books", { books: 9 }, 400);
await call("DELETE", "/students/old1");
ok(true, "setup can't run twice");

const seedFile = process.argv[2];
if (seedFile) {
  const r = await call("POST", "/seed", JSON.parse(readFileSync(seedFile, "utf8")));
  ok(r.students > 0 && r.teachers.length === 1, `seed loaded ${r.students} students, ${r.attendance} attendance sheets, ${r.payments} payments`);
  const again = await call("POST", "/seed", JSON.parse(readFileSync(seedFile, "utf8")));
  ok(again.payments === 0 && again.teachers.length === 0, "loading the seed twice doesn't duplicate payments or teachers");
  ok((await call("GET", "/students")).length === r.students, "no duplicate students after second load");
} else {
  await call("POST", "/students/import", { rows: [{ firstName: "Ali", lastName: "Khan", className: "Grade 3", fatherPhone: "347-555-0101", paid: "200" }, { firstName: "Sara", lastName: "Khan", className: "Grade 3", fatherPhone: "347-555-0101" }, { firstName: "Omar", lastName: "Ali", className: "Grade 4", motherPhone: "+44 7700 900123" }], importPayments: true });
}
const classes = await call("GET", "/classes");
const students = await call("GET", "/students");
const cls = classes.find((c) => c.studentCount > 1);
const kids = students.filter((s) => s.classId === cls.id).sort((a, b) => !!(b.fatherPhone || b.motherPhone) - !!(a.fatherPhone || a.motherPhone));

const t = await call("POST", "/users", { name: "Teacher T", username: "tt", role: "teacher", password: "teacherpass" });
const asst = await call("POST", "/users", { name: "Assistant A", username: "aa", role: "assistant", password: "assistpass" });
await call("POST", "/classes", { ...cls, teacherIds: [t.user.id], assistantIds: [asst.user.id] });
await call("PUT", `/classes/${cls.id}/whatsapp`, { whatsappLink: "not a link" }, 400);
await call("PUT", `/classes/${cls.id}/whatsapp`, { whatsappLink: "https://chat.whatsapp.com/ABC123" });
await call("PUT", "/settings", { defaultFee: 300 });

const adminToken = token;
token = (await call("POST", "/auth/login", { username: "TT", password: "teacherpass" })).token;
ok((await call("GET", "/classes")).length === 1, "teacher sees only their class");
const tStudents = await call("GET", "/students");
ok(tStudents.length === kids.length && tStudents.every((s) => s.fee === undefined && s.adminNote === undefined && s.code === undefined && s.books === undefined), "teacher sees only their students, without fee/admin/code fields");
await call("GET", "/payments/summary", null, 403);
ok(true, "teacher can't see payments");
const other = classes.find((c) => c.id !== cls.id);
if (other) await call("PUT", "/attendance", { classId: other.id, date: "2026-11-01", records: {} }, 403);
await call("PUT", "/attendance", { classId: cls.id, date: "2026-11-07", records: { [kids[0].id]: "A", [kids[1].id]: "P", bogus: "Z" } });
ok(Object.keys((await call("GET", `/attendance?classId=${cls.id}&date=2026-11-07`)).records).length === 2, "attendance saved, invalid statuses dropped");
const test = await call("POST", "/tests", { classId: cls.id, title: "Quran quiz", maxScore: 20, date: "2026-11-07" });
await call("PUT", `/tests/${test.id}/scores`, { scores: { [kids[0].id]: { score: 25 } } }, 400);
await call("PUT", `/tests/${test.id}/scores`, { scores: { [kids[0].id]: { score: 18, comment: "Great" }, [kids[1].id]: { score: 9 } } });
const a = await call("POST", "/assignments", { classId: cls.id, title: "Worksheet", file: { name: "w.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 hello").toString("base64") } });
ok(a.file.size === 14, "assignment file uploaded");
const file = await call("GET", `/assignments/${a.id}/file`);
ok(file.startsWith("%PDF"), "assignment file downloads");
await call("POST", "/notes", { studentId: kids[0].id, text: "Private note", category: "Behaviour" });
await call("POST", "/notes", { studentId: kids[0].id, text: "Shared praise", category: "Praise", visibleToParent: true });

const plan = await call("POST", "/lessonplans", { classId: cls.id, weekOf: "2026-11-07", title: "Surah Al-Asr", objectives: "Memorise", status: "submitted",
  file: { name: "plan.pdf", type: "application/pdf", data: Buffer.from("%PDF plan").toString("base64") } });
ok(plan.status === "submitted" && plan.authorName === "Teacher T" && plan.file, "teacher submits a lesson plan with a file");
if (other) await call("POST", "/lessonplans", { classId: other.id, title: "Not mine" }, 403);

token = (await call("POST", "/auth/login", { username: "aa", password: "assistpass" })).token;
ok((await call("GET", "/classes")).map((c) => c.id).join() === cls.id, "assistant teacher sees only their grade");
const colleagues = (await call("GET", "/teachers")).map((u) => u.name).sort().join();
ok(colleagues === "Assistant A,Teacher T", "assistant sees only their grade's staff");
ok((await call("GET", "/settings")).defaultFee === undefined, "assistant doesn't see fee settings");
await call("PUT", "/attendance", { classId: cls.id, date: "2026-11-14", records: { [kids[0].id]: "P" } });
ok(true, "assistant teacher can take attendance for their grade");
if (other) await call("PUT", "/attendance", { classId: other.id, date: "2026-11-14", records: {} }, 403);
ok((await call("GET", "/lessonplans")).length === 1, "assistant sees the grade's lesson plans");
await call("GET", "/payments/summary", null, 403);
await call("POST", `/lessonplans/${plan.id}/review`, { status: "approved" }, 403);
ok(true, "assistant can't see payments or approve plans");

token = adminToken;
const reviewed = await call("POST", `/lessonplans/${plan.id}/review`, { status: "changes", feedback: "Add a homework task" });
ok(reviewed.status === "changes" && reviewed.feedback, "admin sends a plan back with feedback");
ok((await call("GET", `/lessonplans/${plan.id}/file`)).startsWith("%PDF"), "lesson plan file downloads");
const { created } = await call("POST", "/users/parents/generate", {});
ok(created.length > 0, `${created.length} parent logins generated`);
const fam = created.find((c) => c.studentIds.includes(kids[0].id));
await call("POST", "/payments", { studentId: kids[0].id, amount: 100, method: "Cash" });
const summary = await call("GET", "/payments/summary");
ok(summary.rows.find((r) => r.studentId === kids[0].id).fee === 325, "default fee plus one book applies");

// Calendar
await call("POST", "/events", { title: "Eid holiday", type: "noschool", date: "2026-11-21" });
await call("POST", "/events", { title: "Bad dates", date: "2026-11-21", endDate: "2026-11-20" }, 400);
if (other) await call("POST", "/events", { title: "Other grade trip", date: "2026-11-28", classId: other.id });
token = (await call("POST", "/auth/login", { username: "tt", password: "teacherpass" })).token;
const quiz = await call("POST", "/events", { title: "Grade quiz", type: "exam", date: "2026-11-28", classId: cls.id });
await call("POST", "/events", { title: "School-wide", date: "2026-11-28" }, 403);
if (other) await call("POST", "/events", { title: "Not mine", date: "2026-11-28", classId: other.id }, 403);
ok((await call("GET", "/events")).map((e) => e.title).sort().join() === "Eid holiday,Grade quiz", "teacher adds events for their class and sees only school + own class");
token = adminToken;
ok((await call("GET", "/events")).length === (other ? 3 : 2), "admin sees every calendar entry");

token = (await call("POST", "/auth/login", { username: fam.username, password: fam.tempPassword })).token;
const mine = await call("GET", "/students");
ok(mine.length === fam.studentIds.length && mine.every((s) => s.adminNote === undefined && s.code === undefined), "parent sees only their own children, without private code");
const prof = await call("GET", `/students/${kids[0].id}/profile`);
ok(prof.notes.length === 1 && prof.notes[0].text === "Shared praise", "parent sees only shared notes");
ok(prof.grades[0].percent === 90 && prof.attendance.counts.A >= 1 && prof.finance.paid >= 100, "parent sees grades, attendance and balance");
const stranger = students.find((s) => !fam.studentIds.includes(s.id));
await call("GET", `/students/${stranger.id}/profile`, null, 404);
ok(true, "parent can't open another child");
await call("GET", "/payments", null, 403);
await call("POST", "/notes", { studentId: kids[0].id, text: "x" }, 403);
await call("GET", "/lessonplans", null, 403);
ok(true, "parent can't see payment ledger, lesson plans or write notes");
ok((await call("GET", "/assignments")).some((x) => x.id === a.id), "parent sees class assignments");
ok((await call("GET", "/events")).map((e) => e.title).sort().join() === "Eid holiday,Grade quiz", "parent sees whole-school and their child's class events only");
await call("DELETE", `/events/${quiz.id}`, null, 403);
await call("GET", "/registrations", null, 403);
ok(true, "parent can't delete events or see registrations");

// Online registration (no login)
token = "";
const info = await call("GET", "/register/info");
ok(info.open && info.grades.includes(cls.name) && info.defaultFee === undefined, "registration form lists grades without exposing fee settings");
const family = { fatherName: "Yusuf Rahman", fatherPhone: "(718) 555-0199", address: "1 Main St" };
await call("POST", "/register", { family, children: [{ firstName: "Zaid" }], agree: true }, 400);
await call("POST", "/register", { family: { fatherName: "No phone" }, children: [{ firstName: "Zaid", lastName: "Rahman", grade: cls.name }], agree: true }, 400);
await call("POST", "/register", { family, children: [{ firstName: "Zaid", lastName: "Rahman", grade: cls.name }] }, 400);
const sent = await call("POST", "/register", { family, photoConsent: true, agree: true, children: [
  { firstName: "Zaid", lastName: "Rahman", grade: cls.name, dob: "2017-03-04", allergies: "Peanuts" },
  { firstName: "Huda", lastName: "Rahman", grade: "Not sure", returning: true },
] });
ok(sent.ref.length === 6, "a family registers two children without logging in");
const bot = await call("POST", "/register", { family, agree: true, website: "spam.example", children: [{ firstName: "Bot", lastName: "X", grade: "1" }] });
ok(bot.ok, "spam bots get a quiet OK");
const returning = kids.find((k) => k.fatherPhone || k.motherPhone);
await call("POST", "/register", { agree: true, family: { motherName: "Returning Mum", fatherPhone: returning.fatherPhone || returning.motherPhone }, children: [{ firstName: returning.firstName, lastName: returning.lastName, grade: cls.name, returning: true }] });

token = adminToken;
const regs = await call("GET", "/registrations");
ok(regs.length === 2 && regs.every((r) => r.status === "pending"), "admin sees the registrations (bot entry dropped)");
ok((await call("GET", "/dashboard")).registrationsWaiting === 2, "dashboard counts new registrations");
const newFam = regs.find((r) => r.ref === sent.ref);
await call("POST", `/registrations/${newFam.id}/approve`, { children: [{ classId: "" }, { skip: true }] }, 400);
const approved = await call("POST", `/registrations/${newFam.id}/approve`, { children: [{ classId: cls.id, books: 2 }, { classId: cls.id }], createParentLogin: true });
ok(approved.studentIds.length === 2 && approved.logins.length === 1 && approved.logins[0].username === "7185550199", "approving adds both children and creates one parent login");
const zaid = (await call("GET", "/students")).find((s) => s.id === approved.studentIds[0]);
ok(zaid.classId === cls.id && zaid.books === 2 && zaid.allergies === "Peanuts" && zaid.fatherName === "Yusuf Rahman" && zaid.photoConsent === true, "new student has the family's details, class and books");
await call("POST", `/registrations/${newFam.id}/approve`, { children: [{ classId: cls.id }] }, 400);
const back = regs.find((r) => r.ref !== sent.ref);
ok(back.children[0].matchId === returning.id, "a returning child is matched to their existing record");
const before = (await call("GET", "/students")).length;
await call("POST", `/registrations/${back.id}/approve`, { children: [{ classId: cls.id }] });
ok((await call("GET", "/students")).length === before, "approving a returning child updates them instead of duplicating");
await call("PUT", "/settings", { registrationOpen: false });
token = "";
ok((await call("GET", "/register/info")).open === false, "admin can close registration");
await call("POST", "/register", { family, agree: true, children: [{ firstName: "Late", lastName: "R", grade: cls.name }] }, 400);
token = adminToken;
await call("PUT", "/settings", { registrationOpen: true });

token = adminToken;
const backup = await call("GET", "/backup");
ok(backup.students.length === students.length + 2 && backup.attendance.length > 0 && backup.events.length && backup.registrations.length === 2, "backup includes data, calendar and registrations");
await call("POST", "/auth/password", { current: "password123", next: "newpassword1" });
await call("GET", "/auth/me", null, 401);
ok(true, "old token stops working after password change");
token = "garbage";
await call("GET", "/students", null, 401);
console.log("\nAll checks passed.");
