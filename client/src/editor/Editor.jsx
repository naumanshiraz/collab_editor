import React, { useEffect, useRef, useState } from 'react';

function waitForIdle(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export default function Editor({ socket, userName, docId }) {
  const editorRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [otherTyping, setOtherTyping] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionNumber, setVersionNumber] = useState(0);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    if (!socket) return;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.emit('join', { user: userName, docId });

    socket.on('init', ({ content, versionNumber: vnum, versions: vers }) => {
      setVersionNumber(vnum || 0);
      setVersions(vers || []);
      if (editorRef.current) {
        editorRef.current.innerHTML = content || '';
      }
      setStatus('Synced');
    });

    socket.on('remote-edit', ({ content, user, versionNumber: vnum }) => {
      if (editorRef.current) {
        const isFocused = document.activeElement === editorRef.current;
        const sel = window.getSelection();
        let rangeBackup = null;
        if (isFocused && sel.rangeCount > 0) {
          rangeBackup = sel.getRangeAt(0).cloneRange();
        }

        editorRef.current.innerHTML = content;

        if (rangeBackup) {
          try {
            sel.removeAllRanges();
            sel.addRange(rangeBackup);
          } catch (e) {
          }
        }
      }
      setVersionNumber(vnum || versionNumber);
      setStatus(`Updated by ${user || 'someone'}`);
      setVersions(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.versionNumber !== vnum) {
          return [...prev, { content, author: user, versionNumber: vnum, timestamp: new Date().toISOString() }];
        }
        return prev;
      });
    });

    socket.on('typing', ({ user, isTyping }) => {
      if (user === userName) return;
      setOtherTyping(isTyping ? user : null);
    });

    socket.on('ack', ({ accepted, versionNumber: vnum }) => {
      if (accepted) {
        setStatus('Saved');
        setVersionNumber(vnum);
      }
    });

    socket.on('conflict', ({ serverContent, versionNumber: vnum }) => {
      if (editorRef.current) {
        editorRef.current.innerHTML = serverContent;
      }
      setStatus('Conflict resolved by server (refreshed)');
      setVersionNumber(vnum);
    });

    return () => {
      socket.off('init');
      socket.off('remote-edit');
      socket.off('typing');
      socket.off('ack');
      socket.off('conflict');
    };
  }, [socket, userName, docId]);

  const sendTyping = waitForIdle((isTyping) => {
    if (!socket) return;
    socket.emit('typing', { docId, user: userName, isTyping });
  }, 300);

  const sendEdit = waitForIdle(() => {
    if (!socket || !editorRef.current) return;
    const content = editorRef.current.innerHTML;
    const payload = {
      docId,
      content,
      user: userName,
      timestamp: new Date().toISOString(),
      clientVersion: versionNumber
    };
    socket.emit('edit', payload);
    setStatus('Sending...');
  }, 450);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const onInput = (e) => {
      sendTyping(true);
      sendEdit();
      stopTyping();
    };

    el.addEventListener('input', onInput);

    return () => {
      el.removeEventListener('input', onInput);
    };
  }, [editorRef.current, socket, versionNumber, userName]);

  const stopTyping = waitForIdle(() => {
    sendTyping(false);
  }, 1200);

  const applyFormat = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    sendEdit();
  };

  return (
    <div className="main-panel">
      <div className="toolbar">
        <button className="button" onClick={() => applyFormat('bold')}><b>B</b></button>
        <button className="button" onClick={() => applyFormat('italic')}><i>I</i></button>
        <button className="button" onClick={() => applyFormat('underline')}><u>U</u></button>

        <select className="select" onChange={(e) => applyFormat('fontName', e.target.value)}>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Georgia">Georgia</option>
          <option value="Courier New">Courier New</option>
          <option value="Verdana">Verdana</option>
        </select>

        <input
          type="color"
          title="Font color"
          onChange={(e) => applyFormat('foreColor', e.target.value)}
        />

        <div style={{ marginLeft: 'auto', color: '#6b7280' }}>
          <small>v{versionNumber} — {status}</small>
        </div>
      </div>

      <div
        ref={editorRef}
        className="editor-area"
        contentEditable
        suppressContentEditableWarning
        spellCheck={true}
        style={{ whiteSpace: 'pre-wrap' }}
        onFocus={() => {
          sendTyping(true);
          stopTyping();
        }}
        onBlur={() => {
          sendTyping(false);
        }}
      />

      <div className="meta-row">
        <div>{otherTyping ? <em>{otherTyping} is typing...</em> : <span>&nbsp;</span>}</div>
      </div>

      <div className="history">
        <h4>Version History</h4>
        {versions.length === 0 ? <p>No versions yet</p> : versions.slice().reverse().map(v => (
          <div key={v.versionNumber} className="version-item">
            <strong>v{v.versionNumber}</strong> by <em>{v.author}</em> — <small style={{color:'#9aa4b2'}}>{new Date(v.timestamp).toLocaleString()}</small>
            <div dangerouslySetInnerHTML={{ __html: v.content }} />
          </div>
        ))}
      </div>
    </div>
  );
}