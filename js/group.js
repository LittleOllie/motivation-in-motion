/**
 * Single group page: name, members, leaderboard, activity, invite (QR + code), group settings, roles.
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { getJoinUrl, generateJoinCode, joinCodeExpiresAt, getWeekStart, escapeHtml, escapeAttr, renderAvatar } from "./utils.js";
import { IMGBB_API_KEY } from "./firebase-config.js";

const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";
const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 800;

let currentUser = null;
let currentGroupId = null;
let currentGroup = null;
let isOwner = false;
let isAdmin = false;
let myRole = "member";

function showError(msg) {
  const el = document.getElementById("groupError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = typeof result === "string" && result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function resizeImageToBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not resize"))),
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Invalid image"));
    };
    img.src = url;
  });
}

async function uploadGroupPhotoToImgBB(file) {
  let toUpload = file;
  if (file.size > MAX_SIZE_BYTES) {
    const resized = await resizeImageToBlob(file);
    toUpload = new File([resized], "image.jpg", { type: "image/jpeg" });
  } else if (file.type !== "image/jpeg" && file.type !== "image/png") {
    toUpload = new File([await resizeImageToBlob(file)], "image.jpg", { type: "image/jpeg" });
  }
  const base64 = await fileToBase64(toUpload);
  const form = new FormData();
  form.append("key", IMGBB_API_KEY);
  form.append("image", base64);
  const res = await fetch(IMGBB_UPLOAD_URL, { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok || !json.data || !json.data.url) throw new Error("Upload failed. Please try again.");
  return json.data.url;
}

function getRoleBadgeClass(role) {
  if (role === "owner") return "role-badge role-badge--owner";
  if (role === "admin") return "role-badge role-badge--admin";
  return "role-badge role-badge--member";
}

function getRoleLabel(role) {
  if (role === "owner") return "OWNER";
  if (role === "admin") return "ADMIN";
  return "MEMBER";
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

  const groupPhotoInput = document.getElementById("groupPhotoInput");
  const triggerGroupPhotoInput = () => groupPhotoInput?.click();
  document.getElementById("updateGroupPhotoBtn")?.addEventListener("click", triggerGroupPhotoInput);
  document.getElementById("updateGroupPhotoSettingBtn")?.addEventListener("click", triggerGroupPhotoInput);
  groupPhotoInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentGroupId || !isOwner && !isAdmin) return;
    e.target.value = "";
    try {
      const photoURL = await uploadGroupPhotoToImgBB(file);
      await updateDoc(doc(db, "groups", currentGroupId), { photoURL, updatedAt: serverTimestamp() });
      currentGroup = { ...currentGroup, photoURL };
      const groupAvatarEl = document.getElementById("groupAvatar");
      if (groupAvatarEl) renderAvatar(groupAvatarEl, photoURL, currentGroup.name || "Group", "lg");
    } catch (err) {
      showError(err.message || "Upload failed.");
    }
  });

  document.getElementById("updateGroupNameBtn")?.addEventListener("click", async () => {
    if (!currentGroupId || !isOwner && !isAdmin) return;
    const name = window.prompt("New group name", currentGroup?.name || "");
    if (name == null || !name.trim()) return;
    try {
      await updateDoc(doc(db, "groups", currentGroupId), { name: name.trim() });
      currentGroup = { ...currentGroup, name: name.trim() };
      document.getElementById("groupTitle").textContent = name.trim();
      document.getElementById("groupName").textContent = name.trim();
    } catch (err) {
      showError(err.message || "Could not update name.");
    }
  });

  document.getElementById("regenerateCodeSettingBtn")?.addEventListener("click", async () => {
    if (!currentGroupId || !currentUser || !isOwner) return;
    const groupRef = doc(db, "groups", currentGroupId);
    const newCode = generateJoinCode();
    const newExpires = joinCodeExpiresAt();
    await updateDoc(groupRef, { joinCode: newCode, joinCodeExpires: newExpires });
    currentGroup = { ...currentGroup, joinCode: newCode, joinCodeExpires: newExpires };
    document.getElementById("groupJoinCode").textContent = newCode;
    showError(""); // clear any message
  });

  document.getElementById("deleteGroupBtn")?.addEventListener("click", async () => {
    if (!currentGroupId || !currentUser || !isOwner) return;
    if (!confirm("Are you sure you want to delete this group? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "groups", currentGroupId));
      await updateDoc(doc(db, "users", currentUser.uid), { groupIds: arrayRemove(currentGroupId) });
      window.location.href = "groups.html";
    } catch (err) {
      showError(err.message || "Could not delete group.");
    }
  });

  document.getElementById("membersList")?.addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("[data-remove-member]");
    if (removeBtn && (isOwner || isAdmin)) {
      const uid = removeBtn.dataset.removeMember;
      if (uid === currentUser.uid) return;
      if (!confirm("Remove this member from the group?")) return;
      try {
        await deleteDoc(doc(db, "groups", currentGroupId, "members", uid));
        await loadGroup();
      } catch (err) {
        showError(err.message || "Could not remove member.");
      }
      return;
    }
    const promoteBtn = e.target.closest("[data-promote-admin]");
    if (promoteBtn && isOwner) {
      const uid = promoteBtn.dataset.promoteAdmin;
      try {
        await updateDoc(doc(db, "groups", currentGroupId, "members", uid), { role: "admin" });
        await loadGroup();
      } catch (err) {
        showError(err.message || "Could not promote.");
      }
      return;
    }
    const demoteBtn = e.target.closest("[data-demote-member]");
    if (demoteBtn && isOwner) {
      const uid = demoteBtn.dataset.demoteMember;
      try {
        await updateDoc(doc(db, "groups", currentGroupId, "members", uid), { role: "member" });
        await loadGroup();
      } catch (err) {
        showError(err.message || "Could not demote.");
      }
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
  const myMemberData = memberSnap.data();
  myRole = myMemberData.role || (isOwner ? "owner" : "member");
  isAdmin = myRole === "admin" || isOwner;
  if (isOwner) myRole = "owner";

  document.getElementById("groupTitle").textContent = currentGroup.name || "Group";
  document.getElementById("groupName").textContent = currentGroup.name || "Group";
  document.getElementById("groupJoinCode").textContent = currentGroup.joinCode || "—";
  document.getElementById("memberCount").textContent = "";

  const groupAvatarEl = document.getElementById("groupAvatar");
  if (groupAvatarEl) renderAvatar(groupAvatarEl, currentGroup.photoURL || null, currentGroup.name || "Group", "lg");

  const inviteBtn = document.getElementById("inviteBtn");
  if (inviteBtn) inviteBtn.style.display = isOwner || isAdmin ? "" : "none";
  const updateGroupPhotoBtn = document.getElementById("updateGroupPhotoBtn");
  if (updateGroupPhotoBtn) updateGroupPhotoBtn.style.display = isOwner || isAdmin ? "" : "none";
  const groupSettingsSection = document.getElementById("groupSettingsSection");
  if (groupSettingsSection) groupSettingsSection.style.display = isOwner || isAdmin ? "" : "none";
  const deleteGroupBtn = document.getElementById("deleteGroupBtn");
  if (deleteGroupBtn) deleteGroupBtn.style.display = isOwner ? "" : "none";

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
    const role = m.role || (m.id === ownerId ? "owner" : "member");
    const isOwnerMember = role === "owner" || m.id === ownerId;
    const isAdminMember = role === "admin";
    const canRemove = (isOwner || isAdmin) && m.id !== currentUser.uid && !isOwnerMember;
    const canPromoteDemote = isOwner && !isOwnerMember && m.id !== currentUser.uid;
    const name = m.displayName || m.name || "Member";
    const li = document.createElement("li");
    li.className = "group-member-item";
    const avatar = document.createElement("div");
    renderAvatar(avatar, m.photoURL, name, "sm");
    const nameSpan = document.createElement("span");
    nameSpan.className = "group-member-name";
    const badgeSpan = document.createElement("span");
    badgeSpan.className = getRoleBadgeClass(role);
    badgeSpan.textContent = getRoleLabel(role);
    nameSpan.appendChild(document.createTextNode(name + " "));
    nameSpan.appendChild(badgeSpan);
    const actionsSpan = document.createElement("span");
    actionsSpan.className = "group-member-actions";
    if (canPromoteDemote) {
      if (role === "member") {
        const promoteBtn = document.createElement("button");
        promoteBtn.type = "button";
        promoteBtn.className = "button-small button-ghost";
        promoteBtn.dataset.promoteAdmin = m.id;
        promoteBtn.textContent = "Promote to Admin";
        actionsSpan.appendChild(promoteBtn);
      } else if (role === "admin") {
        const demoteBtn = document.createElement("button");
        demoteBtn.type = "button";
        demoteBtn.className = "button-small button-ghost";
        demoteBtn.dataset.demoteMember = m.id;
        demoteBtn.textContent = "Demote to Member";
        actionsSpan.appendChild(demoteBtn);
      }
    }
    if (canRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "button-small button-ghost";
      removeBtn.dataset.removeMember = m.id;
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", "Remove from group");
      actionsSpan.appendChild(removeBtn);
    }
    nameSpan.appendChild(actionsSpan);
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
