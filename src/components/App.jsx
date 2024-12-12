import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Chat } from "./Chat";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import "./App.scss";

function App() {
  const [user, setUser] = useState(null);
  const [apiKeys, setApiKeys] = useState({});
  const [currentChat, setCurrentChat] = useState(null);
  const [chats, setChats] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setApiKeys(userData.apiKeys || {});
        }

        const chatsQuery = query(
          collection(db, "chats"),
          where("userId", "==", user.uid)
        );
        const querySnapshot = await getDocs(chatsQuery);
        const userChats = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setChats(userChats);
      } else {
        setUser(null);
        setApiKeys({});
        setChats([]);
        setCurrentChat(null);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        setChats={setChats}
        currentChat={currentChat}
        setCurrentChat={setCurrentChat}
        user={user}
        apiKeys={apiKeys}
        setApiKeys={setApiKeys}
      />
      <main className="app-body">
        {currentChat ? (
          <Chat
            chat={currentChat}
            apiKeys={apiKeys}
            user={user}
            updateChats={setChats}
          />
        ) : (
          <div className="empty-state">Select or create a chat</div>
        )}
      </main>
    </div>
  );
}

export default App;
