// DOM elements
const usernameInput = document.getElementById("username");
const loginBtn = document.getElementById("login-btn");
const loginContainer = document.getElementById("login-container");
const roomsContainer = document.getElementById("rooms-container");
const chatContainer = document.getElementById("chat-container");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const roomsList = document.getElementById("rooms-list");
const createRoomBtn = document.getElementById("create-room-btn");
const createRoomForm = document.getElementById("create-room-form");
const roomNameInput = document.getElementById("room-name");
const roomDescInput = document.getElementById("room-desc");
const roomPasswordInput = document.getElementById("room-password");
const submitRoomBtn = document.getElementById("submit-room-btn");
const roomPasswordForm = document.getElementById("room-password-form");
const roomPasswordCheckInput = document.getElementById("room-password-check");
const submitPasswordBtn = document.getElementById("submit-password-btn");
const backToRoomsBtn = document.getElementById("back-to-rooms");
const currentRoomTitle = document.getElementById("current-room-title");
const deleteRoomBtn = document.getElementById("delete-room-btn");
const deleteRoomForm = document.getElementById("delete-room-form");
const deleteRoomPasswordInput = document.getElementById("delete-room-password");
const confirmDeleteRoomBtn = document.getElementById("confirm-delete-room-btn");
const cancelDeleteRoomBtn = document.getElementById("cancel-delete-room-btn");

// State
let socket;
let currentUsername = "";
let currentRoomId = null;
let currentRoomName = "";
let isRoomCreator = false;

// Functions
function showRooms() {
  roomsContainer.style.display = "block";
  chatContainer.style.display = "none";
  deleteRoomForm.style.display = "none";
  fetchRooms();
}

function fetchRooms() {
  fetch("/api/rooms")
    .then((response) => response.json())
    .then((rooms) => {
      roomsList.innerHTML = "";
      rooms.forEach((room) => {
        const roomElement = document.createElement("div");
        roomElement.className = "room-item";
        roomElement.innerHTML = `
          <h3>${room.name}</h3>
          <p>${room.description || "No description"}</p>
          <p><small>Created by: ${room.created_by}</small></p>
          <button class="join-room-btn" data-id="${room.id}">Join</button>
        `;
        roomsList.appendChild(roomElement);
      });

      document.querySelectorAll(".join-room-btn").forEach((btn) => {
        btn.addEventListener("click", () => checkRoomPassword(btn.dataset.id));
      });
    })
    .catch((error) => console.error("Error fetching rooms:", error));
}

function checkRoomPassword(roomId) {
  fetch(`/api/rooms/${roomId}`)
    .then((response) => response.json())
    .then((room) => {
      if (room.password) {
        roomPasswordForm.style.display = "block";
        roomPasswordForm.dataset.roomId = roomId;
        roomPasswordForm.dataset.roomName = room.name;
      } else {
        joinRoom(roomId, room.name, room.created_by);
      }
    })
    .catch((error) => console.error("Error checking room:", error));
}

function joinRoom(roomId, roomName, createdBy) {
  currentRoomId = roomId;
  currentRoomName = roomName;
  currentRoomTitle.textContent = roomName;
  isRoomCreator = createdBy === currentUsername;

  roomsContainer.style.display = "none";
  roomPasswordForm.style.display = "none";
  chatContainer.style.display = "block";
  deleteRoomBtn.style.display = isRoomCreator ? "block" : "none";

  connect();
}

function addMessage(message, isOwn = false) {
  const msgElement = document.createElement("div");
  msgElement.className = `message ${isOwn ? "own-message" : ""}`;
  msgElement.dataset.messageId = message.id;

  msgElement.innerHTML = `
    <span class="username">${message.username}</span>
    <span class="time">${message.time} ${
    message.is_edited ? "(edited)" : ""
  }</span>
    <div class="text">${message.text}</div>
  `;

  if (message.canEdit) {
    const controls = document.createElement("div");
    controls.className = "message-controls";
    controls.innerHTML = `
      <button class="edit-btn">✏️</button>
      <button class="delete-btn">🗑️</button>
    `;
    msgElement.appendChild(controls);

    controls.querySelector(".edit-btn").addEventListener("click", () => {
      editMessage(message.id, message.text);
    });

    controls.querySelector(".delete-btn").addEventListener("click", () => {
      deleteMessage(message.id);
    });
  }

  messagesDiv.appendChild(msgElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addSystemMessage(text) {
  const sysElement = document.createElement("div");
  sysElement.className = "system-message";
  sysElement.textContent = text;
  messagesDiv.appendChild(sysElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function editMessage(messageId, currentText) {
  const newText = prompt("Edit message:", currentText);
  if (newText && newText !== currentText) {
    socket.send(
      JSON.stringify({
        type: "edit",
        messageId,
        newText,
      })
    );
  }
}

function deleteMessage(messageId) {
  if (confirm("Delete this message?")) {
    socket.send(
      JSON.stringify({
        type: "delete",
        messageId,
      })
    );
  }
}

function deleteRoom() {
  deleteRoomForm.style.display = "block";
}

function confirmDeleteRoom() {
  const password = deleteRoomPasswordInput.value;

  fetch(`/api/rooms/${currentRoomId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to delete room");
      return response.json();
    })
    .then(() => {
      addSystemMessage(`Room "${currentRoomName}" has been deleted`);
      setTimeout(() => {
        if (socket) socket.close();
        showRooms();
      }, 1500);
    })
    .catch((error) => {
      alert(error.message);
      console.error("Delete room error:", error);
    })
    .finally(() => {
      deleteRoomForm.style.display = "none";
      deleteRoomPasswordInput.value = "";
    });
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: "join",
        roomId: currentRoomId,
        username: currentUsername,
      })
    );
    addSystemMessage(`You joined "${currentRoomName}" as ${currentUsername}`);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "history":
          messagesDiv.innerHTML = "";
          data.messages.forEach((msg) =>
            addMessage(msg, msg.username === currentUsername)
          );
          break;
        case "message":
          addMessage(data, data.username === currentUsername);
          break;
        case "edit":
          updateMessage(data);
          break;
        case "delete":
          removeMessage(data.messageId);
          break;
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  };

  socket.onclose = () => {
    addSystemMessage("Connection lost. Reconnecting...");
    setTimeout(connect, 3000);
  };
}

function updateMessage(data) {
  const msgElement = document.querySelector(
    `.message[data-message-id="${data.id}"]`
  );
  if (msgElement) {
    msgElement.querySelector(".text").textContent = data.text;
    msgElement.querySelector(".time").textContent = `${data.time} ${
      data.is_edited ? "(edited)" : ""
    }`;
  }
}

function removeMessage(messageId) {
  const msgElement = document.querySelector(
    `.message[data-message-id="${messageId}"]`
  );
  if (msgElement) msgElement.remove();
}

// Event listeners
loginBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  if (username) {
    currentUsername = username;
    localStorage.setItem("username", username);
    loginContainer.style.display = "none";
    showRooms();
  }
});

createRoomBtn.addEventListener("click", () => {
  createRoomForm.style.display = "block";
});

submitRoomBtn.addEventListener("click", () => {
  const name = roomNameInput.value.trim();
  const description = roomDescInput.value.trim();
  const password = roomPasswordInput.value.trim();

  if (!name) return alert("Room name is required");

  fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      password,
      username: currentUsername,
    }),
  })
    .then((response) => response.json())
    .then((room) => {
      createRoomForm.style.display = "none";
      roomNameInput.value = "";
      roomDescInput.value = "";
      roomPasswordInput.value = "";
      joinRoom(room.id, room.name, room.created_by);
    })
    .catch((error) => {
      console.error("Create room error:", error);
      alert("Failed to create room");
    });
});

submitPasswordBtn.addEventListener("click", () => {
  const password = roomPasswordCheckInput.value;
  const roomId = roomPasswordForm.dataset.roomId;
  const roomName = roomPasswordForm.dataset.roomName;

  fetch(`/api/rooms/${roomId}/check-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.valid) {
        roomPasswordCheckInput.value = "";
        roomPasswordForm.style.display = "none";
        joinRoom(roomId, roomName);
      } else {
        alert("Invalid password");
      }
    })
    .catch((error) => {
      console.error("Password check error:", error);
      alert("Error checking password");
    });
});

backToRoomsBtn.addEventListener("click", () => {
  if (socket) socket.close();
  showRooms();
});

deleteRoomBtn.addEventListener("click", deleteRoom);
confirmDeleteRoomBtn.addEventListener("click", confirmDeleteRoom);
cancelDeleteRoomBtn.addEventListener("click", () => {
  deleteRoomForm.style.display = "none";
  deleteRoomPasswordInput.value = "";
});

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const text = messageInput.value.trim();
  if (text && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "message",
        text,
      })
    );
    messageInput.value = "";
  }
}

// Initialize
if (localStorage.getItem("username")) {
  usernameInput.value = localStorage.getItem("username");
}
