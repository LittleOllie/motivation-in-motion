/**
 * Groups: create, join by code, list. Join codes expire after 7 days.
 * Firestore: groups/{groupId}, groups/{groupId}/members/{userId}
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { getJoinUrl, generateJoinCode, joinCodeExpiresAt, escapeHtml, escapeAttr, renderAvatar } from "./utils.js";

let currentUser = null;

function showError(msg) {
  const el = document.getElementById("groupsError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function clearError() {
  const el = document.getElementById("groupsError");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

function init() {
  const createGroupBtn = document.getElementById("createGroupBtn");
  const joinGroupForm = document.getElementById("joinGroupForm");
  const joinCodeInput = document.getElementById("joinCodeInput");
  const groupsList = document.getElementById("groupsList");
  const groupModal = document.getElementById("groupModal");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const regenerateCodeBtn = document.getElementById("regenerateCodeBtn");

  if (!createGroupBtn || !joinGroupForm || !groupsList) return;

  groupsList.innerHTML = "<p class=\"muted-text\">Loading groups…</p>";

  if (groupModal) {
    groupModal.hidden = true;
    groupModal.setAttribute("aria-hidden", "true");
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;
    loadMyGroups();
  });

  const urlParams = new URLSearchParams(window.location.search);
  const joinParam = urlParams.get("join");
  if (joinParam && joinCodeInput) {
    joinCodeInput.value = String(joinParam).toUpperCase().slice(0, 6);
  }

  createGroupBtn.addEventListener("click", async () => {
    clearError();
    const name = window.prompt("Group name");
    if (!name || !name.trim()) return;
    const groupName = name.trim();
    const code = generateJoinCode();
    const expires = joinCodeExpiresAt();
    try {
      let userName = currentUser.displayName || currentUser.email || "Someone";
      const userSnap = await getDoc(doc(db, "users", currentUser.uid));
      if (userSnap.exists()) {
        const d = userSnap.data();
        userName = d.displayName || d.name || userName;
      }
      const groupRef = await addDoc(collection(db, "groups"), {
        name: groupName,
        owner: currentUser.uid,
        joinCode: code,
        joinCodeExpires: expires,
        createdAt: serverTimestamp(),
      });
      const groupId = groupRef.id;
      await setDoc(doc(db, "groups", groupId, "members", currentUser.uid), {
        name: userName,
        joinedAt: serverTimestamp(),
        role: "owner",
      });
      await addDoc(collection(db, "groups", groupId, "activity"), {
        type: "join",
        userName,
        message: "created the group",
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
      });
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, { groupIds: arrayUnion(groupId) });
      loadMyGroups();
      openGroupModal(groupId, groupName, code, expires);
    } catch (err) {
      console.error("[Groups] Create error", err);
      showError(err.message || "Could not create group.");
    }
  });

  joinGroupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const code = (joinCodeInput.value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) {
      showError("Please enter a 6-character code.");
      return;
    }
    const joinBtn = document.getElementById("joinGroupBtn");
    if (joinBtn) joinBtn.disabled = true;
    try {
      const q = query(collection(db, "groups"), where("joinCode", "==", code));
      const snap = await getDocs(q);
      if (snap.empty) {
        showError("No group found with that code.");
        return;
      }
      const groupDoc = snap.docs[0];
      const groupId = groupDoc.id;
      const data = groupDoc.data();
      const expires = data.joinCodeExpires;
      const now = Timestamp.now();
      if (expires && expires.toMillis && expires.toMillis() < now.toMillis()) {
        showError("This invite code has expired.");
        return;
      }
      let userName = currentUser.displayName || currentUser.email || "Someone";
      const userSnap = await getDoc(doc(db, "users", currentUser.uid));
      if (userSnap.exists()) {
        const d = userSnap.data();
        userName = d.displayName || d.name || userName;
      }
      await setDoc(doc(db, "groups", groupId, "members", currentUser.uid), {
        name: userName,
        joinedAt: serverTimestamp(),
        role: "member",
      });
      await addDoc(collection(db, "groups", groupId, "activity"), {
        type: "join",
        userName,
        message: "joined the group",
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
      });
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, { groupIds: arrayUnion(groupId) });
      joinCodeInput.value = "";
      loadMyGroups();
      clearError();
    } catch (err) {
      console.error("[Groups] Join error", err);
      showError(err.message || "Could not join group.");
    } finally {
      if (joinBtn) joinBtn.disabled = false;
    }
  });

  async function loadMyGroups() {
    if (!currentUser) return;
    groupsList.innerHTML = "<p class=\"muted-text\">Loading groups…</p>";
    try {
      const userSnap = await getDoc(doc(db, "users", currentUser.uid));
      const groupIds = (userSnap.exists() && userSnap.data().groupIds) || [];
      if (groupIds.length === 0) {
        groupsList.innerHTML = "<p class=\"muted-text\">You’re not in any groups yet. Create one or join with a code.</p>";
        return;
      }
      groupsList.innerHTML = "";
      for (const gid of groupIds) {
        const gSnap = await getDoc(doc(db, "groups", gid));
        if (!gSnap.exists()) continue;
        const g = gSnap.data();
        const isOwner = g.owner === currentUser.uid;
        const memberSnap = await getDoc(doc(db, "groups", gid, "members", currentUser.uid));
        const role = memberSnap.exists() ? (memberSnap.data().role || (isOwner ? "owner" : "member")) : "member";
        const membersSnap = await getDocs(collection(db, "groups", gid, "members"));
        const memberCount = membersSnap.size;
        const roleBadge = isOwner ? ' <span class="role-badge role-badge--owner">OWNER</span>' : (role === "admin" ? ' <span class="role-badge role-badge--admin">ADMIN</span>' : "");
        const card = document.createElement("div");
        card.className = "groups-list-item group-card";
        const avatarWrap = document.createElement("div");
        avatarWrap.className = "group-card-avatar";
        renderAvatar(avatarWrap, g.photoURL || null, g.name || "Group", "sm");
        const info = document.createElement("div");
        info.className = "group-card-info";
        const nameLine = document.createElement("div");
        nameLine.className = "group-card-name-line";
        nameLine.innerHTML = `<a href="group.html?id=${escapeAttr(gid)}" class="groups-list-link">${escapeHtml(g.name || "Group")}</a>${roleBadge}`;
        const countEl = document.createElement("span");
        countEl.className = "muted-text small-text";
        countEl.textContent = memberCount + " member" + (memberCount !== 1 ? "s" : "");
        info.appendChild(nameLine);
        info.appendChild(countEl);
        const expiresText = g.joinCodeExpires && g.joinCodeExpires.toMillis
          ? new Date(g.joinCodeExpires.toMillis()).toLocaleDateString()
          : "";
        const codeEl = document.createElement("span");
        codeEl.className = "muted-text small-text group-card-code";
        codeEl.textContent = "Code: " + (g.joinCode || "—") + (expiresText ? " · Expires " + expiresText : "");
        info.appendChild(codeEl);
        const actions = document.createElement("div");
        actions.className = "groups-list-actions";
        const openLink = document.createElement("a");
        openLink.href = "group.html?id=" + encodeURIComponent(gid);
        openLink.className = "button-primary button-small";
        openLink.textContent = "Open";
        actions.appendChild(openLink);
        if (isOwner || role === "admin") {
          const inviteBtn = document.createElement("button");
          inviteBtn.type = "button";
          inviteBtn.className = "button-secondary button-small groups-list-action";
          inviteBtn.dataset.groupId = gid;
          inviteBtn.dataset.groupName = g.name || "";
          inviteBtn.dataset.joinCode = g.joinCode || "";
          inviteBtn.dataset.expires = g.joinCodeExpires ? String(g.joinCodeExpires.toMillis()) : "";
          inviteBtn.textContent = "Invite";
          actions.appendChild(inviteBtn);
        }
        card.appendChild(avatarWrap);
        card.appendChild(info);
        card.appendChild(actions);
        groupsList.appendChild(card);
      }
    } catch (err) {
      console.error("[Groups] Load error", err);
      groupsList.innerHTML = "<p class=\"muted-text\">Could not load groups.</p>";
    }
  }

  groupsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".groups-list-action");
    if (!btn) return;
    const gid = btn.dataset.groupId;
    const name = btn.dataset.groupName || "";
    const code = btn.dataset.joinCode || "";
    const exp = btn.dataset.expires ? Timestamp.fromMillis(Number(btn.dataset.expires)) : null;
    openGroupModal(gid, name, code, exp);
  });

  let currentModalGroupId = null;

  function openGroupModal(groupId, groupName, joinCode, expires) {
    if (!groupId || !joinCode) return;
    currentModalGroupId = groupId;
    const modal = document.getElementById("groupModal");
    const nameEl = document.getElementById("modalGroupName");
    const codeEl = document.getElementById("modalJoinCode");
    const expiresEl = document.getElementById("modalExpires");
    const qrContainer = document.getElementById("modalQrContainer");
    const urlEl = document.getElementById("modalJoinUrl");
    const regenBtn = document.getElementById("regenerateCodeBtn");
    if (!modal || !nameEl || !codeEl) return;
    nameEl.textContent = groupName || "Group";
    codeEl.textContent = joinCode;
    expiresEl.textContent = expires && expires.toMillis
      ? "Code expires " + new Date(expires.toMillis()).toLocaleString()
      : "";
    const joinUrl = getJoinUrl(joinCode);
    if (urlEl) urlEl.textContent = joinUrl;
    qrContainer.innerHTML = "";
    if (window.QRCode) {
      try {
        new window.QRCode(qrContainer, { text: joinUrl, width: 160, height: 160 });
      } catch (err) {
        qrContainer.textContent = "QR unavailable";
      }
    }
    if (regenBtn) regenBtn.style.display = "";
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const modal = document.getElementById("groupModal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    currentModalGroupId = null;
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
  const backdrop = document.querySelector(".modal-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeModal);

  if (regenerateCodeBtn) {
    regenerateCodeBtn.addEventListener("click", async () => {
      if (!currentModalGroupId || !currentUser) return;
      const groupRef = doc(db, "groups", currentModalGroupId);
      const snap = await getDoc(groupRef);
      if (!snap.exists() || snap.data().owner !== currentUser.uid) return;
      const newCode = generateJoinCode();
      const newExpires = joinCodeExpiresAt();
      await updateDoc(groupRef, { joinCode: newCode, joinCodeExpires: newExpires });
      const nameEl = document.getElementById("modalGroupName");
      openGroupModal(currentModalGroupId, nameEl ? nameEl.textContent : "", newCode, newExpires);
      loadMyGroups();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
