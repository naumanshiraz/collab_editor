const mongoose = require('mongoose');

const VersionSchema = new mongoose.Schema({
  content: { type: String, required: true },
  author: { type: String, default: 'anonymous' },
  timestamp: { type: Date, default: Date.now },
  versionNumber: { type: Number, required: true }
}, { _id: false });

const DocumentSchema = new mongoose.Schema({
  docId: { type: String, unique: true, required: true },
  content: { type: String, default: '' },
  versionNumber: { type: Number, default: 0 },
  lastUpdate: { type: Date, default: Date.now },
  versions: [VersionSchema]
});

module.exports = mongoose.model('Document', DocumentSchema);