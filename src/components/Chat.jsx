import { useState, useRef, useEffect } from "react";
import { db } from "../firebase";
import { doc, updateDoc } from "firebase/firestore";
import MicIcon from "@mui/icons-material/Mic";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import SendIcon from "@mui/icons-material/Send";
import MenuIcon from "@mui/icons-material/Menu";
import TextareaAutosize from "react-textarea-autosize";

import "./Chat.scss";

export function Chat({ chat, apiKeys, user, updateChats, onMenuClick }) {
  const [prompt, setPrompt] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const [messages, setMessages] = useState(chat.messages || []);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const [selectedAPI, setSelectedAPI] = useState("openai");
  const requestStartTime = useRef(null);

  useEffect(() => {
    setMessages(chat.messages || []);
    textareaRef.current?.focus();
  }, [chat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "instant",
    });
  }, [messages]);

  const getApiKey = () => {
    return selectedAPI === "claude" ? apiKeys?.claude : apiKeys?.openai;
  };

  const getModelName = () => {
    return selectedAPI === "claude"
      ? "claude-3-opus-20240229"
      : "gpt-3.5-turbo";
  };

  const callClaudeAPI = async (messages) => {
    const response = await fetch("/claude/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": getApiKey(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-3-opus-20240229",
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Claude API request failed");
    }

    const data = await response.json();
    return data.content[0].text;
  };

  const callOpenAIAPI = async (messages) => {
    const response = await fetch("/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "OpenAI API request failed");
    }

    const data = await response.json();
    return data.choices[0].message.content;
  };

  const handleSubmit = async (inputPrompt = prompt) => {
    const currentApiKey = getApiKey();
    if (!currentApiKey || !inputPrompt.trim()) return;
    setLoading(true);
    requestStartTime.current = Date.now();

    const message = {
      role: "user",
      content: inputPrompt,
      timestamp: new Date(),
    };

    setPrompt("");
    setMessages((prev) => [...prev, message]);

    try {
      const allMessages = [...messages, message];
      const responseContent = await (selectedAPI === "claude"
        ? callClaudeAPI(allMessages)
        : callOpenAIAPI(allMessages));

      const requestDuration = Date.now() - requestStartTime.current;

      const assistantMessage = {
        role: "assistant",
        content: responseContent,
        timestamp: new Date(),
        model: getModelName(),
        requestDuration, // Add request duration in milliseconds
      };

      const newMessages = [...allMessages, assistantMessage];
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
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
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
    const currentApiKey = getApiKey();
    if (!currentApiKey) {
      alert("Please enter your API key first");
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
            Authorization: `Bearer ${apiKeys.openai}`,
          },
          body: formData,
        }
      );
      const data = await response.json();
      if (data.text) {
        await handleSubmit(data.text);
      }
    } catch (err) {
      alert("Error transcribing audio. Please check your API key.");
    }
    setLoading(false);
  };

  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="chat">
      <div className="chat-header">
        {window.innerWidth <= 768 && (
          <button className="menu-button icon" onClick={onMenuClick}>
            <MenuIcon />
          </button>
        )}
      </div>
      <div className="messages">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-content">
              <span>{message.content}</span>
              <div className="message-metadata">
                {message.model && (
                  <span className="message-model">{message.model}</span>
                )}
                {message.requestDuration && (
                  <span className="message-duration">
                    in {formatDuration(message.requestDuration)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <div className="loading-indicator">
              <div className="loading-dots">
                <div></div>
                <div></div>
                <div></div>
              </div>
              <span>Generating response...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input">
        <TextareaAutosize
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your prompt..."
          disabled={loading}
        />
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={loading || !apiKeys.openai}
          className="icon recording-button"
        >
          {isRecording ? <StopCircleIcon className="red" /> : <MicIcon />}
        </button>
        <div className="submit-group">
          <div className="api-selector">
            <select
              value={selectedAPI}
              onChange={(e) => setSelectedAPI(e.target.value)}
              disabled={loading}
            >
              <option value="openai">OpenAI</option>
              <option value="claude">Claude</option>
            </select>
          </div>
          <button
            onClick={() => handleSubmit()}
            disabled={!prompt.trim() || loading || !getApiKey()}
            className="submit-button inline-icon"
          >
            <SendIcon />
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
