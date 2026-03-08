# Motivation in Motion — Codebase Audit Report

**Stack:** HTML, Vanilla JavaScript, Firebase Auth, Firestore, ImgBB, static hosting.  
**Scope:** Full repository review.  
**Date:** 2026-03-08.

---

## 1. Project Structure Review

### Current structure
```
/
  index.html, login.html, habits.html, groups.html, group.html, profile.html
  about.html, crew.html, checkin.html, settings.html
  firestore.rules, storage.rules
  css/style.css
  js/
    firebase-config.js
    firebase-init.js
    auth.js
    app.js
    checkin.js
    habits.js
    groups.js
    group.js
    profile.js
  images/, icons/ (.gitkeep)
```

### Issues

| Issue | Why it matters | Fix |
|-------|----------------|-----|
| **Orphan / duplicate pages** | `crew.html` still exists and nav points to "Crew" on that page, but the rest of the app uses `groups.html` for the same tab. `checkin.html` and `settings.html` are placeholders with no auth or scripts. | Remove or redirect: delete `crew.html` or make it redirect to `groups.html`. Either implement `checkin.html`/`settings.html` or remove and fix any links. |
| **Inconsistent nav** | `crew.html` has nav item "Crew" linking to itself; other pages use "Groups" → `groups.html`. | Use one canonical page (e.g. groups.html) and one label ("Groups") everywhere; remove crew.html or redirect. |
| **Dead file** | `storage.rules` is still present but the app uses ImgBB, not Firebase Storage. | Delete `storage.rules` or add a comment that it’s unused so deploy scripts don’t deploy it. |
| **Root full of HTML** | Many HTML files at root can get noisy. | Optional: move pages into e.g. `pages/` and adjust paths (and any static hosting config). |

### Recommended structure (optional, non-breaking)
Keep current layout but clean up:

- Remove or redirect: `crew.html` → `groups.html`.
- Remove or implement: `checkin.html`, `settings.html`.
- Delete or document: `storage.rules`.
- Keep: `index.html`, `login.html`, `habits.html`, `groups.html`, `group.html`, `profile.html`, `about.html` at root; `css/`, `js/` as-is.

---

## 2. Firebase Usage Audit

### Auth
- **Correct:** All protected pages use `onAuthStateChanged` and redirect to `login.html` when `!user`.
- **Gap:** `about.html`, `settings.html`, `checkin.html` don’t load any JS; if they later become protected, they need the same pattern.

### Firestore reads

| Location | Issue | Impact |
|----------|--------|--------|
| **index.html** | Both `app.js` and `checkin.js` run; each triggers its own `onAuthStateChanged`. When user is set, **app.js** does 1× `getDoc(users/{uid})` and **checkin.js** does `loadHabits` (1× habits) + `loadCheckin` (1× checkin) + **loadAndRenderWeeklyChain** (7× checkins). | Two separate user-doc reads on dashboard load (app + checkin). |
| **checkin.js** | `writeToGroupFeeds` and `writeIdentityToGroupFeeds` each call `getDoc(getUserRef())` to get `groupIds` and name. On one checkbox action you can do: setDoc checkin, getDoc user (streak), then getDoc user again in writeToGroupFeeds, then again in writeIdentityToGroupFeeds. | Up to 3 user reads per checkbox when groups/identity are involved. |
| **group.js** | For each member: `getDoc(users/{memberId})` for avatar/name. For leaderboard: again `getDoc(users/{id})` per member. | N members ⇒ 2N user reads (members + leaderboard). |
| **groups.js** | `loadMyGroups`: 1× user doc (groupIds) then 1× group doc per groupId. | Fine. |

### Firestore writes
- **checkin.js:** On first habit check of the day, for each group: 1× `addDoc` activity + 1× `getDoc` memberStats + 1× `setDoc` memberStats. Many groups ⇒ many writes. Acceptable for small group counts; consider batching or rate-limiting if groups grow.
- **activity:** Any authenticated user can create any `groups/{id}/activity` doc. Rules allow `create: if request.auth != null`. So a logged-in user could post to groups they’re not in. | **Security:** Tighten to allow create only if user is in `groups/{id}/members`.

### Recommendations
1. **Dashboard:** Have a single place own “current user” (e.g. app.js). Pass user + optional user doc snapshot into checkin.js (or a shared state) so the dashboard doesn’t do two independent user-doc reads.
2. **Checkin:** Cache `groupIds` and display name on the client (e.g. after first `getDoc(user)` in the session) and reuse in `writeToGroupFeeds` / `writeIdentityToGroupFeeds` instead of refetching every time.
3. **Group page:** You already batch member user reads with `Promise.all`. For leaderboard you do another full batch of user reads. Consider storing `photoURL` and `displayName` (or name) in `groups/{id}/members/{uid}` when they join or when they update profile, and only fall back to `users/{uid}` when missing, to cut reads.
4. **Activity rules:** Restrict `groups/{groupId}/activity` create to members of that group (e.g. check `get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data` exists).

---

## 3. State Management

### Multiple `onAuthStateChanged` listeners
- **index.html** loads both `app.js` and `checkin.js`. Each registers `onAuthStateChanged(auth, ...)`. So on the dashboard, every auth state change runs two callbacks. Both read the same auth user; app.js then reads user doc, checkin.js loads habits + checkin + weekly chain. No shared “current user” or “user doc” state.
- **Effect:** Duplicate listener logic and duplicate user-doc read; no functional bug, but redundant work and harder to reason about.

### Inconsistent user state
- Each page sets its own `currentUser` (or equivalent) from `onAuthStateChanged`. There is no shared module that exposes “current user” or “user profile” once. Fine for multi-page static app, but any caching (e.g. of user doc or groupIds) must be per-page or via a small shared module.

### Race conditions
- **Dashboard:** app.js and checkin.js both run on load. If auth resolves after a short delay, both run in parallel. Possible order: app.js callback runs, does getDoc(user), then checkin.js runs, does loadHabits + loadCheckin + weekly chain. No shared DOM targets, so no visible race; only duplicate user read.
- **Profile / groups:** Single script per page; no obvious races.

### Recommendations
1. Add a tiny **auth state module** (e.g. `js/auth-state.js`) that subscribes once to `onAuthStateChanged`, exposes `currentUser` and optionally a cached `userDoc`/`userProfile`, and lets app.js and checkin.js consume it so the user doc is read once per auth change.
2. On index, either load only one script that coordinates dashboard (user + habits + checkin + weekly chain) or keep two scripts but have app.js pass user (and optionally user doc) into checkin.js so checkin doesn’t need to re-fetch the same user doc for streak/group feeds.

---

## 4. Data Model Review

### Current Firestore layout
- `users/{uid}` — profile, streak, groupIds, etc.
- `users/{uid}/habits/{habitId}` — name, identity, createdAt.
- `users/{uid}/checkins/{date}` — habitsCompleted.
- `groups/{groupId}` — name, owner, joinCode, joinCodeExpires, createdAt.
- `groups/{groupId}/members/{userId}` — name, joinedAt, role.
- `groups/{groupId}/activity/{eventId}` — type, userName, message, createdAt, count, identity.
- `groups/{groupId}/memberStats/{userId}` — weekStart, checkinsThisWeek, lastUpdatedDate.

### Scaling / index issues
- **groups** query: `where("joinCode", "==", code)` requires a single-field index on `joinCode`. Firestore may auto-create it; if not, the console will prompt. Document or add in `firestore.indexes.json` if you use deployment.
- **activity:** No composite index required if you only do `getDocs(collection(...))` and sort in memory (as in group.js). If you later add `orderBy("createdAt", "desc")` in the query, you’ll need a composite index.
- **Document size:** User doc can grow with `groupIds` array. At 1–10k groups per user this is still small; if you ever support “many” groups, consider a subcollection like `users/{uid}/groupsJoined/{groupId}` and query by that instead of an array.

### Unnecessary / redundant writes
- **checkin.js:** When updating streak, you write `lastCheckinDate`, `currentStreak`, `longestStreak`, and sometimes `streakShields` / `lastShieldEarnedAt`. All in one `updateDoc` — good.
- **writeToGroupFeeds:** For each group you do 1–2 writes (activity + memberStats). If a user is in many groups, this is a burst of writes per check-in; acceptable for tens of groups, consider batching or background job for larger scale.

### Recommendations
1. Add `firestore.indexes.json` (or equivalent) with the `joinCode` index so deployments are reproducible.
2. For very large groups, consider pagination or limit on activity (e.g. last 50 events) and lazy-load older activity.
3. Keep `memberStats` as-is; it’s a good pattern for leaderboard without reading other users’ checkins.

---

## 5. Security Review

### Exposed keys
- **firebase-config.js:** Contains `apiKey`, `projectId`, etc. This is normal for Firebase client apps; restrict the key by domain in Firebase Console (e.g. your GitHub Pages domain and localhost).
- **profile.js:** `IMGBB_API_KEY = "YOUR_IMGBB_API_KEY"` is in the front-end. ImgBB keys are often used client-side; if the key is restricted to your domain and rate-limited, risk is limited. If ImgBB supports server-side uploads, moving the upload to a backend and keeping the key in env is safer.

### Firestore rules
- **users:** Read: any authenticated user (for avatars/names). Write: only owner. Good.
- **groups:** Read: any authenticated. Create: any. Update/delete: only owner. Good.
- **groups/activity:** `create: if request.auth != null` — any logged-in user can add events to any group. **Fix:** Allow create only if the user is a member, e.g. `get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data != null`.
- **members:** create only when `memberId == request.auth.uid` (join self). update allowed for any authenticated user; consider restricting to owner or self for specific fields if you add more fields later.

### Client logic
- **Join code:** Checked client-side (expiry, then add to members). Rules don’t re-check expiry; a modified client could try to use an expired code. Firestore can’t enforce “joinCodeExpires > now” in rules easily. Mitigation: keep server-side validation if you add a backend, or accept that expired codes are “soft” enforced by client.
- **XSS:** You use `escapeHtml` / `escapeAttr` when rendering habit names, group names, and member names. Good.

### Recommendations
1. Restrict **groups/{groupId}/activity** create to members (see above).
2. In Firebase Console, restrict the **API key** to your app’s origins.
3. If ImgBB key is sensitive, move image upload to a small backend (e.g. Cloud Function) and call it from profile.js.

---

## 6. Performance Issues

- **Dashboard:** Two user-doc reads (app.js + checkin.js); see Section 2. Consolidate or share user doc.
- **Weekly chain:** 7× `getDoc` for 7 days in parallel — fine.
- **Group page:** 2N user reads (members + leaderboard). Caching `users/{id}` in a small cache (e.g. in-memory map by id) for the lifetime of the page would avoid duplicate reads for the same member in members and leaderboard.
- **writeToGroupFeeds:** Multiple sequential `addDoc` and `setDoc` in a loop. Could run per-group writes in parallel with `Promise.all` (same as you do for member user fetches) to reduce latency when the user is in several groups.
- **DOM:** Habits list and weekly chain are re-rendered by replacing `innerHTML` or building new nodes. No unnecessary full-page reflows; acceptable.
- **Images:** Avatar images use `loading="lazy"` where you create them in app.js; good. Group page avatars could also use `loading="lazy"` if you have many members.

### Recommendations
1. Run group activity + memberStats updates in **parallel** in `writeToGroupFeeds` (e.g. `Promise.all` over groups).
2. **Group page:** Build a `Map<uid, userDoc>` from the member user reads and reuse it for the leaderboard instead of fetching each user again.
3. Optionally lazy-load activity or leaderboard on the group page (e.g. show members first, then load activity) to improve first paint.

---

## 7. UX Problems

- **Loading states:** Habits page shows “Loading…”; dashboard doesn’t show a clear “Loading…” for streak/avatar/habits before data arrives. Users may see “0” or empty state briefly. **Fix:** Show a skeleton or “Loading…” for streak and today habits until first data load.
- **Errors:** Many `catch` blocks only `console.error` or `showError` in a generic div. Good. Some forms don’t re-enable the submit button on network error (e.g. profile save does re-enable). Verify all submit handlers use `finally { button.disabled = false }`.
- **Navigation:** Bottom nav is consistent. `crew.html` still shows “Crew” and links to itself while the rest of the app uses “Groups” → groups.html; confusing if a user lands on crew. **Fix:** Remove or redirect crew.
- **Profile:** If ImgBB key is invalid, error “ImgBB API key not configured” is clear. If the API is down, user sees “Upload failed” — consider a slightly more specific message when `res.ok` is false.
- **Groups:** No loading state on “My groups” while `loadMyGroups()` runs after auth; list area is empty until data arrives. **Fix:** Show “Loading…” in `#groupsList` as soon as auth is ready, before the first fetch.

---

## 8. Code Quality

### Duplicated logic
- **escapeHtml / escapeAttr:** Defined in habits.js, checkin.js, group.js, groups.js (and used in profile for display). **Suggestion:** Move to a small `js/utils.js` and import where needed.
- **showError / clearError:** Similar pattern in auth.js, habits.js, groups.js, group.js, profile.js (different element IDs). Could be one shared helper that takes element id or a root “error” container.
- **getJoinUrl, generateJoinCode, joinCodeExpiresAt:** Duplicated in groups.js and group.js. **Suggestion:** Put in `js/groups-utils.js` or a shared `js/utils.js` and import in both.
- **getWeekStart:** In checkin.js and group.js. **Suggestion:** Single implementation in utils.
- **Avatar rendering:** app.js inlines avatar DOM construction; profile.js and group.js have `renderAvatar` or similar. **Suggestion:** One shared `renderAvatar(container, photoURL, name, size)` used by app, profile, and group.

### Style
- Mix of `"` and `'`; mostly consistent per file. Optional: pick one and stick to it.
- Some files use `async/await`, others use `.then()` in places; overall async/await is used. Fine.
- **showDailyWin** in checkin.js is defined at the bottom of the file, after `init()` and the DOMContentLoaded block; it’s used inside init. Works but is a bit out of order; move it next to other helpers.

### Unused code
- **groups.js:** Imports `orderBy` and `limit` from Firestore but doesn’t use them. **Fix:** Remove the unused imports.

---

## 9. Dependency Issues

- **Firebase:** All imports use `https://www.gstatic.com/firebasejs/10.12.2/...`. Version is fixed and consistent. No mixed v8/v9/v10.
- **QRCode:** groups.html and group.html load `https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js` as a global. No version conflict.
- **No package.json:** Project is script-tag + ES modules only. No npm; no outdated lockfile. For future, adding a minimal package.json and optionally bundling could help, but not required for current setup.

### Recommendation
- Pin the Firebase version in a comment or README (e.g. “Firebase JS SDK 10.12.2”) so upgrades are intentional and consistent.

---

## 10. Critical Bugs

| Issue | Explanation | Fix |
|-------|--------------|-----|
| **Firestore activity rule** | Any authenticated user can create documents in any group’s activity. A malicious user could post to groups they’re not in. | Restrict create to members: e.g. `allow create: if request.auth != null && get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data != null;` |
| **Signup missing fields** | auth.js `setDoc(userRef, {...})` does not set `displayName`, `streakShields`, or `groupIds`. New users get `name` but not `displayName`. App uses `displayName \|\| name` in many places, so behavior is ok. If anything expects `groupIds` to exist, it’s usually `arrayUnion` later. | Optional: add `displayName: name`, `streakShields: 0`, `groupIds: []` (or omit and keep using arrayUnion) for consistency. |
| **writeToGroupFeeds userName** | You use `data.name` for userName; profile saves both `name` and `displayName`. New users from auth only have `name`. So correct. If you ever stop writing `name` on profile save, activity would fall back to `currentUser.displayName` or email. | No change required; just ensure profile save keeps updating `name` when displayName is set. |
| **Index page double load** | index loads both app.js and checkin.js. Both run; no crash. Only redundant user read and two auth listeners. | Not a bug; optimization only (see Sections 2 and 3). |

No crashes or data corruption identified from the code paths reviewed. The only security-sensitive bug is the activity create rule.

---

## 11. Future Scalability

### 1,000 users
- Firestore and auth scale. Per-user data (habits, checkins) is partitioned by uid. Group reads scale with number of groups a user is in. No change required.

### 10,000 users
- **groups** collection: Query by `joinCode` is one equality; index once. No issue.
- **Group page:** Loading all members and all leaderboard user docs (2N reads) is fine for tens of members per group. If groups grow to hundreds of members, add pagination for the member list and/or leaderboard and cache user docs per page.
- **activity:** Loading all activity and sorting in memory is fine for hundreds of events. For thousands, add limit (e.g. 50) and “Load more” with startAfter.

### Community / large groups
- **memberStats:** Each member writes to their own `memberStats` doc; no hotspot.
- **activity:** Many members creating activity in one group can create a write hotspot on that group’s activity collection. Firestore handles this, but you can reduce write volume by batching or sampling (e.g. only post activity for “first check-in of the day” or “streak milestone”).
- **joinCode:** Single query; no scaling issue. Optionally add a TTL or server job to invalidate old codes if you add a backend.

---

## Summary Tables

### Critical Issues
| # | Item | Fix |
|---|------|-----|
| 1 | **Activity rule** allows any authenticated user to create activity in any group | Restrict create to group members. In `firestore.rules`, replace the activity block with: `match /activity/{eventId} { allow read: if request.auth != null; allow create: if request.auth != null && exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)); }` |

### Warnings
| # | Item | Fix |
|---|------|-----|
| 1 | Firebase config and ImgBB key in client | Restrict API key by domain; consider server-side image upload for ImgBB. |
| 2 | Two `onAuthStateChanged` listeners and two user-doc reads on dashboard | Share auth state and user doc (e.g. auth-state.js) and single read. |
| 3 | crew.html and nav inconsistency | Remove crew or redirect to groups; use “Groups” everywhere. |
| 4 | storage.rules present but Storage unused | Delete or document as unused. |
| 5 | Unused imports in groups.js (orderBy, limit) | Remove. |

### Suggested Improvements
- Cache user doc / groupIds in checkin.js for the duration of the session to avoid repeated getDoc in writeToGroupFeeds/writeIdentityToGroupFeeds.
- Restrict group activity create to members in Firestore rules.
- Add loading states for dashboard (streak, today habits) and groups list.
- Extract shared utils: escapeHtml, escapeAttr, getWeekStart, getJoinUrl, generateJoinCode, joinCodeExpiresAt, renderAvatar.
- Run writeToGroupFeeds group writes in parallel with Promise.all.
- Reuse member user docs on group page for leaderboard (single batch of getDoc(users) and reuse by uid).

### Architecture Improvements
- Introduce a small **auth-state** module used by app.js and checkin.js so the dashboard has one auth listener and one user-doc read.
- Optional **utils.js** (or utils/avatar.js, utils/group-code.js) for shared helpers and avatar rendering.
- Optional **firestore.indexes.json** for joinCode (and any future composite indexes).

### Nice-to-Have Enhancements
- README with setup (Firebase project, ImgBB key, deploy).
- Single `firebase-config.js` or env-based config so ImgBB key isn’t hardcoded in profile.js (e.g. one config object or build-time replace).
- Light integration test or manual test checklist for: signup → login → create habit → check-in → streak, create group → join with code, profile photo upload.

---

*End of audit.*
