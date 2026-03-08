/**
 * Single source of auth state and cached user profile.
 * Reduces duplicate onAuthStateChanged listeners and user-doc reads on the dashboard.
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

let currentUser = null;
let cachedProfile = null;
let cachedProfileUid = null;
let profilePromise = null;
const subscribers = [];

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  cachedProfile = null;
  cachedProfileUid = null;
  profilePromise = null;
  subscribers.forEach((cb) => cb(user));
});

/**
 * Subscribe to auth state changes. Callback is invoked with the current user (or null).
 * @param {(user: import("firebase/auth").User | null) => void} callback
 */
export function subscribeAuth(callback) {
  subscribers.push(callback);
  if (currentUser) callback(currentUser);
}

/**
 * @returns {{ currentUser: import("firebase/auth").User | null, getUserProfile: () => Promise<Record<string, unknown> | null> }}
 */
export function getAuthState() {
  return {
    get currentUser() {
      return currentUser;
    },
    async getUserProfile() {
      if (!currentUser) return null;
      if (cachedProfileUid === currentUser.uid && cachedProfile != null) return cachedProfile;
      if (profilePromise) return profilePromise;
      profilePromise = getDoc(doc(db, "users", currentUser.uid)).then((snap) => {
        cachedProfile = snap.exists() ? snap.data() : null;
        cachedProfileUid = currentUser.uid;
        profilePromise = null;
        return cachedProfile;
      });
      return profilePromise;
    },
  };
}
