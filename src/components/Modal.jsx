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

export function Modal({ apiKeys, setApiKeys, showModal, setShowModal, user }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const showToast = useToast();

  const debouncedSetApiKeys = useCallback(
    debounce(async (keys) => {
      if (user) {
        await setDoc(
          doc(db, "users", user.uid),
          { apiKeys: keys },
          { merge: true }
        );
        setApiKeys(keys);
        showToast("API keys saved");
      }
    }, 1000),
    [setApiKeys, showToast, user]
  );

  const handleApiKeyChange = (service, value) => {
    const newKeys = { ...apiKeys, [service]: value.trim() };
    debouncedSetApiKeys(newKeys);
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
                      defaultValue={apiKeys?.openai || ""}
                      onChange={(e) =>
                        handleApiKeyChange("openai", e.target.value)
                      }
                    />
                  </label>
                  <label className="label-input">
                    Claude API key
                    <input
                      type="text"
                      defaultValue={apiKeys?.claude || ""}
                      onChange={(e) =>
                        handleApiKeyChange("claude", e.target.value)
                      }
                    />
                  </label>
                  <div className="user-info">
                    <p>Logged in as: {user.email}</p>
                    <button onClick={() => signOut(auth)}>Sign Out</button>
                  </div>
                </>
              ) : (
                <form onSubmit={handleAuth} className="auth-form">
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
                  <button type="submit" className="submit-auth">
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
