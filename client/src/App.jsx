import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import Editor from './editor/Editor';

// Server URL
const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';
const DOC_ID = process.env.REACT_APP_DOC_ID || 'shared-doc';
const USER_STORAGE_KEY = 'collab_userId';

export default function App() {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [predefined, setPredefined] = useState([]);
  const [showChooser, setShowChooser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function initUser() {
      try {
        const storedId = localStorage.getItem(USER_STORAGE_KEY);
        if (storedId) {
          const res = await fetch(`${SERVER_URL}/users/${storedId}`);
          if (res.ok) {
            const data = await res.json();
            if (!cancelled) setUser({ userId: data.userId, name: data.name });
            return;
          } else {
            const p = await fetch(`${SERVER_URL}/users/predefined`);
            const list = p.ok ? (await p.json()).users : [];
            if (!cancelled) {
              setPredefined(list);
              setShowChooser(true);
            }
            return;
          }
        } else {
          const p = await fetch(`${SERVER_URL}/users/predefined`);
          const list = p.ok ? (await p.json()).users : [];
          if (!cancelled) {
            setPredefined(list);
            setShowChooser(true);
          }
          return;
        }
      } catch (err) {
        console.error('client: init user error', err);
        try {
          const p = await fetch(`${SERVER_URL}/users/predefined`);
          const list = p.ok ? (await p.json()).users : [];
          if (!cancelled) {
            setPredefined(list);
            setShowChooser(true);
          }
        } catch (e) {
          console.error('client: failed', e);
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    initUser();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    console.log('client: create socket for', user.userId);

    const s = io(SERVER_URL, {
      autoConnect: true,
      auth: { userId: user.userId, docId: DOC_ID }
    });

    s.on('connect', () => {
      console.log('client: socket connected', s.id);
    });
    s.on('connect_error', (err) => {
      console.error('client: socket connect error', err);
    });
    s.on('doc-full', ({ message }) => {
      alert(message || 'Document is full (2 users max)');
    });
    s.on('join-error', ({ error }) => {
      console.error('client: join error', error);
      alert('Join error: ' + (error || 'unknown'));
    });

    setSocket(s);

    return () => {
      try { s.disconnect(); } catch (e) {}
      setSocket(null);
    };
  }, [user]);

  const choosePredefined = (u) => {
    localStorage.setItem(USER_STORAGE_KEY, u.userId);
    setUser({ userId: u.userId, name: u.name });
    setShowChooser(false);
  };

  if (initializing) {
    return <div style={{ padding: 20 }}>Initializing...</div>;
  }

  if (showChooser) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Pick a user</h2>
        <p>Choose a user to continue.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          {predefined.map(u => (
            <button key={u.userId} onClick={() => choosePredefined(u)} style={{ padding: '10px 14px' }}>
              {u.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return <div style={{ padding: 20 }}>Could not initialize user. Check server.</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Collab Editor</h1>
        <div className="meta">
          <label style={{ marginRight: 12 }}>
            Your name:
            <input
              value={user.name}
              onChange={(e) => {
                const newName = e.target.value;
                setUser(prev => ({ ...prev, name: newName }));
                fetch(`${SERVER_URL}/users/${user.userId}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: newName })
                }).catch(err => console.error('client: name update error', err));
              }}
              className="name-input"
            />
          </label>
          <small style={{ color: '#6b7280' }}>ID: {user.userId}</small>
        </div>
      </header>

      <main>
        {socket ? (
          <Editor
            socket={socket}
            userName={user.name}
            userId={user.userId}
            docId={DOC_ID}
          />
        ) : (
          <p>Connecting...</p>
        )}
      </main>

      <footer className="footer">
        <small>Developed By Nauman Shiraz - Real Time Collaboration Document.</small>
      </footer>
    </div>
  );
}