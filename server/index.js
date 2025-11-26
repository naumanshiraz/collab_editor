const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const { diff_match_patch } = require('diff-match-patch');

const Document = require('./models/Document');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/collab-editor';
const DOC_ID = process.env.DOC_ID || 'shared-doc';
const ROOM_LIMIT = 2;

app.get('/', (req, res) => res.send('Collaborative editor server running'));

app.get('/doc/:docId', async (req, res) => {
  try {
    const doc = await Document.findOne({ docId: req.params.docId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function validateDocument(docId = DOC_ID) {
  let doc = await Document.findOne({ docId });
  if (!doc) {
    doc = new Document({
      docId,
      content: '',
      versionNumber: 1,
      versions: [{
        content: '',
        author: 'system',
        timestamp: new Date(),
        versionNumber: 1
      }],
      lastUpdate: new Date()
    });
    await doc.save();
    console.log('Created initial document:', docId);
  }
  return doc;
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', async ({ user, docId }) => {
    try {
      const id = docId || DOC_ID;
      const room = io.sockets.adapter.rooms.get(id);
      const occupants = room ? room.size : 0;
      if (occupants >= ROOM_LIMIT) {
        socket.emit('room-full', { message: 'Room is full (max 2 users)' });
        console.log(`Connection refused for ${socket.id} to ${id} (room full)`);
        return;
      }

      socket.join(id);
      let doc = await Document.findOne({ docId: id });
      if (!doc) {
        doc = await validateDocument(id);
      }

      socket.emit('init', {
        content: doc.content,
        versionNumber: doc.versionNumber,
        versions: doc.versions
      });

      socket.to(id).emit('user-joined', { user });
      console.log(`${user || 'unknown'} joined ${id}`);
    } catch (err) {
      console.error('join error', err);
    }
  });

  socket.on('typing', ({ docId, user, isTyping }) => {
    const id = docId || DOC_ID;
    socket.to(id).emit('typing', { user, isTyping });
  });

  socket.on('patch-edit', async (payload) => {
    try {
      const dmp = new diff_match_patch();
      const id = payload.docId || DOC_ID;
      let doc = await Document.findOne({ docId: id });
      if (!doc) {
        doc = await validateDocument(id);
      }

      const incomingPatchText = payload.patchText;
      const baseVersion = payload.baseVersion;
      const incomingAuthor = payload.user || 'anonymous';
      const incomingTimestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();

      if (!incomingPatchText || incomingPatchText.length === 0) {
        socket.emit('ack', { accepted: false, reason: 'empty-patch', versionNumber: doc.versionNumber });
        return;
      }

      let baseContent = null;
      if (typeof baseVersion === 'number') {
        const baseVerObj = doc.versions.find(v => v.versionNumber === baseVersion);
        if (baseVerObj) baseContent = baseVerObj.content;
      }
      if (baseContent == null) {
        baseContent = doc.content;
      }

      let incomingPatches;
      try {
        incomingPatches = dmp.patch_fromText(incomingPatchText);
      } catch (e) {
        socket.emit('conflict', { reason: 'invalid-patch', message: e.message });
        return;
      }

      const serverCurrent = doc.content;

      const [mergedContent, results] = (() => {
        try {
          const res = dmp.patch_apply(incomingPatches, serverCurrent);
          return res;
        } catch (e) {
          return [null, null];
        }
      })();

      const successRate = results ? (results.filter(Boolean).length / results.length) : 0;
      const lowConfidence = successRate < 0.5;

      if (mergedContent == null) {
        socket.emit('conflict', {
          reason: 'merge-failed',
          message: 'Server failed to apply patch cleanly. Please refresh.',
          serverContent: serverCurrent,
          versionNumber: doc.versionNumber
        });
        return;
      }

      doc.versionNumber += 1;
      doc.content = mergedContent;
      doc.lastUpdate = incomingTimestamp;
      doc.versions.push({
        content: mergedContent,
        author: incomingAuthor,
        timestamp: incomingTimestamp,
        versionNumber: doc.versionNumber
      });

      await doc.save();

      socket.to(id).emit('remote-merge', {
        content: mergedContent,
        author: incomingAuthor,
        versionNumber: doc.versionNumber,
        lowConfidence
      });

      socket.emit('ack', {
        accepted: true,
        versionNumber: doc.versionNumber,
        lowConfidence,
        serverContent: mergedContent
      });

      console.log(`Patch applied v${doc.versionNumber} by ${incomingAuthor} (confidence ${Math.round(successRate*100)}%)`);
    } catch (err) {
      console.error('patch-edit handling error', err);
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to MongoDB');
  await validateDocument();
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});