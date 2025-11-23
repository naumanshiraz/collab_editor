const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

require('dotenv').config();

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

app.get('/', (req, res) => res.send('Editor server running'));

app.get('/doc/:docId', async (req, res) => {
    try {
        const doc = await Document.findOne({
            docId: req.params.docId
        });

        if(!doc) {
            return res.status(404).json({
                error: 'Document not found'
            });
        }
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
})

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', async ({ user, docId }) => {
    try {
      const id = docId || DOC_ID;
      socket.join(id);
      let doc = await Document.findOne({ docId: id });
      if (!doc) {
        doc = await getOrCreateDoc();
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

  socket.on('edit', async (payload) => {
    try {
      const id = payload.docId || DOC_ID;
      let doc = await Document.findOne({ docId: id });
      if (!doc) {
        doc = await getOrCreateDoc();
      }

      const incomingTs = payload.timestamp ? new Date(payload.timestamp) : new Date();

      if (payload.content === doc.content) {
        socket.emit('ack', { accepted: false, reason: 'no-change', versionNumber: doc.versionNumber });
        return;
      }

      let accepted = false;
      if (incomingTs >= doc.lastUpdate) {
        doc.versionNumber += 1;
        doc.content = payload.content;
        doc.lastUpdate = incomingTs;
        doc.versions.push({
          content: payload.content,
          author: payload.user || 'anonymous',
          timestamp: incomingTs,
          versionNumber: doc.versionNumber
        });
        await doc.save();
        accepted = true;

        socket.to(id).emit('remote-edit', {
          content: payload.content,
          user: payload.user,
          timestamp: incomingTs,
          versionNumber: doc.versionNumber
        });

        socket.emit('ack', { accepted: true, versionNumber: doc.versionNumber, timestamp: incomingTs });
        console.log(`Accepted edit v${doc.versionNumber} from ${payload.user || 'anon'}`);
      } else {
        socket.emit('conflict', {
          reason: 'incoming older than current',
          serverContent: doc.content,
          versionNumber: doc.versionNumber
        });
        console.log('Rejected older edit from', payload.user);
      }
    } catch (err) {
      console.error('edit handling error', err);
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
  await getOrCreateDoc();
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});

async function getOrCreateDoc() {
  let doc = await Document.findOne({ docId: DOC_ID });
  if (!doc) {
    doc = new Document({
      docId: DOC_ID,
      content: '<p>Welcome to the shared document. Start typing!</p>',
      versionNumber: 1,
      versions: [{
        content: '<p>Welcome to the shared document. Start typing!</p>',
        author: 'system',
        timestamp: new Date(),
        versionNumber: 1
      }]
    });
    await doc.save();
    console.log('Created first document:', DOC_ID);
  }
  return doc;
}