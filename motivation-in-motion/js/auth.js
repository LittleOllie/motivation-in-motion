/**
 * Login and signup for Motivation in Motion.
 * Uses Firebase Auth + Firestore user document on signup.
 */
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const AUTH_ERROR_MESSAGES = {
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/wrong-password": "Wrong password. Please try again.",
  "auth/user-not-found": "No account found with this email.",
  "auth/email-already-in-use": "This email is already in use. Try logging in instead.",
  "auth/invalid-credential": "Invalid email or password. Please check and try again.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
};

function getAuthErrorMessage(code) {
  return AUTH_ERROR_MESSAGES[code] || "Something went wrong. Please try again.";
}

function showError(message) {
  const el = document.getElementById("authError");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function clearError() {
  const el = document.getElementById("authError");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

function bindAuth() {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      if (!email || !password) {
        showError("Please enter your email and password.");
        return;
      }
      try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = "index.html";
      } catch (err) {
        showError(getAuthErrorMessage(err.code) || err.message);
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      const nameInput = document.getElementById("signupName");
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPassword").value;
      const name = (nameInput && nameInput.value.trim()) || email.split("@")[0] || "User";
      if (!email || !password) {
        showError("Please enter your email and a password (at least 6 characters).");
        return;
      }
      if (password.length < 6) {
        showError(getAuthErrorMessage("auth/weak-password"));
        return;
      }
      try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = result.user;
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          name,
          currentStreak: 0,
          longestStreak: 0,
          lastCheckinDate: null,
          createdAt: serverTimestamp(),
        });
        window.location.href = "index.html";
      } catch (err) {
        showError(getAuthErrorMessage(err.code) || err.message);
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindAuth);
} else {
  bindAuth();
}
