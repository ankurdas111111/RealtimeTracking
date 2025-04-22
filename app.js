/**
 * REAL-TIME LOCATION TRACKER - SERVER
 * 
 * This server application provides:
 * 1. Real-time communication between connected clients
 * 2. User tracking and management
 * 3. Location data sharing
 * 4. Event broadcasting
 */

//============================================================
// DEPENDENCIES AND SETUP
//============================================================

// Core dependencies
const express = require("express");
const http = require("http");
const path = require("path");
const socketio = require("socket.io");

// Initialize Express application
const app = express();

// Create HTTP server with Express
const server = http.createServer(app);

// Initialize Socket.io with the server
const io = socketio(server);

//============================================================
// MIDDLEWARE AND CONFIGURATION
//============================================================

// Set view engine to EJS for dynamic content
app.set("view engine", "ejs");

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

//============================================================
// APPLICATION STATE
//============================================================

// Store active users and their locations in memory
// Using Map for efficient lookups by socket ID
const activeUsers = new Map();

//============================================================
// ROUTES
//============================================================

// Home route - render the main tracking interface
app.get("/", function(req, res) {
    res.render("index");
});

//============================================================
// SOCKET.IO EVENT HANDLING
//============================================================

// Handle new client connections
io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);
    
    // Create a new user with a random name
    const username = "User-" + Math.floor(Math.random() * 10000);
    
    // Add user to active users Map
    activeUsers.set(socket.id, {
        socketId: socket.id,
        username: username,
        latitude: null,
        longitude: null,
        lastUpdate: Date.now()
    });
    
    // Send list of existing users to the newly connected client
    socket.emit("existingUsers", Array.from(activeUsers.values()));
    
    // Inform other clients about the new connection
    socket.broadcast.emit("userConnected", {
        socketId: socket.id,
        username: username
    });
    
    //-------------------------------------------
    // Handle location updates from client
    //-------------------------------------------
    socket.on("position", (data) => {
        // Get current user data
        const user = activeUsers.get(socket.id);
        
        if (user) {
            // Update user's location data
            user.latitude = data.latitude;
            user.longitude = data.longitude;
            user.speed = data.speed;
            user.lastUpdate = Date.now();
            user.formattedTime = data.formattedTime;
            
            // Broadcast updated position to all other clients
            socket.broadcast.emit("userUpdate", user);
        }
    });
    
    //-------------------------------------------
    // Handle username changes
    //-------------------------------------------
    socket.on("updateUsername", (username) => {
        // Get current user data
        const user = activeUsers.get(socket.id);
        
        if (user) {
            // Update username
            user.username = username;
            
            // Notify all clients (including sender) about the name change
            io.emit("userUpdate", user);
        }
    });
    
    //-------------------------------------------
    // Handle client disconnection
    //-------------------------------------------
    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        
        // Remove user from active users
        activeUsers.delete(socket.id);
        
        // Notify all remaining clients about disconnection
        io.emit("userDisconnect", socket.id);
    });
});

//============================================================
// SERVER INITIALIZATION
//============================================================

// Use environment variable for port or default to 3000
const PORT = process.env.PORT || 3000;

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});