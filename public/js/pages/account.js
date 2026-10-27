import { state, api, esc, toast, onSubmit, setToken } from "../core.js";

export async function render(page) {
  page.innerHTML = `<h1>My account</h1>
    <div class="card" style="max-width:480px"><p><strong>${esc(state.user.name)}</strong><br><span class="muted">Username: ${esc(state.user.username)}</span></p>
    <form><h2>Change password</h2>
      <div class="field"><label>Current password</label><input type="password" name="current" autocomplete="current-password" required></div>
      <div class="field"><label>New password (8+ characters)</label><input type="password" name="next" minlength="8" autocomplete="new-password" required></div>
      <button class="btn" type="submit">Change password</button></form></div>`;
  onSubmit(page.querySelector("form"), async (v) => {
    const { token } = await api("POST", "/auth/password", v);
    setToken(token);
    page.querySelector("form").reset();
    toast("Password changed");
  });
}
