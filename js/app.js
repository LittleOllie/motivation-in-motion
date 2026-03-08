/**
 * Dashboard (index) for Motivation in Motion.
 * Protects route: redirect to login if not authenticated; shows Welcome {username}.
 */
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { renderAvatar } from "./utils.js";
import { getAuthState, subscribeAuth } from "./auth-state.js";

function initDashboard() {
  const welcomeEl = document.getElementById("welcomeMessage");
  const logoutBtn = document.getElementById("logoutBtn");
  const streakEl = document.getElementById("streakCount");
  const shieldEl = document.getElementById("shieldCount");
  const avatarEl = document.getElementById("dashboardAvatar");

  if (streakEl) streakEl.textContent = "—";
  if (shieldEl) shieldEl.textContent = "—";
  if (avatarEl) avatarEl.textContent = "…";

  subscribeAuth(async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    let displayName = user.displayName || user.email || "User";

    try {
      const profile = await getAuthState().getUserProfile();
      if (profile) {
        displayName = profile.displayName || profile.name || profile.email || displayName;
        const streak = Number(profile.currentStreak) || 0;
        const shields = Number(profile.streakShields) || 0;
        if (streakEl) streakEl.textContent = String(streak);
        if (shieldEl) shieldEl.textContent = String(shields);
        if (avatarEl) renderAvatar(avatarEl, profile.photoURL || null, displayName, "lg");
      } else {
        if (streakEl) streakEl.textContent = "0";
        if (shieldEl) shieldEl.textContent = "0";
        if (avatarEl) renderAvatar(avatarEl, null, displayName, "lg");
      }
    } catch (err) {
      console.error("Error loading user data:", err);
      if (streakEl) streakEl.textContent = "0";
      if (shieldEl) shieldEl.textContent = "0";
      if (avatarEl) renderAvatar(avatarEl, null, displayName, "lg");
    }

    if (welcomeEl) welcomeEl.textContent = `Welcome ${displayName}`;
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "login.html";
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboard);
} else {
  initDashboard();
}
