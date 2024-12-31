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
  apiKeys,
  setApiKeys,
  showSidebar,
  setShowSidebar,
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

  const sortedChats = [...chats].sort((a, b) => {
    const timeA = a.createdAt?.seconds || 0;
    const timeB = b.createdAt?.seconds || 0;
    return timeB - timeA;
  });

  return (
    <aside className={`sidebar ${showSidebar ? "show" : "hide"}`}>
      <div className="sidebar-header">
        <button onClick={createNewChat} className="inline-icon new-chat">
          <AddIcon /> New Chat
        </button>
        <Modal
          apiKeys={apiKeys}
          setApiKeys={setApiKeys}
          showModal={showModal}
          setShowModal={setShowModal}
          user={user}
        />
      </div>

      <div className="chats-list">
        {sortedChats.map((conv) => (
          <div
            key={conv.id}
            className={`chat-item ${
              conv.id === currentChat?.id ? "active" : ""
            }`}
            onClick={() => {
              setCurrentChat(conv);
              if (window.innerWidth <= 768) {
                setShowSidebar(false);
              }
            }}
          >
            <div className="chat-title">{conv.title}</div>
            <div className="chat-timestamp">
              {conv.createdAt?.seconds
                ? new Date(conv.createdAt.seconds * 1000).toLocaleString()
                : "Just now"}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
