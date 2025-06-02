const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const db = new sqlite3.Database("./chat.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      password TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER,
      username TEXT NOT NULL,
      text TEXT NOT NULL,
      time DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_edited BOOLEAN DEFAULT FALSE,
      FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `);
});

app.use(express.json());
app.use(express.static("public"));

// API endpoints
app.get("/api/rooms", (req, res) => {
  db.all(
    "SELECT id, name, description, created_by FROM rooms",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post("/api/rooms", (req, res) => {
  const { name, description, password, username } = req.body;
  if (!name || !username)
    return res.status(400).json({ error: "Name and username are required" });

  const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;

  db.run(
    "INSERT INTO rooms (name, description, password, created_by) VALUES (?, ?, ?, ?)",
    [name, description, hashedPassword, username],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, description, created_by: username });
    }
  );
});

app.post("/api/rooms/:id/check-password", (req, res) => {
  const { password } = req.body;
  const roomId = req.params.id;

  db.get("SELECT password FROM rooms WHERE id = ?", [roomId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Room not found" });

    const passwordMatch = row.password
      ? bcrypt.compareSync(password, row.password)
      : true;
    res.json({ valid: passwordMatch });
  });
});

app.delete("/api/rooms/:id", (req, res) => {
  const { password } = req.body;
  const roomId = req.params.id;

  db.get(
    "SELECT password, created_by FROM rooms WHERE id = ?",
    [roomId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Room not found" });

      const passwordValid = row.password
        ? bcrypt.compareSync(password, row.password)
        : true;
      if (!passwordValid)
        return res.status(403).json({ error: "Invalid password" });

      db.run("DELETE FROM rooms WHERE id = ?", [roomId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }
  );
});

// WebSocket
const activeConnections = {};

wss.on("connection", (ws) => {
  let currentRoom = null;
  let currentUsername = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case "join":
          currentRoom = data.roomId;
          currentUsername = data.username;

          if (!activeConnections[currentRoom]) {
            activeConnections[currentRoom] = new Set();
          }
          activeConnections[currentRoom].add(ws);

          db.all(
            "SELECT id, username, text, time, is_edited FROM messages WHERE room_id = ? ORDER BY time",
            [currentRoom],
            (err, messages) => {
              if (err) return console.error(err);
              ws.send(
                JSON.stringify({
                  type: "history",
                  messages: messages.map((msg) => ({
                    ...msg,
                    time: new Date(msg.time).toLocaleTimeString(),
                    canEdit: msg.username === currentUsername,
                  })),
                })
              );
            }
          );
          break;

        case "message":
          if (!currentRoom || !currentUsername) return;

          const messageData = {
            room_id: currentRoom,
            username: currentUsername,
            text: data.text,
            time: new Date().toISOString(),
          };

          db.run(
            "INSERT INTO messages (room_id, username, text, time) VALUES (?, ?, ?, ?)",
            [
              messageData.room_id,
              messageData.username,
              messageData.text,
              messageData.time,
            ],
            function (err) {
              if (err) return console.error(err);

              const fullMessage = {
                type: "message",
                id: this.lastID,
                username: messageData.username,
                text: messageData.text,
                time: new Date(messageData.time).toLocaleTimeString(),
                is_edited: false,
                canEdit: messageData.username === currentUsername,
              };

              broadcast(currentRoom, fullMessage);
            }
          );
          break;

        case "edit":
          if (!currentRoom || !currentUsername) return;

          db.run(
            "UPDATE messages SET text = ?, is_edited = TRUE WHERE id = ? AND username = ?",
            [data.newText, data.messageId, currentUsername],
            function (err) {
              if (err) return console.error(err);
              if (this.changes === 0) return;

              db.get(
                "SELECT id, username, text, time, is_edited FROM messages WHERE id = ?",
                [data.messageId],
                (err, msg) => {
                  if (err) return console.error(err);
                  broadcast(currentRoom, {
                    type: "edit",
                    ...msg,
                    time: new Date(msg.time).toLocaleTimeString(),
                    canEdit: msg.username === currentUsername,
                  });
                }
              );
            }
          );
          break;

        case "delete":
          if (!currentRoom || !currentUsername) return;

          db.run(
            "DELETE FROM messages WHERE id = ? AND username = ?",
            [data.messageId, currentUsername],
            function (err) {
              if (err) return console.error(err);
              if (this.changes === 0) return;
              broadcast(currentRoom, {
                type: "delete",
                messageId: data.messageId,
              });
            }
          );
          break;
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  });

  ws.on("close", () => {
    if (currentRoom && activeConnections[currentRoom]) {
      activeConnections[currentRoom].delete(ws);
      if (activeConnections[currentRoom].size === 0) {
        delete activeConnections[currentRoom];
      }
    }
  });
});

function broadcast(roomId, message) {
  if (activeConnections[roomId]) {
    activeConnections[roomId].forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
