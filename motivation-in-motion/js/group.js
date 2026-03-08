/**
 * Single group page: name, members, leaderboard, activity, invite (QR + code).
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { getJoinUrl, generateJoinCode, joinCodeExpiresAt, getWeekStart, escapeHtml, renderAvatar } from "./utils.js";

let currentUser = null;
let currentGroupId = null;
let currentGroup = null;
let isOwner = false;

function showError(msg) {
  const el = document.getElementById("groupError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const groupId = params.get("id");
  if (!groupId) {
    window.location.href = "groups.html";
    return;
  }
  currentGroupId = groupId;

  const inviteModal = document.getElementById("inviteModal");
  if (inviteModal) {
    inviteModal.hidden = true;
    inviteModal.setAttribute("aria-hidden", "true");
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;
    await loadGroup();
  });

  document.getElementById("inviteBtn")?.addEventListener("click", () => {
    if (!currentGroup || !currentGroup.joinCode) return;
    openInviteModal(currentGroup.joinCode, currentGroup.joinCodeExpires);
  });

  document.getElementById("modalCloseBtn")?.addEventListener("click", closeInviteModal);
  document.querySelector("#inviteModal .modal-backdrop")?.addEventListener("click", closeInviteModal);

  document.getElementById("regenerateCodeBtn")?.addEventListener("click", async () => {
    if (!currentGroupId || !currentUser || !isOwner) return;
    const groupRef = doc(db, "groups", currentGroupId);
    const snap = await getDoc(groupRef);
    if (!snap.exists() || snap.data().owner !== currentUser.uid) return;
    const newCode = generateJoinCode();
    const newExpires = joinCodeExpiresAt();
    await updateDoc(groupRef, { joinCode: newCode, joinCodeExpires: newExpires });
    currentGroup = { ...currentGroup, joinCode: newCode, joinCodeExpires: newExpires };
    openInviteModal(newCode, newExpires);
    document.getElementById("groupJoinCode").textContent = newCode;
  });

  document.getElementById("membersList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove-member]");
    if (!btn || !isOwner) return;
    const uid = btn.dataset.removeMember;
    if (uid === currentUser.uid) return;
    if (!confirm("Remove this member from the group?")) return;
    try {
      await deleteDoc(doc(db, "groups", currentGroupId, "members", uid));
      await loadGroup();
    } catch (err) {
      showError(err.message || "Could not remove member.");
    }
  });
}

async function loadGroup() {
  if (!currentUser || !currentGroupId) return;
  const groupRef = doc(db, "groups", currentGroupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) {
    showError("Group not found.");
    return;
  }
  currentGroup = groupSnap.data();
  currentGroup.id = currentGroupId;
  isOwner = currentGroup.owner === currentUser.uid;

  const memberSnap = await getDoc(doc(db, "groups", currentGroupId, "members", currentUser.uid));
  if (!memberSnap.exists()) {
    await updateDoc(doc(db, "users", currentUser.uid), { groupIds: arrayRemove(currentGroupId) });
    window.location.href = "groups.html";
    return;
  }

  document.getElementById("groupTitle").textContent = currentGroup.name || "Group";
  document.getElementById("groupName").textContent = currentGroup.name || "Group";
  document.getElementById("groupJoinCode").textContent = currentGroup.joinCode || "—";
  const inviteBtn = document.getElementById("inviteBtn");
  if (inviteBtn) inviteBtn.style.display = isOwner ? "" : "none";

  const membersSnap = await getDocs(collection(db, "groups", currentGroupId, "members"));
  const members = [];
  membersSnap.forEach((d) => members.push({ id: d.id, ...d.data() }));
  const ownerId = currentGroup.owner;
  members.sort((a, b) => ((a.role === "owner" || a.id === ownerId) ? -1 : 0) - ((b.role === "owner" || b.id === ownerId) ? -1 : 0));
  document.getElementById("memberCount").textContent = members.length + " member" + (members.length !== 1 ? "s" : "");

  const userSnaps = await Promise.all(members.map((m) => getDoc(doc(db, "users", m.id))));
  const userCache = new Map();
  members.forEach((m, i) => {
    const u = userSnaps[i].exists() ? userSnaps[i].data() : {};
    m.photoURL = u.photoURL || null;
    m.displayName = u.displayName || u.name || m.name || "Member";
    userCache.set(m.id, { photoURL: m.photoURL, displayName: m.displayName });
  });
  const listEl = document.getElementById("membersList");
  listEl.innerHTML = "";
  members.forEach((m) => {
    const isOwnerMember = m.role === "owner" || m.id === ownerId;
    const canRemove = isOwner && m.id !== currentUser.uid && !isOwnerMember;
    const name = m.displayName || m.name || "Member";
    const li = document.createElement("li");
    li.className = "group-member-item";
    const avatar = document.createElement("div");
    renderAvatar(avatar, m.photoURL, name, "sm");
    const nameSpan = document.createElement("span");
    nameSpan.className = "group-member-name";
    nameSpan.innerHTML =
      escapeHtml(name) +
      (isOwnerMember ? ' <span class="groups-list-badge">Owner</span>' : "") +
      (canRemove ? ` <button type="button" class="button-small button-ghost" data-remove-member="${m.id}" aria-label="Remove member">Remove</button>` : "");
    li.appendChild(avatar);
    li.appendChild(nameSpan);
    listEl.appendChild(li);
  });

  const weekStart = getWeekStart();
  const statsSnap = await getDocs(collection(db, "groups", currentGroupId, "memberStats"));
  const statsByUser = {};
  statsSnap.forEach((d) => {
    const d_ = d.data();
    if (d_.weekStart === weekStart) statsByUser[d.id] = d_.checkinsThisWeek || 0;
  });
  const leaderboard = members
    .map((m) => ({ name: m.displayName || m.name || "Member", id: m.id, count: statsByUser[m.id] || 0 }))
    .sort((a, b) => b.count - a.count);
  const leaderEl = document.getElementById("leaderboardList");
  leaderEl.innerHTML = "";
  leaderboard.forEach((entry, i) => {
    const cached = userCache.get(entry.id);
    const photoURL = cached ? cached.photoURL : null;
    const li = document.createElement("li");
    li.className = "group-leaderboard-item";
    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(i + 1);
    const avatar = document.createElement("div");
    renderAvatar(avatar, photoURL, entry.name, "sm");
    const text = document.createElement("span");
    text.textContent = ` ${entry.name} — ${entry.count} check-in${entry.count !== 1 ? "s" : ""}`;
    li.appendChild(rank);
    li.appendChild(avatar);
    li.appendChild(text);
    leaderEl.appendChild(li);
  });

  const activitySnap = await getDocs(collection(db, "groups", currentGroupId, "activity"));
  const activities = [];
  activitySnap.forEach((d) => activities.push({ id: d.id, ...d.data(), _createdAt: d.data().createdAt }));
  activities.sort((a, b) => {
    const ta = a._createdAt && a._createdAt.toMillis ? a._createdAt.toMillis() : 0;
    const tb = b._createdAt && b._createdAt.toMillis ? b._createdAt.toMillis() : 0;
    return tb - ta;
  });
  const activityEl = document.getElementById("activityList");
  activityEl.innerHTML = "";
  if (activities.length === 0) {
    activityEl.innerHTML = "<li class=\"muted-text\">No activity yet.</li>";
  } else {
    activities.slice(0, 30).forEach((a) => {
      const li = document.createElement("li");
      li.className = "group-activity-item";
      const userName = a.userName || "Someone";
      let text = userName + " " + (a.message || "");
      if (a.type === "habits") text = userName + " completed " + (a.count || 0) + " habit" + ((a.count || 0) !== 1 ? "s" : "") + " 🔥";
      if (a.type === "streak") text = userName + " hit a " + (a.count || 0) + " day streak 🏆";
      if (a.type === "identity") text = userName + " reinforced \"" + (a.identity || "") + "\" ✔";
      if (a.type === "join") text = userName + " " + (a.message || "joined");
      li.textContent = text;
      activityEl.appendChild(li);
    });
  }
}

function openInviteModal(code, expires) {
  const modal = document.getElementById("inviteModal");
  if (!modal || !code) return;
  document.getElementById("modalJoinCode").textContent = code;
  document.getElementById("modalExpires").textContent =
    expires && expires.toMillis ? "Expires " + new Date(expires.toMillis()).toLocaleString() : "";
  const url = getJoinUrl(code);
  document.getElementById("modalJoinUrl").textContent = url;
  const qrContainer = document.getElementById("modalQrContainer");
  qrContainer.innerHTML = "";
  if (window.QRCode) {
    try {
      new window.QRCode(qrContainer, { text: url, width: 160, height: 160 });
    } catch (err) {
      qrContainer.textContent = "QR unavailable";
    }
  }
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
}

function closeInviteModal() {
  const modal = document.getElementById("inviteModal");
  if (modal) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
