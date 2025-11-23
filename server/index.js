const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

require('dotenv').config();

const Document = require('.models/Document');

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