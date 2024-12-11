import { useCallback, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import AddIcon from "@mui/icons-material/Add";
import { Modal } from "./Modal";
import "./Sidebar.scss";

export function Sidebar({
  chats,
  setChats,
  currentChat,
  setCurrentChat,
  user,
  apiKey,
  setApiKey,
}) {
  const [showModal, setShowModal] = useState(false);

  const createNewChat = useCallback(async () => {
    if (!user) return;

    const newChat = {
      userId: user.uid,
      title: "New Chat",
      messages: [],
      createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, "chats"), newChat);
    const chatWithId = { ...newChat, id: docRef.id };

    setChats((prev) => [...prev, chatWithId]);
    setCurrentChat(chatWithId);
  }, [user, setChats, setCurrentChat]);

  const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.seconds) return "Just now";
    const date = new Date(timestamp.seconds * 1000);
    const isValid = !isNaN(date.getTime());
    return isValid
      ? date.toLocaleDateString() +
          " " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button onClick={createNewChat} className="inline-icon new-chat">
          <AddIcon /> New Chat
        </button>
        <Modal
          apiKey={apiKey}
          setApiKey={setApiKey}
          showModal={showModal}
          setShowModal={setShowModal}
          user={user}
        />
      </div>

      <div className="chats-list">
        {chats
          .map((conv) => (
            <div
              key={conv.id}
              className={`chat-item ${
                conv.id === currentChat?.id ? "active" : ""
              }`}
              onClick={() => setCurrentChat(conv)}
            >
              <div className="chat-title">{conv.title}</div>
              <div className="chat-timestamp">{formatDate(conv.createdAt)}</div>
            </div>
          ))
          .reverse()}
      </div>
    </aside>
  );
}
