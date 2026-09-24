import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Filter, X } from "lucide-react";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import "./LandingPage.css";

function shuffleProfiles(profiles) {
  const shuffled = [...profiles];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
  }
  return shuffled;
}

function LandingPage() {
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filter State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [degreeFilter, setDegreeFilter] = useState("");
  const [societyFilter, setSocietyFilter] = useState("");
  const [interestFilter, setInterestFilter] = useState("");

  // -----------------------------------------
  // LOAD & MATCH USERS
  // -----------------------------------------

  async function loadProfiles() {
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate("/login");
        return;
      }

      // 1. Fetch current user
      const userDocRef = doc(db, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (!userDocSnap.exists()) return;
      const targetUser = { id: userDocSnap.id, ...userDocSnap.data() };

      // 2. Fetch all other users
      const usersSnapshot = await getDocs(collection(db, "users"));
      let otherUsers = usersSnapshot.docs
        .filter((userDoc) => userDoc.id !== user.uid)
        .map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data(),
        }));

      // 3. Apply Local Filters (if active)
      if (degreeFilter) {
        otherUsers = otherUsers.filter((u) =>
          u.degree?.toLowerCase().includes(degreeFilter.toLowerCase())
        );
      }
      
      if (societyFilter) {
        otherUsers = otherUsers.filter((u) =>
          u.societies?.some((soc) => soc.toLowerCase().includes(societyFilter.toLowerCase()))
        );
      }

      if (interestFilter) {
        otherUsers = otherUsers.filter((u) =>
          u.interests?.some((int) => int.toLowerCase().includes(interestFilter.toLowerCase()))
        );
      }

      // 4. Send to Python Backend for Jaccard Matching
      try {
        const response = await fetch("https://chum-buddies-backend.onrender.com/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_user: targetUser,
            all_users: otherUsers,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          // Backend returns sorted matches based on compatibility
          setProfiles(data.matches);
        } else {
          // Fallback if backend throws an error
          setProfiles(shuffleProfiles(otherUsers));
        }
      } catch (backendError) {
        console.warn("Backend offline. Falling back to random shuffle.", backendError);
        setProfiles(shuffleProfiles(otherUsers));
      }
    } catch (error) {
      console.error("Error loading profiles:", error);
    } finally {
      setLoading(false);
      setCurrentIndex(0); // Reset index for new results
    }
  }

  // Trigger load initially, and re-trigger whenever the filter is applied
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) loadProfiles();
    });
    return () => unsubscribe();
  }, [navigate]);

  // -----------------------------------------
  // PROFILE NAVIGATION
  // -----------------------------------------

  const currentProfile = profiles[currentIndex] || null;

  function showNextProfile() {
    if (profiles.length === 0) return;

    if (currentIndex < profiles.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      return;
    }

    // Reached the end. Shuffle for discovery.
    const reshuffledProfiles = shuffleProfiles(profiles);
    setProfiles(reshuffledProfiles);
    setCurrentIndex(0);
  }

  // -----------------------------------------
  // CHECK FOR MUTUAL MATCH
  // -----------------------------------------

  async function checkForMatch(currentUserId, otherUserId) {
    try {
      // Reverse swipe: other user -> current user
      const reverseSwipeId = `${otherUserId}_${currentUserId}`;
      const reverseSwipeSnapshot = await getDoc(doc(db, "swipes", reverseSwipeId));

      if (!reverseSwipeSnapshot.exists()) {
        return false;
      }

      const reverseSwipe = reverseSwipeSnapshot.data();
      if (reverseSwipe.decision !== "interested") {
        return false;
      }

      // Match found! Add each user to the other's friends array.
      const batch = writeBatch(db);
      const currentUserRef = doc(db, "users", currentUserId);
      const otherUserRef = doc(db, "users", otherUserId);

      batch.update(currentUserRef, {
        friends: arrayUnion(otherUserId),
      });

      batch.update(otherUserRef, {
        friends: arrayUnion(currentUserId),
      });

      await batch.commit();
      console.log("Match created between:", currentUserId, otherUserId);
      return true;
    } catch (error) {
      console.error("Error creating match:", error);
      return false;
    }
  }

  // -----------------------------------------
  // HANDLE X / TICK
  // -----------------------------------------

  async function handleDecision(decision) {
    const user = auth.currentUser;
    if (!user || !currentProfile) return;

    const selectedProfile = currentProfile; // Preserve this profile before moving the UI forward
    showNextProfile(); // Move immediately so discovery stays responsive.

    try {
      const swipeId = `${user.uid}_${selectedProfile.id}`;

      // Always save this user's decision.
      await setDoc(
        doc(db, "swipes", swipeId),
        {
          fromUserId: user.uid,
          toUserId: selectedProfile.id,
          decision,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Passing does not need any reciprocal-match check.
      if (decision !== "interested") return;

      // Check whether the other person already liked this user.
      await checkForMatch(user.uid, selectedProfile.id);

    } catch (error) {
      console.error("Error saving decision:", error);
    }
  }

  // -----------------------------------------
  // PAGE RENDER
  // -----------------------------------------

  if (loading) {
    return (
      <main className="landing-page">
        <div className="landing-container">
          <p>Loading people...</p>
        </div>
      </main>
    );
  }

  const inputStyle = {
    width: "100%", padding: "12px 16px", borderRadius: "12px", 
    border: "1px solid #cfd0d3", marginBottom: "20px", fontSize: "15px"
  };

  return (
    <main className="landing-page">
      <div className="landing-container">
        {/* PAGE HEADING & FILTER BUTTON */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <section className="landing-heading" style={{ marginBottom: "20px" }}>
            <p className="landing-eyebrow">DISCOVER</p>
            <h1>Find your people.</h1>
            <p>Meet students across campus and connect with people you might get along with.</p>
          </section>

          <button 
            onClick={() => setIsFilterOpen(true)}
            style={{ 
              display: "flex", alignItems: "center", gap: "8px", 
              padding: "10px 16px", borderRadius: "12px", border: "1px solid #cfd0d3",
              background: "white", cursor: "pointer", fontWeight: "bold", marginBottom: "20px"
            }}
          >
            <Filter size={18} />
            Filter
          </button>
        </div>

        {/* NO OTHER USERS */}
        {!currentProfile ? (
          <section className="landing-empty-card">
            <p className="landing-eyebrow">NO PROFILES YET</p>
            <h2>No chums found.</h2>
            <p>Try adjusting your filters or waiting for more students to join!</p>
          </section>
        ) : (
          <div className="landing-profile-area">
            {/* PROFILE CARD */}
            <article className="landing-profile-card" key={currentProfile.id}>
              
              {/* COMPATIBILITY INDICATOR */}
              {currentProfile.match_score !== undefined && (
                <div style={{
                  position: "absolute", top: "16px", right: "16px",
                  background: currentProfile.match_score > 0.4 ? "var(--ochre)" : "var(--charcoal)",
                  color: "white", padding: "6px 12px", borderRadius: "20px",
                  fontWeight: "bold", fontSize: "12px", zIndex: 10
                }}>
                  {Math.round(currentProfile.match_score * 100)}% Match
                </div>
              )}

              <div className="landing-profile-top">
                <div className="landing-profile-picture">
                  {currentProfile.profilePicture ? (
                    <img src={currentProfile.profilePicture} alt={`${currentProfile.name}'s profile`} />
                  ) : (
                    <span>{currentProfile.name ? currentProfile.name.charAt(0).toUpperCase() : "?"}</span>
                  )}
                </div>

                <div className="landing-profile-info">
                  <p className="landing-profile-eyebrow">STUDENT PROFILE</p>
                  <div className="landing-name-row">
                    <h2>{currentProfile.name || "USYD Student"}</h2>
                    {currentProfile.pronouns && <span>{currentProfile.pronouns}</span>}
                  </div>

                  {(currentProfile.degree || currentProfile.major) && (
                    <p className="landing-study">
                      {[currentProfile.degree, currentProfile.major].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {currentProfile.bio && <p className="landing-bio">{currentProfile.bio}</p>}
                </div>
              </div>

              <ProfileTags title="Interests" items={currentProfile.interests} highlight />
              <ProfileTags title="Languages" items={currentProfile.languages} />
              <ProfileTags title="Societies" items={currentProfile.societies} />
            </article>

            {/* X / TICK BUTTONS */}
            <div className="landing-actions">
              <button
                type="button"
                className="landing-action-button landing-pass-button"
                aria-label="Pass"
                onClick={() => handleDecision("pass")}
              >
                <X size={30} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                className="landing-action-button landing-connect-button"
                aria-label="Connect"
                onClick={() => handleDecision("interested")}
              >
                <Check size={31} strokeWidth={2.7} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FILTER MODAL */}
      {isFilterOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%", 
          background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", 
          justifyContent: "center", zIndex: 100
        }} onClick={() => setIsFilterOpen(false)}>
          
          <div style={{
            background: "white", padding: "32px", borderRadius: "24px", 
            width: "min(400px, 90%)", boxShadow: "0 24px 70px rgba(0,0,0,0.18)"
          }} onClick={(e) => e.stopPropagation()}>
            
            <h2 style={{ marginTop: 0, marginBottom: "8px" }}>Filter Profiles</h2>
            <p style={{ color: "#777", fontSize: "14px", marginBottom: "24px" }}>
              Narrow down your recommendations.
            </p>

            <label style={{ display: "block", fontWeight: "bold", marginBottom: "8px", fontSize: "14px" }}>
              Degree Contains:
            </label>
            <input 
              type="text" 
              placeholder="e.g. Software Engineering"
              value={degreeFilter}
              onChange={(e) => setDegreeFilter(e.target.value)}
              style={inputStyle}
            />

            <label style={{ display: "block", fontWeight: "bold", marginBottom: "8px", fontSize: "14px" }}>
              Society Contains:
            </label>
            <input 
              type="text" 
              placeholder="e.g. SYNCS"
              value={societyFilter}
              onChange={(e) => setSocietyFilter(e.target.value)}
              style={inputStyle}
            />

            <label style={{ display: "block", fontWeight: "bold", marginBottom: "8px", fontSize: "14px" }}>
              Interest Contains:
            </label>
            <input 
              type="text" 
              placeholder="e.g. Gaming"
              value={interestFilter}
              onChange={(e) => setInterestFilter(e.target.value)}
              style={inputStyle}
            />

            <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
              <button 
                onClick={() => { 
                  setDegreeFilter(""); 
                  setSocietyFilter(""); 
                  setInterestFilter(""); 
                  setIsFilterOpen(false); 
                  loadProfiles(); 
                }}
                style={{ flex: 1, padding: "12px", borderRadius: "12px", border: "1px solid #cfd0d3", background: "white", fontWeight: "bold", cursor: "pointer" }}
              >
                Clear All
              </button>
              <button 
                onClick={() => { setIsFilterOpen(false); loadProfiles(); }}
                style={{ flex: 1, padding: "12px", borderRadius: "12px", border: "none", background: "var(--ochre)", color: "white", fontWeight: "bold", cursor: "pointer" }}
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

// -----------------------------------------
// PROFILE TAG SECTION
// -----------------------------------------
function ProfileTags({ title, items = [], highlight = false }) {
  if (!items?.length) return null;

  return (
    <section className="landing-profile-section">
      <h3>{title}</h3>
      <div className="landing-profile-tags">
        {items.map((item) => (
          <span
            key={item}
            className={highlight ? "landing-profile-tag highlighted" : "landing-profile-tag"}
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

export default LandingPage;