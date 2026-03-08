/**
 * Shared utilities for Motivation in Motion.
 * Used across habits, checkin, groups, group, profile, and app.
 */
import { Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getWeekStart() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setUTCDate(diff);
  return monday.toISOString().split("T")[0];
}

export function generateJoinCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function joinCodeExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return Timestamp.fromDate(d);
}

export function getJoinUrl(code) {
  if (typeof window === "undefined" || !window.location) return "";
  const origin = window.location.origin;
  const path = (window.location.pathname || "").replace(/(\/)?[^/]*$/, "$1groups.html");
  return (origin + path) + "?join=" + encodeURIComponent(code);
}

/**
 * Renders avatar into container: image if photoURL, else initial letter.
 * @param {HTMLElement} container - Element to render into (e.g. div.avatar)
 * @param {string|null} photoURL - Profile image URL or null
 * @param {string} name - Display name for initial/alt
 * @param {string} [size='lg'] - 'sm' or 'lg' for avatar--sm / avatar--lg
 */
export function renderAvatar(container, photoURL, name, size = "lg") {
  if (!container) return;
  const displayName = (name || "").trim() || "?";
  const initial = displayName.charAt(0).toUpperCase();
  container.textContent = "";
  container.className = "avatar avatar--" + (size === "sm" ? "sm" : "lg");
  container.classList.remove("avatar--img");
  if (photoURL) {
    const img = document.createElement("img");
    img.src = photoURL;
    img.alt = displayName;
    img.className = "avatar-img";
    img.loading = "lazy";
    img.onerror = () => {
      container.textContent = initial;
    };
    container.appendChild(img);
    container.classList.add("avatar--img");
  } else {
    container.textContent = initial;
  }
}
