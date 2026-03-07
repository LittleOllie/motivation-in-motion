/**
 * Authentication helpers for Motivation in Motion.
 * Depends on firebase-config.js and Firebase Auth SDK.
 */

const auth = (function () {
  function getAuth() {
    return typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null;
  }

  function getCurrentUser() {
    const authInstance = getAuth();
    return authInstance ? authInstance.currentUser : null;
  }

  function onAuthStateChanged(callback) {
    const authInstance = getAuth();
    if (authInstance) {
      authInstance.onAuthStateChanged(callback);
    } else {
      callback(null);
    }
  }

  function login(email, password) {
    const authInstance = getAuth();
    if (!authInstance) return Promise.reject(new Error('Firebase Auth not loaded'));
    return authInstance.signInWithEmailAndPassword(email, password);
  }

  function signUp(email, password) {
    const authInstance = getAuth();
    if (!authInstance) return Promise.reject(new Error('Firebase Auth not loaded'));
    return authInstance.createUserWithEmailAndPassword(email, password);
  }

  function logout() {
    const authInstance = getAuth();
    if (authInstance) authInstance.signOut();
  }

  return {
    getAuth,
    getCurrentUser,
    onAuthStateChanged,
    login,
    signUp,
    logout
  };
})();
