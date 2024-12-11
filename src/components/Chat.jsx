import { useState, useRef, useEffect } from "react";
import { db } from "../firebase";
import { doc, updateDoc } from "firebase/firestore";
import MicIcon from "@mui/icons-material/Mic";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import SendIcon from "@mui/icons-material/Send";
import "./Chat.scss";

export function Chat({ chat, apiKey, user, updateChats }) {
  const [prompt, setPrompt] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const [messages, setMessages] = useState(chat.messages || []);

  useEffect(() => {
    setMessages(chat.messages || []);
  }, [chat]);

  const handleSubmit = async () => {
    if (!apiKey || !prompt.trim()) return;

    const message = {
      role: "user",
      content: prompt,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, message]);

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey.trim()}`,
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [...messages, message].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "API request failed");
      }

      const data = await response.json();
      const assistantMessage = {
        role: "assistant",
        content: data.choices[0].message.content,
        timestamp: new Date(),
      };

      const newMessages = [...messages, message, assistantMessage];
      setMessages(newMessages);

      await updateDoc(doc(db, "chats", chat.id), {
        messages: newMessages,
      });

      updateChats((prev) =>
        prev.map((conv) =>
          conv.id === chat.id
            ? {
                ...conv,
                messages: newMessages,
              }
            : conv
        )
      );

      setPrompt("");
    } catch (err) {
      alert(`Error: ${err.message}`);
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

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            {message.content}
          </div>
        ))}
      </div>

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
