import { useState, useEffect, useRef } from "react";
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
  const [showSidebar, setShowSidebar] = useState(true);
  const touchStart = useRef(null);
  const touchEnd = useRef(null);

  const MIN_SWIPE_DISTANCE = 1;

  const onTouchStart = (e) => {
    console.log("Start");
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  };

  const onTouchMove = (e) => {
    console.log("Move");
    touchEnd.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    console.log("End");
    if (!touchStart.current || !touchEnd.current) return;
    console.log("End2");
    const distance = touchStart.current - touchEnd.current;
    const isLeftSwipe = distance > MIN_SWIPE_DISTANCE;
    const isRightSwipe = distance < -MIN_SWIPE_DISTANCE;
    console.log(isLeftSwipe, showSidebar, isRightSwipe, distance);
    if (isLeftSwipe && showSidebar) {
      setShowSidebar(false);
    } else if (isRightSwipe && !showSidebar) {
      setShowSidebar(true);
    }
  };

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
    <div
      className="app"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <Sidebar
        chats={chats}
        setChats={setChats}
        currentChat={currentChat}
        setCurrentChat={setCurrentChat}
        user={user}
        apiKeys={apiKeys}
        setApiKeys={setApiKeys}
        showSidebar={showSidebar}
        setShowSidebar={setShowSidebar}
      />
      <main className={`app-body ${!showSidebar ? "full-width" : ""}`}>
        {currentChat ? (
          <Chat
            chat={currentChat}
            apiKeys={apiKeys}
            user={user}
            updateChats={setChats}
            onMenuClick={() => setShowSidebar(true)}
          />
        ) : (
          <div className="empty-state">Select or create a chat</div>
        )}
      </main>
    </div>
  );
}

export default App;
