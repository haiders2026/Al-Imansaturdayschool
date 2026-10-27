import { state, api, esc, fmtDate, fmtMoney, today, studentName, className, studentById, classOptions, toast, emptyState, modal, onSubmit, confirmBox, download, toCSV, waChat, parentPhone, parentName, familyKey } from "../core.js";

const METHODS = ["Cash", "Card", "Bank transfer", "Zelle", "Cheque", "Online", "Other"];

export async function render(page, [view = "families"]) {
  const [summary, payments] = await Promise.all([api("GET", "/payments/summary"), api("GET", "/payments")]);
  const t = summary.totals;
  const collectedThisMonth = payments.filter((p) => p.date?.slice(0, 7) === today().slice(0, 7)).reduce((s, p) => s + Number(p.amount), 0);

  page.innerHTML = `
    <div class="page-head"><div><h1>Payments</h1><div class="muted">Fees are set per class in Grades & WhatsApp, with optional per-student overrides.</div></div>
      <div class="btn-row"><button class="btn secondary" id="export">Export CSV</button><button class="btn" id="pay">+ Record payment</button></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Expected</div><div class="value">${fmtMoney(t.fee)}</div></div>
      <div class="stat"><div class="label">Collected</div><div class="value">${fmtMoney(t.paid)}</div><div class="sub">${t.fee ? Math.round((t.paid / t.fee) * 100) : 0}% of expected</div></div>
      <div class="stat"><div class="label">Outstanding</div><div class="value" style="color:var(--red)">${fmtMoney(t.balance)}</div><div class="sub">${summary.rows.filter((r) => r.balance > 0).length} students</div></div>
      <div class="stat"><div class="label">This month</div><div class="value">${fmtMoney(collectedThisMonth)}</div></div>
    </div>
    <div class="tabs"><button data-view="families">By family</button><button data-view="balances">By student</button><button data-view="history">Payment history</button></div>
    <div class="card" id="body"></div>`;

  page.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    b.onclick = () => { location.hash = `#/payments/${b.dataset.view}`; };
  });
  page.querySelector("#pay").onclick = () => paymentForm();
  const body = page.querySelector("#body");
  if (view === "history") drawHistory(body, payments, page);
  else if (view === "families") drawFamilies(body, summary.rows, page);
  else drawBalances(body, summary.rows, page);
}

function drawBalances(body, rows, page) {
  let filter = "owing", cls = "", q = "";
  body.innerHTML = `<div class="toolbar">
    <div class="field" style="flex:1"><label>Search</label><input id="q" placeholder="Student or parent"></div>
    <div class="field"><label>Class</label><select id="cls">${classOptions("", { includeAll: true })}</select></div>
    <div class="field"><label>Show</label><select id="f"><option value="owing">Owing money</option><option value="paid">Paid in full</option><option value="all">Everyone</option></select></div></div>
    <div id="t"></div>`;
  const list = () => rows.map((r) => ({ ...r, s: studentById(r.studentId) })).filter((r) => r.s)
    .filter((r) => filter === "all" || (filter === "owing" ? r.balance > 0 : r.balance <= 0))
    .filter((r) => !cls || r.s.classId === cls)
    .filter((r) => !q || [studentName(r.s), r.s.fatherName, r.s.motherName].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.balance - a.balance);
  const draw = () => {
    const l = list();
    body.querySelector("#t").innerHTML = l.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Balance</th><th></th></tr></thead><tbody>
      ${l.map((r) => {
        const msg = `As-salamu alaykum ${parentName(r.s)}, this is a gentle reminder from ${state.settings.schoolName} that ${fmtMoney(r.balance)} is still due for ${r.s.firstName}'s ${state.settings.academicYear || ""} fees. JazakAllahu khayran.`;
        return `<tr><td><a href="#/student/${r.s.id}/payments">${esc(studentName(r.s))}</a></td><td>${esc(className(r.s.classId))}</td>
          <td class="num">${fmtMoney(r.fee)}</td><td class="num">${fmtMoney(r.paid)}</td>
          <td class="num">${r.balance > 0 ? `<span class="badge red">${fmtMoney(r.balance)}</span>` : `<span class="badge green">Paid</span>`}</td>
          <td><div class="btn-row"><button class="btn sm" data-pay="${r.s.id}">Record</button>${r.balance > 0 && parentPhone(r.s) ? `<a class="btn sm wa" href="${waChat(parentPhone(r.s), msg)}" target="_blank" rel="noopener">Remind</a>` : ""}</div></td></tr>`;
      }).join("")}</tbody></table></div>` : emptyState("Nobody in this list.");
    body.querySelectorAll("[data-pay]").forEach((b) => b.onclick = () => paymentForm(b.dataset.pay));
  };
  draw();
  body.querySelector("#q").oninput = (e) => { q = e.target.value; draw(); };
  body.querySelector("#cls").onchange = (e) => { cls = e.target.value; draw(); };
  body.querySelector("#f").onchange = (e) => { filter = e.target.value; draw(); };
  page.querySelector("#export").onclick = () => download("fee-balances.csv", toCSV([
    ["Student", "Class", "Parent", "Phone", "Fee", "Paid", "Balance"],
    ...rows.map((r) => ({ ...r, s: studentById(r.studentId) })).filter((r) => r.s).map((r) => [studentName(r.s), className(r.s.classId), parentName(r.s), parentPhone(r.s), r.fee, r.paid, r.balance]),
  ]));
}

// Families often pay for all their children at once, so balances are clearest per family.
function drawFamilies(body, rows, page) {
  const fams = new Map();
  rows.forEach((r) => {
    const s = studentById(r.studentId);
    if (!s) return;
    const k = familyKey(s);
    if (!fams.has(k)) fams.set(k, { name: parentName(s) + (s.lastName ? ` (${s.lastName})` : ""), phone: parentPhone(s), kids: [], fee: 0, paid: 0 });
    const f = fams.get(k);
    f.kids.push(s); f.fee += r.fee; f.paid += r.paid;
  });
  const list = [...fams.values()].map((f) => ({ ...f, balance: f.fee - f.paid }));
  let filter = "owing", q = "";
  body.innerHTML = `<div class="toolbar"><div class="field" style="flex:1"><label>Search</label><input id="q" placeholder="Family or child"></div>
    <div class="field"><label>Show</label><select id="f"><option value="owing">Owing money</option><option value="paid">Paid in full</option><option value="all">Everyone</option></select></div></div><div id="t"></div>`;
  const draw = () => {
    const l = list.filter((f) => filter === "all" || (filter === "owing" ? f.balance > 0 : f.balance <= 0))
      .filter((f) => !q || (f.name + " " + f.kids.map(studentName).join(" ")).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.balance - a.balance);
    body.querySelector("#t").innerHTML = l.length ? `<div class="table-wrap"><table><thead><tr><th>Family</th><th>Children</th><th class="num">Fees</th><th class="num">Paid</th><th class="num">Balance</th><th></th></tr></thead><tbody>
      ${l.map((f) => {
        const msg = `As-salamu alaykum ${f.name.replace(/ \(.*\)$/, "")}, this is a gentle reminder from ${state.settings.schoolName} that ${fmtMoney(f.balance)} is still due for ${f.kids.map((k) => k.firstName).join(" & ")}'s ${state.settings.academicYear || ""} fees. JazakAllahu khayran.`;
        return `<tr><td><strong>${esc(f.name)}</strong><div class="muted small">${esc(f.phone)}</div></td>
          <td class="small">${f.kids.map((k) => `<a href="#/student/${k.id}/payments">${esc(k.firstName)}</a> <span class="muted">${esc(className(k.classId))}</span>`).join("<br>")}</td>
          <td class="num">${fmtMoney(f.fee)}</td><td class="num">${fmtMoney(f.paid)}</td>
          <td class="num">${f.balance > 0 ? `<span class="badge red">${fmtMoney(f.balance)}</span>` : f.fee || f.paid ? `<span class="badge green">${f.balance < 0 ? "Credit " + fmtMoney(-f.balance) : "Paid"}</span>` : ""}</td>
          <td><div class="btn-row"><button class="btn sm" data-pay="${f.kids[0].id}">Record</button>${f.balance > 0 && f.phone ? `<a class="btn sm wa" href="${waChat(f.phone, msg)}" target="_blank" rel="noopener">Remind</a>` : ""}</div></td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="muted small">Siblings are grouped by parent phone number. A family payment can be recorded on any one child; the family balance is what matters.</p>` : emptyState("Nobody in this list.");
    body.querySelectorAll("[data-pay]").forEach((b) => b.onclick = () => paymentForm(b.dataset.pay));
  };
  draw();
  body.querySelector("#q").oninput = (e) => { q = e.target.value; draw(); };
  body.querySelector("#f").onchange = (e) => { filter = e.target.value; draw(); };
  page.querySelector("#export").onclick = () => download("family-balances.csv", toCSV([
    ["Family", "Phone", "Children", "Fees", "Paid", "Balance"], ...list.map((f) => [f.name, f.phone, f.kids.map(studentName).join("; "), f.fee, f.paid, f.balance]),
  ]));
}

function drawHistory(body, payments, page) {
  body.innerHTML = payments.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Student</th><th class="num">Amount</th><th>Method</th><th>Reference / note</th><th>By</th><th></th></tr></thead><tbody>
    ${payments.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.receiptNo || "")}</td><td>${esc(studentName(studentById(p.studentId)))}</td><td class="num">${fmtMoney(p.amount)}</td>
      <td>${esc(p.method || "")}</td><td>${esc([p.reference, p.note].filter(Boolean).join(" · "))}</td><td>${esc(p.recordedBy || "")}</td>
      <td><div class="btn-row"><button class="btn link small" data-receipt="${p.id}">Receipt</button><button class="btn link small" data-edit="${p.id}">Edit</button><button class="btn link small" style="color:var(--red)" data-del="${p.id}">Delete</button></div></td></tr>`).join("")}
  </tbody></table></div>` : emptyState("No payments recorded yet.");
  body.querySelectorAll("[data-receipt]").forEach((b) => b.onclick = () => { const p = payments.find((x) => x.id === b.dataset.receipt); showReceipt(p, studentById(p.studentId)); });
  body.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { const p = payments.find((x) => x.id === b.dataset.edit); paymentForm(p.studentId, p); });
  body.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("Delete this payment record?"))) return;
    await api("DELETE", `/payments/${b.dataset.del}`);
    toast("Payment deleted");
    window.refreshPage();
  });
  page.querySelector("#export").onclick = () => download("payments.csv", toCSV([
    ["Date", "Receipt", "Student", "Class", "Amount", "Method", "Reference", "Note", "Recorded by"],
    ...payments.map((p) => { const s = studentById(p.studentId); return [p.date, p.receiptNo, studentName(s), className(s?.classId), p.amount, p.method, p.reference, p.note, p.recordedBy]; }),
  ]));
}

export function paymentForm(studentId = "", p = {}) {
  const students = state.students.filter((s) => s.active !== false || s.id === studentId).sort((a, b) => studentName(a).localeCompare(studentName(b)));
  const { el, close } = modal({
    title: p.id ? "Edit payment" : "Record payment",
    body: `<form>
      <div class="field"><label>Student</label><select name="studentId" required><option value="">Choose…</option>${students.map((s) => `<option value="${s.id}" ${s.id === studentId ? "selected" : ""}>${esc(studentName(s))} — ${esc(className(s.classId))}</option>`).join("")}</select></div>
      <div class="form-grid">
        <div class="field"><label>Amount (${esc(state.settings.currency || "$")})</label><input type="number" step="0.01" name="amount" value="${p.amount ?? ""}" required></div>
        <div class="field"><label>Date</label><input type="date" name="date" value="${p.date || today()}" required></div>
        <div class="field"><label>Method</label><select name="method">${METHODS.map((m) => `<option ${m === p.method ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div class="field"><label>Reference / cheque #</label><input name="reference" value="${esc(p.reference || "")}"></div>
      </div>
      <div class="field"><label>Note</label><input name="note" value="${esc(p.note || "")}" placeholder="e.g. Term 1, sibling discount…"></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    const saved = await api("POST", "/payments", { ...v, id: p.id });
    toast("Payment saved");
    close();
    if (!p.id) showReceipt(saved, studentById(saved.studentId), true);
    else window.refreshPage();
  });
}

export function showReceipt(p, s, refreshOnClose = false) {
  const msg = `As-salamu alaykum ${parentName(s)}, we received ${fmtMoney(p.amount)} for ${s?.firstName}'s fees on ${fmtDate(p.date)} (receipt ${p.receiptNo || ""}). JazakAllahu khayran — ${state.settings.schoolName}`;
  const { el, close } = modal({
    title: "Receipt",
    body: `<div style="border:1px dashed #9bb;padding:20px;border-radius:10px">
      <div style="text-align:center"><img src="/icon.svg" width="40" alt=""><h2 style="margin:6px 0 0">${esc(state.settings.schoolName)}</h2><div class="muted">Payment receipt</div></div>
      <dl class="kv" style="margin-top:16px"><dt>Receipt #</dt><dd>${esc(p.receiptNo || "")}</dd><dt>Date</dt><dd>${fmtDate(p.date)}</dd>
      <dt>Student</dt><dd>${esc(studentName(s))} (${esc(className(s?.classId))})</dd><dt>Received from</dt><dd>${esc(parentName(s))}</dd>
      <dt>Amount</dt><dd><strong style="font-size:1.2rem">${fmtMoney(p.amount)}</strong></dd><dt>Method</dt><dd>${esc(p.method || "")}${p.reference ? ` · ${esc(p.reference)}` : ""}</dd>
      ${p.note ? `<dt>Note</dt><dd>${esc(p.note)}</dd>` : ""}<dt>Received by</dt><dd>${esc(p.recordedBy || "")}</dd></dl>
      <p class="muted small" style="text-align:center;margin-top:16px">JazakAllahu khayran for supporting our school.</p></div>
      <div class="modal-foot no-print">${parentPhone(s) ? `<a class="btn wa" href="${waChat(parentPhone(s), msg)}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ""}<button class="btn secondary" id="print">Print</button><button class="btn" data-close>Done</button></div>`,
  });
  el.querySelector("#print").onclick = () => { document.body.classList.add("printing-modal"); print(); document.body.classList.remove("printing-modal"); };
  if (refreshOnClose) el.parentElement.addEventListener("click", (e) => { if (e.target === el.parentElement || e.target.closest("[data-close]")) window.refreshPage(); });
  return close;
}
