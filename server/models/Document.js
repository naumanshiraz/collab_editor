const mongoose = require('mongoose');

const OpSchema = new mongoose.Schema({
  type: { type: String, enum: ['insert', 'delete', 'patch'], required: true },
  pos: { type: Number },
  text: { type: String },
  length: { type: Number },
  author: { type: String, default: 'anonymous' },
  timestamp: { type: Date, default: Date.now },
  versionNumber: { type: Number, required: true },
  snapshot: { type: String }
}, { _id: false });

const UserRefSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const DocumentSchema = new mongoose.Schema({
  docId: { type: String, unique: true, required: true },
  content: { type: String, default: '' },
  versionNumber: { type: Number, default: 0 },
  lastUpdate: { type: Date, default: Date.now },
  ops: [OpSchema],
  users: [UserRefSchema]
});

module.exports = mongoose.model('Document', DocumentSchema);