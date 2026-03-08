/**
 * Profile page: upload photo via ImgBB, edit displayName, bio, location, website.
 * users/{uid}: displayName, bio, location, website, photoURL, updatedAt
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { renderAvatar } from "./utils.js";

const IMGBB_API_KEY = "YOUR_IMGBB_API_KEY";
const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";
const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 800;

function showError(msg) {
  const el = document.getElementById("profileError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function clearError() {
  const el = document.getElementById("profileError");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

function showPreview(container, blobOrUrl) {
  if (!container) return;
  container.textContent = "";
  container.classList.add("avatar--img");
  const img = document.createElement("img");
  img.src = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  img.alt = "Preview";
  img.className = "avatar-img";
  container.appendChild(img);
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
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not resize image"));
        },
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

async function uploadToImgBB(file) {
  let toUpload = file;
  if (file.size > MAX_SIZE_BYTES) {
    const resized = await resizeImageToBlob(file);
    if (resized.size > MAX_SIZE_BYTES) {
      throw new Error("Image must be under 2MB. Use a smaller image.");
    }
    toUpload = new File([resized], "image.jpg", { type: "image/jpeg" });
  } else if (file.type !== "image/jpeg" && file.type !== "image/png") {
    toUpload = new File([await resizeImageToBlob(file)], "image.jpg", { type: "image/jpeg" });
  }
  const base64 = await fileToBase64(toUpload);
  const form = new FormData();
  form.append("key", IMGBB_API_KEY);
  form.append("image", base64);
  const res = await fetch(IMGBB_UPLOAD_URL, {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || json.error || res.statusText || "Upload failed";
    throw new Error(msg);
  }
  if (!json.data || !json.data.url) {
    throw new Error("Invalid response from image host");
  }
  return json.data.url;
}

function init() {
  const profileForm = document.getElementById("profileForm");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const uploadPhotoBtn = document.getElementById("uploadPhotoBtn");
  const photoInput = document.getElementById("photoInput");
  const profilePhoto = document.getElementById("profilePhoto");

  if (!profileForm || !profilePhoto) return;

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    loadProfile(user.uid);
  });

  uploadPhotoBtn?.addEventListener("click", () => photoInput?.click());

  photoInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    clearError();
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (file.size > MAX_SIZE_BYTES) {
      showError("Image must be under 2MB. Try a smaller or more compressed image.");
      e.target.value = "";
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    showPreview(profilePhoto, previewUrl);

    saveProfileBtn.disabled = true;
    try {
      if (!IMGBB_API_KEY || IMGBB_API_KEY === "YOUR_IMGBB_API_KEY") {
        throw new Error("ImgBB API key not configured. Set IMGBB_API_KEY in js/profile.js");
      }
      const photoURL = await uploadToImgBB(file);
      await updateDoc(doc(db, "users", uid), {
        photoURL,
        updatedAt: serverTimestamp(),
      });
      URL.revokeObjectURL(previewUrl);
      renderAvatar(profilePhoto, photoURL, document.getElementById("profileDisplayName")?.value, "lg");
    } catch (err) {
      console.error("[Profile] Upload error", err);
      showError(err.message || "Upload failed.");
      URL.revokeObjectURL(previewUrl);
      renderAvatar(profilePhoto, null, document.getElementById("profileDisplayName")?.value, "lg");
    } finally {
      saveProfileBtn.disabled = false;
      e.target.value = "";
    }
  });

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const displayName = (document.getElementById("profileDisplayName")?.value || "").trim();
    const bio = (document.getElementById("profileBio")?.value || "").trim();
    const location = (document.getElementById("profileLocation")?.value || "").trim();
    const website = (document.getElementById("profileWebsite")?.value || "").trim();
    saveProfileBtn.disabled = true;
    try {
      await updateDoc(doc(db, "users", uid), {
        displayName: displayName || null,
        name: displayName || null,
        bio: bio || null,
        location: location || null,
        website: website || null,
        updatedAt: serverTimestamp(),
      });
      const currentPhotoURL = profilePhoto.querySelector("img")?.getAttribute("src") || null;
      renderAvatar(profilePhoto, currentPhotoURL, displayName, "lg");
    } catch (err) {
      console.error("[Profile] Save error", err);
      showError(err.message || "Could not save profile.");
    } finally {
      saveProfileBtn.disabled = false;
    }
  });

  async function loadProfile(uid) {
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      const data = userSnap.exists() ? userSnap.data() : {};
      const name = data.displayName ?? data.name ?? "";
      document.getElementById("profileDisplayName").value = name;
      document.getElementById("profileBio").value = data.bio ?? "";
      document.getElementById("profileLocation").value = data.location ?? "";
      document.getElementById("profileWebsite").value = data.website ?? "";
      renderAvatar(profilePhoto, data.photoURL || null, name, "lg");
    } catch (err) {
      console.error("[Profile] Load error", err);
      showError("Could not load profile.");
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
