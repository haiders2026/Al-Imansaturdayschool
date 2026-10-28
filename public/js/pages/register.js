// Public registration form: families sign up new or returning children. No login needed.
import { api, esc, toast, formValues } from "../core.js";

const MAX_CHILDREN = 8;

export async function renderPublic(app) {
  const info = await api("GET", "/register/info");
  document.title = `Register · ${info.schoolName}`;
  const head = `<div class="brand reg-brand"><img src="/logo.png" alt="Al-Iman logo"><div>${esc(info.schoolName)}<small>Registration ${esc(info.academicYear || "")}</small></div></div>`;

  if (!info.open) {
    app.innerHTML = `<div class="center-screen auth-bg"><div class="auth-card">${head}
      <h2>Registration is closed</h2>
      <p class="muted">Online registration isn't open right now.${info.contactPhone ? ` Please call the school office at <a href="tel:${esc(info.contactPhone)}">${esc(info.contactPhone)}</a>.` : " Please contact the school office."}</p>
      <p class="small"><a href="/">Back to sign in</a></p></div></div>`;
    return;
  }

  app.innerHTML = `<div class="reg-page auth-bg"><form class="card reg-card" id="reg" novalidate>
    ${head}
    <h1>Register for ${esc(info.academicYear || "the new school year")}</h1>
    <p class="muted">For new students and for children returning next year. Fill in one form per family, adding each child below. The school office will review it and contact you.</p>
    ${info.registrationNote ? `<div class="reg-note note-text">${esc(info.registrationNote)}</div>` : ""}

    <fieldset><legend>Children</legend><div id="kids"></div>
      <button type="button" class="btn secondary sm" id="add-kid">+ Add another child</button><p></p></fieldset>

    <fieldset><legend>Parents</legend><p class="muted small">Please give at least one parent's name and phone number. We use the phone for WhatsApp messages from the school.</p>
      <div class="form-grid">
        ${f("fatherName", "Father's full name")}${f("fatherPhone", "Father's phone", "tel")}${f("fatherEmail", "Father's email", "email")}
        ${f("motherName", "Mother's full name")}${f("motherPhone", "Mother's phone", "tel")}${f("motherEmail", "Mother's email", "email")}
        ${f("guardianName", "Guardian (if not a parent)")}${f("guardianPhone", "Guardian's phone", "tel")}
      </div>
      ${f("address", "Home address")}</fieldset>

    <fieldset><legend>Safety</legend><div class="form-grid">
      ${f("emergencyContact", "Emergency contact (not a parent)")}${f("emergencyPhone", "Emergency phone", "tel")}
      ${f("pickupAuthorized", "Who else may pick up the children?")}</div>
      <label class="check"><input type="checkbox" name="photoConsent"> The school may take photos of my children for school use</label><p></p></fieldset>

    <div class="field"><label>Anything else the school should know?</label><textarea name="comments" rows="3"></textarea></div>
    <div class="reg-hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label class="check"><input type="checkbox" name="agree"> I confirm these details are correct.</label>
    <p></p>
    <button class="btn" type="submit" style="width:100%">Send registration</button>
    <p class="small muted" style="text-align:center">Already registered? <a href="/">Sign in</a></p>
  </form></div>`;

  const form = app.querySelector("#reg");
  const kids = form.querySelector("#kids");
  const addKid = () => {
    const n = kids.children.length;
    if (n >= MAX_CHILDREN) return toast(`You can add up to ${MAX_CHILDREN} children on one form.`, "error");
    kids.insertAdjacentHTML("beforeend", childBlock(n, info.grades));
    renumber();
  };
  const renumber = () => [...kids.children].forEach((el, i) => {
    el.querySelector(".kid-title").textContent = `Child ${i + 1}`;
    el.querySelector("[data-remove]").hidden = kids.children.length === 1;
  });
  kids.addEventListener("click", (e) => {
    if (e.target.closest("[data-remove]")) { e.target.closest(".reg-kid").remove(); renumber(); }
  });
  form.querySelector("#add-kid").onclick = addKid;
  addKid();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    const v = formValues(form);
    const children = [...kids.querySelectorAll(".reg-kid")].map((el) => {
      const c = {};
      el.querySelectorAll("[data-k]").forEach((i) => { c[i.dataset.k] = i.type === "checkbox" ? i.checked : i.value.trim(); });
      return c;
    }).filter((c) => c.firstName || c.lastName);
    const problem = !children.length ? "Add at least one child's name."
      : children.some((c) => !c.firstName || !c.lastName || !c.grade) ? "Each child needs a first name, last name and grade."
      : !(v.fatherName || v.motherName || v.guardianName) ? "Enter at least one parent's name."
      : ![v.fatherPhone, v.motherPhone, v.guardianPhone].some((p) => p.replace(/\D/g, "").length >= 7) ? "Enter at least one parent phone number."
      : !v.agree ? "Please tick the box to confirm the details are correct." : "";
    if (problem) return toast(problem, "error");
    btn.disabled = true;
    try {
      const { website, agree, photoConsent, ...family } = v;
      const res = await api("POST", "/register", { family, children, photoConsent, agree, website });
      window.scrollTo(0, 0);
      app.innerHTML = `<div class="center-screen auth-bg"><div class="auth-card">${head}
        <h2>JazakAllahu khayran!</h2>
        <p>We've received your registration for ${children.map((c) => esc(c.firstName)).join(", ")}.</p>
        <p class="muted">Your reference is <strong>${esc(res.ref)}</strong>. The school office will review it and contact you on WhatsApp or by phone.</p>
        <p class="small"><a href="/">Go to sign in</a></p></div></div>`;
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  });
}

const f = (name, label, type = "text") => `<div class="field"><label>${label}</label><input type="${type}" name="${name}"></div>`;

function childBlock(i, grades) {
  const k = (key, label, type = "text") => `<div class="field"><label>${label}</label><input type="${type}" data-k="${key}"></div>`;
  return `<div class="reg-kid"><div class="btn-row" style="justify-content:space-between"><h3 class="kid-title">Child ${i + 1}</h3>
      <button type="button" class="btn link small" data-remove>Remove</button></div>
    <div class="form-grid">
      ${k("firstName", "First name")}${k("lastName", "Last name")}
      <div class="field"><label>Gender</label><select data-k="gender"><option value=""></option><option>Male</option><option>Female</option></select></div>
      ${k("dob", "Date of birth", "date")}
      <div class="field"><label>Grade for this year</label><select data-k="grade"><option value=""></option>${grades.map((g) => `<option>${esc(g)}</option>`).join("")}<option>Not sure</option></select></div>
      ${k("allergies", "Allergies")}
    </div>
    ${k("medical", "Medical needs the teacher should know")}
    <label class="check"><input type="checkbox" data-k="returning"> Attended Al-Iman last year</label><p></p></div>`;
}
