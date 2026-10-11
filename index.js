// Cloud Function: permanently delete a member (Auth account + Firestore profile + notifications).
// Deploy:  firebase deploy --only functions:adminDeleteMember   (requires the Blaze plan)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

exports.adminDeleteMember = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const caller = await db.doc(`admins/${req.auth.uid}`).get();
  if (!caller.exists || caller.data().active !== true) throw new HttpsError("permission-denied", "Admins only.");

  const uid = String(req.data?.uid || "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  if (uid === req.auth.uid) throw new HttpsError("failed-precondition", "You cannot delete your own account.");
  if ((await db.doc(`admins/${uid}`).get()).exists) throw new HttpsError("failed-precondition", "Remove admin access before deleting this account.");

  // 1) Auth account (ignore "not found" so a retry can finish cleanup)
  try { await admin.auth().deleteUser(uid); }
  catch (e) { if (e.code !== "auth/user-not-found") throw new HttpsError("internal", e.message); }

  // 2) Firestore profile (recursive, includes any subcollections under users/{uid})
  await db.recursiveDelete(db.doc(`users/${uid}`));

  // 3) Notifications addressed to this member
  const n = await db.collection("notifications").where("recipientId", "==", uid).get();
  for (let i = 0; i < n.docs.length; i += 400) {
    const b = db.batch(); n.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit();
  }
  return { ok: true };
});
