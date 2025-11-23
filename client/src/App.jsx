import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import Editor from './editor/Editor';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';
const DOC_ID = process.env.REACT_APP_DOC_ID || 'shared-doc';

export default function App() {
  const [socket, setSocket] = useState(null);
  const [userName, setUserName] = useState(() => {
    const n = Math.floor(Math.random() * 900 + 100);
    return `User${n}`;
  });

  useEffect(() => {
    const s = io(SERVER_URL);
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Real-Time Document Collaboration</h1>
        <div className="meta">
          <label>
            Your name:
            <input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="name-input"
            />
          </label>
        </div>
      </header>

      <main>
        {socket ? (
          <Editor
            socket={socket}
            userName={userName}
            docId={DOC_ID}
          />
        ) : (
          <p>Connecting...</p>
        )}
      </main>

      <footer className="footer">
        <small>Made by a Nauman — Real-Time Document Collaboration.</small>
      </footer>
    </div>
  );
}