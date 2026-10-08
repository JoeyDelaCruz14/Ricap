import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyDdSMnvhRxIm4u_lgH5b08256bat2pd47o",
    authDomain: "ricap-35aa9.firebaseapp.com",
    databaseURL: "https://ricap-35aa9-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ricap-35aa9",
    storageBucket: "ricap-35aa9.firebasestorage.app",
    messagingSenderId: "763940333795",
    appId: "1:763940333795:web:4eb203a0878860343a7dd6",
    measurementId: "G-CJ26DXVBVJ"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);
export const auth = getAuth(app);