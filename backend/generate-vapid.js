// Run once: node generate-vapid.js
// Prints a pair of keys. Paste into .env as VAPID_PUBLIC / VAPID_PRIVATE.
import webpush from "web-push";
const keys = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC=" + keys.publicKey);
console.log("VAPID_PRIVATE=" + keys.privateKey);
