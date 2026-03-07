/**
 * Main app logic for Motivation in Motion.
 * Handles auth state, form submissions, and page-specific behavior.
 */

(function () {
  if (typeof auth === 'undefined') return;

  auth.onAuthStateChanged(function (user) {
    if (user) {
      document.body.classList.add('logged-in');
      const profileEmail = document.getElementById('profile-email');
      if (profileEmail) profileEmail.textContent = user.email || '—';
      const avatar = document.getElementById('profile-avatar');
      if (avatar && user.displayName) avatar.textContent = user.displayName.charAt(0).toUpperCase();
    } else {
      document.body.classList.remove('logged-in');
    }
  });

  // Logout link
  const logoutLink = document.getElementById('logout-link');
  if (logoutLink) {
    logoutLink.addEventListener('click', function (e) {
      e.preventDefault();
      auth.logout();
      window.location.href = 'index.html';
    });
  }

  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      auth.login(email, password)
        .then(function () {
          window.location.href = 'index.html';
        })
        .catch(function (err) {
          alert(err.message || 'Login failed');
        });
    });
  }

  // Check-in form
  const checkinForm = document.getElementById('checkin-form');
  if (checkinForm) {
    checkinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const note = document.getElementById('checkin-note');
      if (note && note.value.trim()) {
        // TODO: save to Firebase
        console.log('Check-in:', note.value.trim());
        note.value = '';
      }
    });
  }

  // Settings form
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    const user = auth.getCurrentUser();
    if (user) {
      const displayName = document.getElementById('display-name');
      const settingsEmail = document.getElementById('settings-email');
      if (displayName) displayName.value = user.displayName || '';
      if (settingsEmail) settingsEmail.value = user.email || '';
    }
    settingsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      // TODO: update profile in Firebase
      console.log('Settings saved');
    });
  }
})();
