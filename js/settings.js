/**
 * App settings: change password, delete account, dark mode.
 */
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase-init.js";

const DARK_MODE_KEY = "motivation-in-motion-dark-mode";

function showError(msg) {
  const el = document.getElementById("settingsError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function clearError() {
  const el = document.getElementById("settingsError");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

function initDarkMode() {
  const stored = localStorage.getItem(DARK_MODE_KEY);
  const dark = stored === "true";
  const toggle = document.getElementById("darkModeToggle");
  if (toggle) {
    toggle.checked = dark;
    toggle.addEventListener("change", () => {
      const value = toggle.checked;
      localStorage.setItem(DARK_MODE_KEY, value ? "true" : "false");
      document.body.classList.toggle("dark-mode", value);
    });
  }
  document.body.classList.toggle("dark-mode", dark);
}

function init() {
  initDarkMode();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
  });

  const changePasswordForm = document.getElementById("changePasswordForm");
  if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      const currentPassword = document.getElementById("currentPassword")?.value;
      const newPassword = document.getElementById("newPassword")?.value;
      if (!currentPassword || !newPassword) {
        showError("Please enter both current and new password.");
        return;
      }
      if (newPassword.length < 6) {
        showError("New password must be at least 6 characters.");
        return;
      }
      const btn = document.getElementById("changePasswordBtn");
      if (btn) btn.disabled = true;
      try {
        const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
        await reauthenticateWithCredential(auth.currentUser, credential);
        await updatePassword(auth.currentUser, newPassword);
        showError(""); // clear
        changePasswordForm.reset();
        if (btn) btn.disabled = false;
        alert("Password updated successfully.");
      } catch (err) {
        if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
          showError("Current password is incorrect.");
        } else {
          showError(err.message || "Could not change password.");
        }
        if (btn) btn.disabled = false;
      }
    });
  }

  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", async () => {
      if (!auth.currentUser) return;
      const password = window.prompt("Enter your password to confirm account deletion:");
      if (password == null || !password) return;
      if (!confirm("Permanently delete your account and all data? This cannot be undone.")) return;
      const btn = deleteAccountBtn;
      btn.disabled = true;
      try {
        const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
        await reauthenticateWithCredential(auth.currentUser, credential);
        await deleteUser(auth.currentUser);
        window.location.href = "login.html";
      } catch (err) {
        if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
          showError("Password is incorrect.");
        } else {
          showError(err.message || "Could not delete account.");
        }
        btn.disabled = false;
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
