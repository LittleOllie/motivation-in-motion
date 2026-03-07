/**
 * Firebase configuration for Motivation in Motion.
 * Replace with your project's config from Firebase Console.
 */
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID'
};

// Initialize Firebase (only if Firebase SDK is loaded)
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
}
