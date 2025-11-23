# Collaborative Rich Text Editor — Real-Time (Developed By Nauman Shiraz)

A small Google Docs–style editor that lets multiple people edit the same document at the same time.

Built with:
- React (contentEditable editor with a basic formatting toolbar)
- Node.js + Express + Socket.io for real-time updates
- MongoDB + Mongoose to store the document and version history
- Simple merge logic based on timestamps and version numbers
- “User is typing…” indicator
- Version history viewer

## Features
- Real-time editing between multiple users
- Toolbar: Bold, Italic, Underline, Font family, Font color
- Shows when someone else is typing
- Saves every accepted edit as a new version in MongoDB
- Simple conflict handling: newest timestamp wins and server is always authoritative

## Repository Structure (Monorepo)
- **server/** — Node.js + Express + Socket.io backend  
- **client/** — React frontend

## Requirements
- Node 16+
- npm
- A running MongoDB instance

Steps

1) Clone the repo:
   git clone https://github.com/naumanshiraz/collab_editor
   cd collab-editor

2) Copy and set up environment variables for the server
   cd server
   cp .env.example .env
   # Edit .env to set MONGO_URI if needed

3) Install dependencies
   # At repository root, install both server and client. run these in parallel terminals.
   cd server 
   npm install

   cd ../client
   npm install

4) Start MongoDB
   # If you have MongoDB installed locally:
   mongod --dbpath /path/to/your/db
   # or use a hosted MongoDB and set MONGO_URI in server/.env

5) Run the server
   cd server
   npm run dev
   # defaults to http://localhost:4000

6) Run the client
   cd client
   npm start
   # opens http://localhost:3000

You can also run both in two terminals.

Enjoy!
```