import React, { useEffect, useRef, useState } from 'react';
import { diff_match_patch } from 'diff-match-patch';

function delayFn(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function saveSelection(containerEl) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const preSelectionRange = range.cloneRange();
  preSelectionRange.selectNodeContents(containerEl);
  preSelectionRange.setEnd(range.startContainer, range.startOffset);
  const start = preSelectionRange.toString().length;

  return {
    start,
    end: start + range.toString().length
  };
}

function restoreSelection(containerEl, savedSel) {
  if (!savedSel) return;
  const charIndex = 0;
  const range = document.createRange();
  range.setStart(containerEl, 0);
  range.collapse(true);
  const nodeStack = [containerEl];
  let node;
  let foundStart = false;
  let stop = false;
  let charCount = 0;

  while (!stop && (node = nodeStack.pop())) {
    if (node.nodeType === 3) {
      const nextCharCount = charCount + node.length;
      if (!foundStart && savedSel.start >= charCount && savedSel.start <= nextCharCount) {
        range.setStart(node, savedSel.start - charCount);
        foundStart = true;
      }
      if (foundStart && savedSel.end >= charCount && savedSel.end <= nextCharCount) {
        range.setEnd(node, savedSel.end - charCount);
        stop = true;
      }
      charCount = nextCharCount;
    } else {
      let i = node.childNodes.length;
      while (i--) {
        nodeStack.push(node.childNodes[i]);
      }
    }
  }

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export default function Editor({ socket, userName, docId }) {
  const editorRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [otherTyping, setOtherTyping] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionNumber, setVersionNumber] = useState(0);
  const [status, setStatus] = useState('connecting');

  const [drawerOpen, setDrawerOpen] = useState(false);

  const lastSyncedRef = useRef({ content: '', version: 0 });

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
      lastSyncedRef.current = { content: content || '', version: vnum || 0 };
      setStatus('Synced');
    });

    socket.on('remote-merge', ({ content, author, versionNumber: vnum, lowConfidence }) => {
      if (editorRef.current) {
        const savedSel = saveSelection(editorRef.current);
        editorRef.current.innerHTML = content;
        restoreSelection(editorRef.current, savedSel);
      }
      setVersionNumber(vnum || versionNumber);
      setStatus(`Updated by ${author}`);
      lastSyncedRef.current = { content, version: vnum };

      setVersions(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.versionNumber !== vnum) {
          return [...prev, { content, author, versionNumber: vnum, timestamp: new Date().toISOString() }];
        }
        return prev;
      });

      if (lowConfidence) {
        setStatus('Merged with low confidence — review content');
      }
    });

    socket.on('typing', ({ user, isTyping }) => {
      if (user === userName) return;
      setOtherTyping(isTyping ? user : null);
    });

    socket.on('ack', ({ accepted, versionNumber: vnum, lowConfidence, serverContent }) => {
      if (accepted) {
        setStatus('Saved');
        setVersionNumber(vnum);
        if (serverContent) {
          lastSyncedRef.current = { content: serverContent, version: vnum };
          if (editorRef.current) {
            const savedSel = saveSelection(editorRef.current);
            editorRef.current.innerHTML = serverContent;
            restoreSelection(editorRef.current, savedSel);
          }
        }
        if (lowConfidence) {
          setStatus('Saved (low confidence merge) — check document');
        }
      } else {
        setStatus('Not saved: ' + (accepted === false && typeof accepted !== 'boolean' ? accepted : 'no'));
      }
    });

    socket.on('conflict', ({ reason, serverContent, versionNumber: vnum, message }) => {
      setStatus('Conflict: ' + (message || reason));
      if (serverContent && editorRef.current) {
        editorRef.current.innerHTML = serverContent;
        lastSyncedRef.current = { content: serverContent, version: vnum };
      }
    });

    socket.on('room-full', (payload) => {
      setStatus(payload?.message || 'Room is full');
    });

    return () => {
      socket.off('init');
      socket.off('remote-merge');
      socket.off('typing');
      socket.off('ack');
      socket.off('conflict');
    };
  }, [socket, userName, docId]);

  const sendTyping = delayFn((isTyping) => {
    if (!socket) return;
    socket.emit('typing', { docId, user: userName, isTyping });
  }, 250);

  const sendPatch = delayFn(() => {
    if (!socket || !editorRef.current) return;

    const dmp = new diff_match_patch();

    const baseContent = lastSyncedRef.current.content || '';
    const currentContent = editorRef.current.innerHTML || '';
    const baseVersion = lastSyncedRef.current.version || 0;

    if (currentContent === baseContent) {
      return;
    }

    const diffs = dmp.diff_main(baseContent, currentContent);
    dmp.diff_cleanupSemantic(diffs);
    const patches = dmp.patch_make(baseContent, diffs);
    const patchText = dmp.patch_toText(patches);

    socket.emit('patch-edit', {
      docId,
      patchText,
      user: userName,
      baseVersion,
      timestamp: new Date().toISOString()
    });

    setStatus('Sending...');
  }, 450);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const onInput = () => {
      sendTyping(true);
      sendPatch();
      stopTyping();
    };

    el.addEventListener('input', onInput);
    el.addEventListener('keydown', () => {
      sendTyping(true);
      stopTyping();
    });

    return () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', () => {});
    };
  }, [editorRef.current, socket]);

  const stopTyping = delayFn(() => {
    sendTyping(false);
  }, 1200);

  const applyFormat = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    sendPatch();
  };

  const toggleDrawer = () => setDrawerOpen(v => !v);
  const closeDrawer = () => setDrawerOpen(false);

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

        <button
          className="button"
          onClick={toggleDrawer}
          aria-expanded={drawerOpen}
          aria-controls="version-drawer"
          title="Open version history"
        >
          Versions
        </button>

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

      <div
        className={`drawer-backdrop ${drawerOpen ? 'open' : ''}`}
        onClick={closeDrawer}
        aria-hidden={!drawerOpen}
      />

      <aside
        id="version-drawer"
        className={`drawer ${drawerOpen ? 'open' : ''}`}
        role="dialog"
        aria-labelledby="version-drawer-title"
        aria-hidden={!drawerOpen}
      >
        <div className="drawer-header">
          <h3 id="version-drawer-title">Version History</h3>
          <button className="button close-btn" onClick={closeDrawer} aria-label="Close versions">Close</button>
        </div>

        <div className="drawer-content">
          {versions.length === 0 ? <p>No versions yet</p> : versions.slice().reverse().map(v => (
            <div key={v.versionNumber} className="version-item">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>v{v.versionNumber}</strong>
                <small style={{ color: '#9aa4b2' }}>{new Date(v.timestamp).toLocaleString()}</small>
              </div>
              <div style={{ marginBottom: 6, color: '#666' }}>by <em>{v.author}</em></div>
              <div className="version-snippet" dangerouslySetInnerHTML={{ __html: v.content }} />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}