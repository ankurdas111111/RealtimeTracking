const express = require("express");
const http = require("http");
const path = require("path");
const socketio = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = socketio(server);

app.set("view engine", "ejs");

app.use(express.static(path.join(__dirname, "public")));

const activeUsers = new Map();

app.get("/", function(req, res) {
    res.render("index");
});

io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    const username = "User-" + Math.floor(Math.random() * 10000);

    activeUsers.set(socket.id, {
        socketId: socket.id,
        username: username,
        latitude: null,
        longitude: null,
        lastUpdate: Date.now()
    });

    socket.emit("existingUsers", Array.from(activeUsers.values()));

    socket.broadcast.emit("userConnected", {
        socketId: socket.id,
        username: username
    });

    socket.on("position", (data) => {

        const user = activeUsers.get(socket.id);
        
        if (user) {

            user.latitude = data.latitude;
            user.longitude = data.longitude;
            user.speed = data.speed;
            user.lastUpdate = Date.now();
            user.formattedTime = data.formattedTime;

            socket.broadcast.emit("userUpdate", user);
        }
    });

    socket.on("updateUsername", (username) => {

        const user = activeUsers.get(socket.id);
        
        if (user) {

            user.username = username;

            io.emit("userUpdate", user);
        }
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);

        activeUsers.delete(socket.id);

        io.emit("userDisconnect", socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
