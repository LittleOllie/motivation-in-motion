/**
 * Dashboard today's habits: load habits, show checkboxes, track completion in
 * users/{uid}/checkins/{date} with habitsCompleted array.
 */
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { escapeHtml, escapeAttr, getWeekStart } from "./utils.js";
import { subscribeAuth, getAuthState } from "./auth-state.js";

let currentUser = null;
let habits = [];
let completedIds = [];

function getTodayId() {
  return new Date().toISOString().split("T")[0];
}

function getYesterdayId() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

/** Date string YYYY-MM-DD for N days ago (0 = today). */
function getDateId(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function getDayName(dateId) {
  const d = new Date(dateId + "T12:00:00Z");
  return DAY_NAMES[d.getUTCDay()];
}

function getUserRef() {
  if (!currentUser) return null;
  return doc(db, "users", currentUser.uid);
}

/** Update streak and shield display (live when first habit checked). */
function updateStreakUI(count) {
  const el = document.getElementById("streakCount");
  if (el) el.textContent = String(count);
}

function updateShieldsUI(count) {
  const el = document.getElementById("shieldCount");
  if (el) el.textContent = String(count);
}

/** Show identity reinforcement popup when a habit is checked. Disappears after 3s. */
function showIdentityReinforcement(identity) {
  const message = identity && identity.trim()
    ? `✔ You reinforced "${String(identity).trim()}"`
    : "✔ You reinforced a positive habit";
  const popup = document.createElement("div");
  popup.className = "identity-popup";
  popup.setAttribute("role", "status");
  popup.textContent = message;
  document.body.appendChild(popup);
  setTimeout(() => {
    popup.classList.add("identity-popup--out");
    setTimeout(() => popup.remove(), 400);
  }, 2600);
}

function getHabitsRef() {
  if (!currentUser) return null;
  return collection(db, "users", currentUser.uid, "habits");
}

function getCheckinRef() {
  if (!currentUser) return null;
  return doc(db, "users", currentUser.uid, "checkins", getTodayId());
}

function updateProgressText() {
    const el = document.getElementById("progressText");
    if (!el) return;
  
    const total = habits.length;
    const done = completedIds.length;
    const percent = total ? Math.round((done / total) * 100) : 0;
  
    el.textContent = total
      ? `${done} / ${total} completed • ${percent}%`
      : "Add habits to track your progress.";
  
    const progressFill = document.getElementById("progressFill");
  
    if (progressFill) {
      progressFill.style.width = percent + "%";
    }
  }

/** Load last 7 days and render weekly chain. Filled if checkin exists and habitsCompleted.length > 0. */
async function loadAndRenderWeeklyChain() {
  const container = document.getElementById("weeklyChain");
  if (!container || !currentUser) return;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dateId = getDateId(i);
    days.push({ dateId, dayName: getDayName(dateId), filled: false });
  }
  const checkinRefs = days.map((d) => doc(db, "users", currentUser.uid, "checkins", d.dateId));
  const snaps = await Promise.all(checkinRefs.map((ref) => getDoc(ref)));
  snaps.forEach((snap, idx) => {
    const data = snap.exists() ? snap.data() : {};
    const completed = Array.isArray(data.habitsCompleted) ? data.habitsCompleted : [];
    days[idx].filled = completed.length > 0;
  });
  container.innerHTML = "";
  const dayRow = document.createElement("div");
  dayRow.className = "weekly-chain-row weekly-chain-days";
  const squareRow = document.createElement("div");
  squareRow.className = "weekly-chain-row weekly-chain-squares";
  days.forEach((d) => {
    const dayCell = document.createElement("span");
    dayCell.className = "weekly-chain-cell weekly-chain-day";
    dayCell.textContent = d.dayName;
    dayRow.appendChild(dayCell);
    const squareCell = document.createElement("span");
    squareCell.className = "weekly-chain-cell weekly-chain-square" + (d.filled ? " weekly-chain-square--filled" : "");
    squareCell.setAttribute("aria-label", d.filled ? `${d.dayName}: completed` : `${d.dayName}: not completed`);
    squareCell.textContent = d.filled ? "■" : "□";
    squareRow.appendChild(squareCell);
  });
  container.appendChild(dayRow);
  container.appendChild(squareRow);
}

function render() {
  const container = document.getElementById("todayHabits");
  if (!container) return;
  container.innerHTML = "";
  if (!habits.length) {
    container.innerHTML =
      '<p class="today-habits-empty">No habits yet. <a href="habits.html">Add habits</a> to get started.</p>';
    updateProgressText();
    return;
  }
  habits.forEach((habit) => {
    const checked = completedIds.includes(habit.id);
    const row = document.createElement("div");
    row.className = "habit-check";
    row.innerHTML =
      `<label class="habit-check-label">` +
      `<input type="checkbox" ${checked ? "checked" : ""} data-habit-id="${escapeAttr(habit.id)}" />` +
      `<span class="habit-check-name">${escapeHtml(habit.name || "Unnamed")}</span>` +
      `</label>`;
    container.appendChild(row);
  });
  updateProgressText();
}

function init() {
  console.log("[Checkin] DOM ready, waiting for auth");

  const todayHabitsEl = document.getElementById("todayHabits");
  const progressTextEl = document.getElementById("progressText");
  if (!todayHabitsEl) {
    console.warn("[Checkin] #todayHabits not found");
    return;
  }

  async function loadHabits() {
    const ref = getHabitsRef();
    if (!ref) return;
    console.log("[Checkin] Loading habits for user", currentUser.uid);
    try {
      const snapshot = await getDocs(ref);
      habits = [];
      snapshot.forEach((d) => {
        habits.push({ id: d.id, ...d.data() });
      });
      console.log("[Checkin] Habits loaded:", habits.length);
    } catch (err) {
      console.error("[Checkin] loadHabits error", err);
      habits = [];
    }
  }

  async function loadCheckin() {
    const ref = getCheckinRef();
    if (!ref) return;
    console.log("[Checkin] Loading checkin for", getTodayId());
    try {
      const snap = await getDoc(ref);
      completedIds = (snap.exists() && snap.data().habitsCompleted) || [];
      console.log("[Checkin] Checkins loaded:", completedIds.length, "completed");
    } catch (err) {
      console.error("[Checkin] loadCheckin error", err);
      completedIds = [];
    }
  }

  /** Streak + shields: day counts if habitsCompleted.length > 0. One shield per 7 days. Missed day: use shield or reset. */
  async function updateStreakIfNeeded() {
    if (completedIds.length === 0) return;
    const userRef = getUserRef();
    if (!userRef) return;
    const today = getTodayId();
    try {
      const userSnap = await getDoc(userRef);
      const data = userSnap.exists() ? userSnap.data() : {};
      let lastCheckinDate = data.lastCheckinDate ?? null;
      if (lastCheckinDate && typeof lastCheckinDate.toDate === "function")
        lastCheckinDate = lastCheckinDate.toDate().toISOString().split("T")[0];
      if (lastCheckinDate === today) {
        console.log("[Streak] Today already counted, skip");
        return;
      }
      const currentStreak = Number(data.currentStreak) || 0;
      const longestStreak = Number(data.longestStreak) || 0;
      let streakShields = Number(data.streakShields) || 0;
      const yesterday = getYesterdayId();
      const yesterdayRef = doc(db, "users", currentUser.uid, "checkins", yesterday);
      const yesterdaySnap = await getDoc(yesterdayRef);
      const yesterdayCompleted =
        yesterdaySnap.exists() &&
        Array.isArray(yesterdaySnap.data().habitsCompleted) &&
        yesterdaySnap.data().habitsCompleted.length > 0;

      let newStreak;
      let newLongest;
      const updatePayload = { lastCheckinDate: today };

      if (yesterdayCompleted) {
        newStreak = currentStreak + 1;
        newLongest = Math.max(longestStreak, newStreak);
        updatePayload.currentStreak = newStreak;
        updatePayload.longestStreak = newLongest;
        if (newStreak > 0 && newStreak % 7 === 0) {
          streakShields += 1;
          updatePayload.streakShields = streakShields;
          updatePayload.lastShieldEarnedAt = today;
          console.log("[Streak] Shield awarded at", newStreak, "days");
        }
      } else {
        if (streakShields > 0) {
          streakShields -= 1;
          newStreak = currentStreak;
          newLongest = longestStreak;
          updatePayload.currentStreak = newStreak;
          updatePayload.longestStreak = newLongest;
          updatePayload.streakShields = streakShields;
          console.log("[Streak] Missed day: 1 shield used, streak preserved at", newStreak);
        } else {
          newStreak = 1;
          newLongest = Math.max(longestStreak, 1);
          updatePayload.currentStreak = newStreak;
          updatePayload.longestStreak = newLongest;
          updatePayload.streakShields = 0;
          console.log("[Streak] Missed day: no shields, streak reset to 1");
        }
      }

      console.log("[Streak] yesterdayCompleted:", yesterdayCompleted, "newStreak:", newStreak, "shields:", streakShields);
      await updateDoc(userRef, updatePayload);
      console.log("[Streak] User doc updated");
      updateStreakUI(newStreak);
      updateShieldsUI(streakShields);
      await writeToGroupFeeds(null, newStreak);
    } catch (err) {
      console.error("[Streak] updateStreakIfNeeded error", err);
    }
  }

  async function writeToGroupFeeds(habitsCount, streakCount) {
    if (!currentUser) return;
    try {
      const data = await getAuthState().getUserProfile();
      const groupIds = (data && data.groupIds) || [];
      const userName = (data && data.name) || currentUser.displayName || currentUser.email || "Someone";
      if (groupIds.length === 0) return;
      const weekStart = getWeekStart();
      const today = getTodayId();
      await Promise.all(
        groupIds.map(async (gid) => {
          if (habitsCount != null && habitsCount > 0) {
            await addDoc(collection(db, "groups", gid, "activity"), {
              type: "habits",
              userName,
              message: "completed habits",
              count: habitsCount,
              createdAt: serverTimestamp(),
            });
            const statsRef = doc(db, "groups", gid, "memberStats", currentUser.uid);
            const statsSnap = await getDoc(statsRef);
            const prev = statsSnap.exists() ? statsSnap.data() : {};
            const sameWeek = prev.weekStart === weekStart;
            const alreadyCountedToday = prev.lastUpdatedDate === today;
            const newCount = sameWeek && !alreadyCountedToday
              ? (prev.checkinsThisWeek || 0) + 1
              : alreadyCountedToday ? (prev.checkinsThisWeek || 0) : 1;
            await setDoc(statsRef, { weekStart, checkinsThisWeek: newCount, lastUpdatedDate: today }, { merge: true });
          }
          if (streakCount != null && streakCount > 0) {
            await addDoc(collection(db, "groups", gid, "activity"), {
              type: "streak",
              userName,
              message: "hit a streak",
              count: streakCount,
              createdAt: serverTimestamp(),
            });
          }
        })
      );
    } catch (err) {
      console.error("[Checkin] writeToGroupFeeds error", err);
    }
  }

  async function writeIdentityToGroupFeeds(identity) {
    if (!currentUser || !identity || !identity.trim()) return;
    try {
      const data = await getAuthState().getUserProfile();
      const groupIds = (data && data.groupIds) || [];
      const userName = (data && data.name) || currentUser.displayName || currentUser.email || "Someone";
      if (groupIds.length === 0) return;
      await Promise.all(
        groupIds.map((gid) =>
          addDoc(collection(db, "groups", gid, "activity"), {
            type: "identity",
            userName,
            message: "reinforced identity",
            identity: String(identity).trim(),
            createdAt: serverTimestamp(),
          })
        )
      );
    } catch (err) {
      console.error("[Checkin] writeIdentityToGroupFeeds error", err);
    }
  }

  todayHabitsEl.addEventListener("change", async (e) => {
    if (e.target.type !== "checkbox" || !e.target.dataset.habitId) return;
    const id = e.target.dataset.habitId;
    if (e.target.checked) {
      if (!completedIds.includes(id)) completedIds.push(id);
      const habit = habits.find((h) => h.id === id);
      showIdentityReinforcement(habit ? habit.identity : null);
      if (habit && habit.identity) writeIdentityToGroupFeeds(habit.identity);
      if (completedIds.length === 1) showDailyWin();
    } else {
      completedIds = completedIds.filter((x) => x !== id);
    }
    const ref = getCheckinRef();
    if (!ref) return;
    try {
      await setDoc(ref, { habitsCompleted: completedIds });
      console.log("[Checkin] Checkbox saved:", id, e.target.checked);
    } catch (err) {
      console.error("[Checkin] setDoc checkin error", err);
    }
    updateProgressText();
    await updateStreakIfNeeded();
    await loadAndRenderWeeklyChain();
    if (e.target.checked && completedIds.length === 1) await writeToGroupFeeds(1, null);
  });

  subscribeAuth(async (user) => {
    if (!user) {
      console.log("[Checkin] No user");
      return;
    }
    currentUser = user;
    console.log("[Checkin] Auth loaded:", user.uid);
    if (todayHabitsEl) todayHabitsEl.innerHTML = "<p class=\"today-habits-empty\">Loading…</p>";
    await loadHabits();
    await loadCheckin();
    await loadAndRenderWeeklyChain();
    render();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
function showDailyWin() {

    const div = document.createElement("div");
  
    div.className = "daily-win";
  
    div.textContent = "🎉 Momentum Started — Great job showing up today!";
  
    document.body.appendChild(div);
  
    setTimeout(() => {
      div.remove();
    }, 3000);
  
  }