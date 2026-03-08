/**
 * Member profile page: show user avatar, name, stats (streak, group checkins), recent activity in group.
 * URL: member.html?uid={userId}&groupId={groupId}
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { renderAvatar } from "./utils.js";

const ACTIVITY_LIMIT = 10;

function showError(msg) {
  const el = document.getElementById("memberError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function formatActivityMessage(a) {
  const msg = a.message || "";
  if (a.type === "habits") return "completed " + (a.count || 0) + " habit" + ((a.count || 0) !== 1 ? "s" : "") + " 🔥";
  if (a.type === "streak") return "hit a " + (a.count || 0) + " day streak 🏆";
  if (a.type === "identity") return "reinforced \"" + (a.identity || "") + "\" ✔";
  if (a.type === "join") return msg || "joined";
  return msg;
}

async function loadMemberProfile(uid, groupId) {
  const backLink = document.getElementById("backLink");
  if (backLink && groupId) backLink.href = "group.html?id=" + encodeURIComponent(groupId);

  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) {
    showError("Member not found.");
    return;
  }
  const user = userSnap.data();
  const displayName = user.displayName || user.name || user.email || "Member";
  const photoURL = user.photoURL || null;
  const currentStreak = Number(user.currentStreak) || 0;
  const longestStreak = Number(user.longestStreak) || 0;

  document.getElementById("memberTitle").textContent = displayName;
  document.getElementById("memberName").textContent = displayName;
  const avatarEl = document.getElementById("memberAvatar");
  if (avatarEl) renderAvatar(avatarEl, photoURL, displayName, "lg");

  const statsEl = document.getElementById("memberStats");
  if (statsEl) {
    let checkinsThisWeek = "";
    if (groupId) {
      const statsSnap = await getDoc(doc(db, "groups", groupId, "memberStats", uid));
      const stats = statsSnap.exists() ? statsSnap.data() : {};
      checkinsThisWeek = String(stats.checkinsThisWeek ?? "—");
    } else {
      checkinsThisWeek = "—";
    }
    statsEl.innerHTML =
      "<li><strong>Current streak</strong> " + currentStreak + " day" + (currentStreak !== 1 ? "s" : "") + "</li>" +
      "<li><strong>Longest streak</strong> " + longestStreak + " day" + (longestStreak !== 1 ? "s" : "") + "</li>" +
      (groupId ? "<li><strong>Check-ins this week</strong> " + checkinsThisWeek + "</li>" : "");
  }

  const activityEl = document.getElementById("memberActivity");
  if (!activityEl) return;
  activityEl.innerHTML = "";

  if (!groupId) {
    activityEl.innerHTML = "<li class=\"muted-text\">Join a group to see activity.</li>";
    return;
  }

  try {
    const activityRef = collection(db, "groups", groupId, "activity");
    const q = query(activityRef, orderBy("createdAt", "desc"), limit(100));
    const snap = await getDocs(q);
    const forUser = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.createdBy === uid) forUser.push({ id: d.id, ...data, _createdAt: data.createdAt });
    });
    const recent = forUser.slice(0, ACTIVITY_LIMIT);
    if (recent.length === 0) {
      activityEl.innerHTML = "<li class=\"muted-text\">No recent activity in this group.</li>";
    } else {
      recent.forEach((a) => {
        const li = document.createElement("li");
        li.className = "group-activity-item";
        li.textContent = formatActivityMessage(a);
        activityEl.appendChild(li);
      });
    }
  } catch (err) {
    console.error("[Member] load activity error", err);
    activityEl.innerHTML = "<li class=\"muted-text\">Could not load activity.</li>";
  }
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("uid");
  const groupId = params.get("groupId") || "";

  if (!uid) {
    window.location.href = "groups.html";
    return;
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    loadMemberProfile(uid, groupId);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
