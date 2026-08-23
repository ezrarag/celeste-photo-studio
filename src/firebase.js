import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut as firebaseSignOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot,
  collection,
  addDoc,
  updateDoc,
  query,
  orderBy,
  getDocs
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== "your_api_key_here" && 
  firebaseConfig.projectId
);

let app = null;
let auth = null;
let db = null;
let googleProvider = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

export { auth, db, googleProvider };

export function getAllowedAdminEmails() {
  const envEmails = import.meta.env.VITE_ADMIN_EMAILS || "ezra@readyaimgo.biz";
  return envEmails
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isUserAdmin(userEmail) {
  if (!userEmail) return false;
  const allowedEmails = getAllowedAdminEmails();
  return allowedEmails.includes(userEmail.toLowerCase());
}

export async function loginWithGoogle() {
  if (!isFirebaseConfigured || !auth || !googleProvider) {
    throw new Error("Firebase is not configured yet. Please set up your .env.local file or Vercel environment variables.");
  }
  return await signInWithPopup(auth, googleProvider);
}

export async function logoutUser() {
  if (auth) {
    return await firebaseSignOut(auth);
  }
}

export function subscribeToAuthState(callback) {
  if (!isFirebaseConfigured || !auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

// Firestore collection & document key for site content
const CONTENT_DOC_PATH = ["site_settings", "content"];

export async function getSiteContentFromFirestore() {
  if (!isFirebaseConfigured || !db) return null;
  try {
    const docRef = doc(db, CONTENT_DOC_PATH[0], CONTENT_DOC_PATH[1]);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return snapshot.data();
    }
  } catch (err) {
    console.warn("Could not fetch site content from Firestore:", err);
  }
  return null;
}

export function subscribeToSiteContent(callback) {
  if (!isFirebaseConfigured || !db) return () => {};
  const docRef = doc(db, CONTENT_DOC_PATH[0], CONTENT_DOC_PATH[1]);
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data());
    }
  }, (err) => {
    console.warn("Snapshot error:", err);
  });
}

export async function saveSiteContentToFirestore(data) {
  if (!isFirebaseConfigured || !db) {
    throw new Error("Firebase is not configured. Please add your Firebase environment variables to .env.local.");
  }
  const docRef = doc(db, CONTENT_DOC_PATH[0], CONTENT_DOC_PATH[1]);
  await setDoc(docRef, {
    ...data,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

// Firestore Feedback Collection Helpers
const FEEDBACK_COLLECTION = "feedback";

export async function addFeedbackToFirestore({ comment, screenshotBase64, targetElement, createdAt, status = "Open" }) {
  if (!isFirebaseConfigured || !db) {
    console.warn("Firebase not configured. Feedback saved locally.");
    return { id: "local-" + Date.now() };
  }
  const colRef = collection(db, FEEDBACK_COLLECTION);
  const docRef = await addDoc(colRef, {
    comment: comment || "",
    screenshotBase64: screenshotBase64 || null,
    targetElement: targetElement || "body",
    createdAt: createdAt || new Date().toISOString(),
    status: status || "Open"
  });
  return docRef;
}

export function subscribeToFeedback(callback) {
  if (!isFirebaseConfigured || !db) return () => {};
  try {
    const colRef = collection(db, FEEDBACK_COLLECTION);
    const q = query(colRef, orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      callback(docs);
    }, (err) => {
      console.warn("Feedback snapshot error:", err);
    });
  } catch (e) {
    console.warn("Feedback query error:", e);
    return () => {};
  }
}

export async function updateFeedbackStatusInFirestore(feedbackId, newStatus) {
  if (!isFirebaseConfigured || !db) return;
  const docRef = doc(db, FEEDBACK_COLLECTION, feedbackId);
  await updateDoc(docRef, {
    status: newStatus,
    updatedAt: new Date().toISOString()
  });
}

