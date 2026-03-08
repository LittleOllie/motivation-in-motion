/**
 * Dashboard (index) for Motivation in Motion.
 * Protects route: redirect to login if not authenticated; shows Welcome {username}.
 */
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
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

    const dashboardGroupsList = document.getElementById("dashboardGroupsList");
    if (dashboardGroupsList) {
      try {
        const profile = await getAuthState().getUserProfile();
        const groupIds = (profile && profile.groupIds) || [];
        const firstThree = groupIds.slice(0, 3);
        if (firstThree.length === 0) {
          dashboardGroupsList.innerHTML = "<p class=\"muted-text\">You’re not in any groups yet.</p>";
        } else {
          dashboardGroupsList.innerHTML = "";
          for (const gid of firstThree) {
            const gSnap = await getDoc(doc(db, "groups", gid));
            if (!gSnap.exists()) continue;
            const g = gSnap.data();
            const membersSnap = await getDocs(collection(db, "groups", gid, "members"));
            const memberCount = membersSnap.size;
            const card = document.createElement("div");
            card.className = "group-card dashboard-group-card";
            const avatarWrap = document.createElement("div");
            renderAvatar(avatarWrap, g.photoURL || null, g.name || "Group", "sm");
            avatarWrap.classList.add("group-card-avatar");
            const info = document.createElement("div");
            info.className = "group-card-info";
            const nameEl = document.createElement("span");
            nameEl.className = "group-card-name";
            nameEl.textContent = g.name || "Group";
            const countEl = document.createElement("span");
            countEl.className = "muted-text small-text";
            countEl.textContent = memberCount + " member" + (memberCount !== 1 ? "s" : "");
            info.appendChild(nameEl);
            info.appendChild(countEl);
            const openBtn = document.createElement("a");
            openBtn.href = "group.html?id=" + encodeURIComponent(gid);
            openBtn.className = "button-primary button-small";
            openBtn.textContent = "Open Group";
            card.appendChild(avatarWrap);
            card.appendChild(info);
            card.appendChild(openBtn);
            dashboardGroupsList.appendChild(card);
          }
        }
      } catch (e) {
        if (dashboardGroupsList) dashboardGroupsList.innerHTML = "<p class=\"muted-text\">Could not load groups.</p>";
      }
    }
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
