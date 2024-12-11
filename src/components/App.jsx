import { useState, useRef, useEffect } from "react";
import "./App.scss";
import MicIcon from "@mui/icons-material/Mic";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import SendIcon from "@mui/icons-material/Send";
import { Modal } from "./Modal";

import { auth, db } from "../firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

function App() {
  const [user, setUser] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        // Fetch user's API key from Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          console.log("API KEY", userDoc.data().apiKey);

          setApiKey(userDoc.data().apiKey);
        }
      } else {
        setUser(null);
        setApiKey("");
      }
    });

    return () => unsubscribe();
  }, []);

  // Save API key to Firestore
  const saveApiKey = async (newApiKey) => {
    if (!user) return;
    console.log("saving");
    try {
      await setDoc(doc(db, "users", user.uid), {
        apiKey: newApiKey,
      });
      setApiKey(newApiKey);
    } catch (error) {
      console.error("Error saving API key:", error);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      mediaRecorder.current.ondataavailable = (e) =>
        chunks.current.push(e.data);
      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(chunks.current, { type: "audio/wav" });
        await transcribeAudio(audioBlob);
        chunks.current = [];
      };
      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob) => {
    if (!apiKey) {
      alert("Please enter your OpenAI API key first");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.wav");
      formData.append("model", "whisper-1");

      const response = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        }
      );
      const data = await response.json();
      if (data.text) setPrompt(data.text);
    } catch (err) {
      alert("Error transcribing audio. Please check your API key.");
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!apiKey) {
      alert("Please enter your OpenAI API key first");
      return;
    }
    if (!prompt.trim()) return;

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
          }),
        }
      );
      const data = await response.json();
      console.log(data);
      // Handle response as needed
    } catch (err) {
      alert("Error sending prompt. Please check your API key.");
    }
  };

  return (
    <div className="App">
      <Modal
        apiKey={apiKey}
        setApiKey={saveApiKey}
        showModal={showModal}
        setShowModal={setShowModal}
        isSaved={isSaved}
        setIsSaved={setIsSaved}
        user={user}
      />

      <div className="input">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt..."
        />
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={loading || !apiKey}
          className="icon recording-button"
        >
          {isRecording ? <StopCircleIcon className="red" /> : <MicIcon />}
        </button>

        <button
          onClick={handleSubmit}
          disabled={!prompt.trim() || loading || !apiKey}
          className="submit-button inline-icon"
        >
          <SendIcon />
          Submit
        </button>
      </div>
    </div>
  );
}

export default App;
