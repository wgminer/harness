import { useState, useEffect, useCallback } from "react";
import { auth, db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import CloseIcon from "@mui/icons-material/Close";
import SettingsIcon from "@mui/icons-material/Settings";
import { debounce } from "lodash";
import { useToast } from "./ToastProvider";
import "./Modal.scss";

export function Modal({ apiKey, setApiKey, showModal, setShowModal, user }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const showToast = useToast();

  const debouncedSetApiKey = useCallback(
    debounce(async (value) => {
      if (user) {
        await setDoc(
          doc(db, "users", user.uid),
          { apiKey: value },
          { merge: true }
        );
        setApiKey(value);
        showToast("API key saved");
      }
    }, 1000),
    [setApiKey, showToast, user]
  );

  const handleApiKeyChange = (e) => {
    const value = e.target.value.trim();
    debouncedSetApiKey(value);
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError("");

    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setShowModal(false);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {user ? "Settings" : isRegistering ? "Register" : "Login"}
              </h2>
              <button
                className="close-button icon"
                onClick={() => setShowModal(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="modal-body">
              {user ? (
                <>
                  <label className="label-input">
                    OpenAI API key
                    <input
                      type="text"
                      defaultValue={apiKey}
                      onChange={handleApiKeyChange}
                    />
                  </label>
                  <div className="user-info">
                    <p>Logged in as: {user.email}</p>
                    <button onClick={() => signOut(auth)}>Sign Out</button>
                  </div>
                </>
              ) : (
                <form onSubmit={handleAuth}>
                  {error && <div className="error">{error}</div>}
                  <label className="label-input">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label className="label-input">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </label>
                  <button type="submit">
                    {isRegistering ? "Register" : "Login"}
                  </button>
                  <button
                    type="button"
                    className="switch-auth"
                    onClick={() => setIsRegistering(!isRegistering)}
                  >
                    {isRegistering
                      ? "Already have an account? Login"
                      : "Need an account? Register"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      <button className="open-button icon" onClick={() => setShowModal(true)}>
        <SettingsIcon />
      </button>
    </>
  );
}
