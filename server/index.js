const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const DiffMatchPatch = require('diff-match-patch');
require('dotenv').config();

const Document = require('./models/Document');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/collab-editor';
const DOC_ID = process.env.DOC_ID || 'shared-doc';

const socketToUser = new Map();

const PREDEFINED_USERS = [
  { userId: 'nauman', name: 'Nauman' },
  { userId: 'omar', name: 'Omar' }
];

app.get('/', (req, res) => res.send('Server running'));

app.get('/users/predefined', async (req, res) => {
  try {
    res.json({ users: PREDEFINED_USERS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/doc/:docId', async (req, res) => {
  try {
    const doc = await Document.findOne({ docId: req.params.docId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function validateDocument() {
  let doc = await Document.findOne({ docId: DOC_ID });
  if (!doc) {
    doc = new Document({
      docId: DOC_ID,
      content: 'Welcome to the shared document. Start typing!',
      versionNumber: 1,
      ops: [{
        type: 'patch',
        pos: 0,
        text: 'Welcome to the shared document. Start typing!',
        author: 'system',
        timestamp: new Date(),
        versionNumber: 1,
        snapshot: 'Welcome to the shared document. Start typing!'
      }],
      users: []
    });
    await doc.save();
    console.log('server: created document', DOC_ID);
  }
  return doc;
}

async function validateUser() {
  for (const u of PREDEFINED_USERS) {
    const existing = await User.findOne({ userId: u.userId });
    if (!existing) {
      try {
        const nu = new User({ userId: u.userId, name: u.name });
        await nu.save();
        console.log('server: created user', u.userId);
      } catch (err) {
        console.warn('server: could not create user', u.userId, err.message);
      }
    } else if (existing.name !== u.name) {
      existing.name = u.name;
      await existing.save();
      console.log('server: updated user name', u.userId);
    }
  }
}

io.on('connection', (socket) => {
  console.log('server: socket connected', socket.id, 'auth:', socket.handshake.auth);

  if (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId) {
    (async () => {
      try {
        const { userId, docId } = socket.handshake.auth;
        console.log('server: attempt auto join for', userId);

        let user = await User.findOne({ userId });
        if (!user) {
          const predefined = PREDEFINED_USERS.find(p => p.userId === userId);
          if (predefined) {
            user = new User({ userId: predefined.userId, name: predefined.name });
            await user.save();
            console.log('server: created user record for', userId);
          }
        }

        if (!user) {
          socket.emit('join-error', { error: 'invalid-user' });
          console.log('server: auto join failed, invalid user', userId);
          return;
        }

        let doc = await Document.findOne({ docId: docId || DOC_ID });
        if (!doc) doc = await validateDocument();
        const already = doc.users.find(u => u.userId === user.userId);
        if (!already) {
          if (doc.users.length >= 2) {
            socket.emit('doc-full', { message: 'Document is limited to 2 users' });
            console.log('server: doc full reject join', userId);
            return;
          }
          doc.users.push({ userId: user.userId, name: user.name, joinedAt: new Date() });
          await doc.save();
        }
        socketToUser.set(socket.id, { userId: user.userId, docId: doc.docId });
        socket.join(doc.docId);
        user.lastSeen = new Date();
        await user.save();

        socket.emit('init', { content: doc.content, versionNumber: doc.versionNumber, ops: doc.ops, users: doc.users });
        socket.to(doc.docId).emit('user-joined', { userId: user.userId, name: user.name });
        console.log('server: user joined document', user.userId, doc.docId);
      } catch (err) {
        console.error('server: auto join error', err);
      }
    })();
  }

  socket.on('join', async (payload) => {
    try {
      const effective = (payload && payload.userId) ? payload : (socket.handshake && socket.handshake.auth ? socket.handshake.auth : {});
      console.log('server: join event', socket.id, 'payload:', payload, 'using:', effective);
      const { userId, docId } = effective;
      if (!userId) {
        socket.emit('join-error', { error: 'missing-user' });
        console.log('server: join failed missing user');
        return;
      }

      let user = await User.findOne({ userId });
      if (!user) {
        const predefined = PREDEFINED_USERS.find(p => p.userId === userId);
        if (predefined) {
          user = new User({ userId: predefined.userId, name: predefined.name });
          await user.save();
          console.log('server: created user failed', userId);
        }
      }

      if (!user) {
        socket.emit('join-error', { error: 'invalid-user' });
        console.log('server: join failed invalid user', userId);
        return;
      }

      let doc = await Document.findOne({ docId: docId || DOC_ID });
      if (!doc) doc = await validateDocument();
      const already = doc.users.find(u => u.userId === user.userId);
      if (!already) {
        if (doc.users.length >= 2) {
          socket.emit('doc-full', { message: 'Document is limited to 2 users' });
          console.log('server: doc full cannot add user', userId);
          return;
        }
        doc.users.push({ userId: user.userId, name: user.name, joinedAt: new Date() });
        await doc.save();
      }
      socketToUser.set(socket.id, { userId: user.userId, docId: doc.docId });
      socket.join(doc.docId);
      user.lastSeen = new Date();
      await user.save();

      socket.emit('init', { content: doc.content, versionNumber: doc.versionNumber, ops: doc.ops, users: doc.users });
      socket.to(doc.docId).emit('user-joined', { userId: user.userId, name: user.name });
      console.log('server: user joined document', user.userId, doc.docId);
    } catch (err) {
      console.error('server: join error', err);
      socket.emit('join-error', { error: 'server-error' });
    }
  });

  socket.on('typing', ({ docId, user, isTyping, userId }) => {
    const id = docId || DOC_ID;
    socket.to(id).emit('typing', { user, userId, isTyping });
  });

  socket.on('patch-edit', async (payload) => {
    try {
      const id = payload.docId || DOC_ID;
      let doc = await Document.findOne({ docId: id });
      if (!doc) doc = await validateDocument();

      const { patchText, user, baseVersion, timestamp } = payload;
      if (!patchText) {
        socket.emit('ack', { accepted: false, reason: 'empty-patch' });
        console.log('server: received empty patch');
        return;
      }

      const dmp = new DiffMatchPatch();
      let patches;
      try {
        patches = dmp.patch_fromText(patchText);
      } catch (err) {
        console.warn('server: invalid patch text', err);
        socket.emit('ack', { accepted: false, reason: 'invalid-patch' });
        return;
      }

      const [newContent, results] = dmp.patch_apply(patches, doc.content);
      const success = results.every(Boolean);
      const needsReview = !success;

      if (newContent === doc.content) {
        socket.emit('ack', { accepted: false, reason: 'no-change', versionNumber: doc.versionNumber, serverContent: doc.content });
        console.log('server: patch made no change');
        return;
      }

      doc.versionNumber += 1;
      doc.content = newContent;
      doc.lastUpdate = new Date(timestamp || Date.now());
      doc.ops.push({
        type: 'patch',
        pos: 0,
        text: patchText,
        length: 0,
        author: user || 'anonymous',
        timestamp: new Date(timestamp || Date.now()),
        versionNumber: doc.versionNumber,
        snapshot: doc.content
      });
      await doc.save();

      socket.to(id).emit('remote-merge', {
        content: doc.content,
        author: user || 'anonymous',
        versionNumber: doc.versionNumber,
        needsReview
      });

      socket.emit('ack', {
        accepted: true,
        versionNumber: doc.versionNumber,
        needsReview,
        serverContent: doc.content
      });
    } catch (err) {
      console.error('server: patch-edit error', err);
      socket.emit('ack', { accepted: false, reason: 'server-error' });
    }
  });

  socket.on('disconnect', async () => {
    const mapping = socketToUser.get(socket.id);
    if (mapping) {
      try {
        const { userId, docId } = mapping;
        const doc = await Document.findOne({ docId });
        if (doc) {
          const before = doc.users.length;
          doc.users = doc.users.filter(u => u.userId !== userId);
          if (doc.users.length !== before) {
            await doc.save();
            socket.to(docId).emit('user-left', { userId });
            console.log('server: removed user from doc', userId, docId);
          }
        }
      } catch (err) {
        console.error('server: disconnect cleanup error', err);
      }
    } else {
      console.log('server: disconnect no mapping for socket', socket.id);
    }
    socketToUser.delete(socket.id);
    console.log('server: socket disconnected', socket.id);
  });
});

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('server: connected to MongoDB');
  await validateDocument();
  await validateUser();
  server.listen(PORT, () => {
    console.log('server: listening on port', PORT);
  });
}).catch((err) => {
  console.error('server: MongoDB connection error', err);
});