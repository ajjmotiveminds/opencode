#!/usr/bin/env bun

// Server-only entrypoint for Docker container
// This bypasses the CLI and starts the server directly

import { Server } from "./server/server";

// Default server configuration
const port = parseInt(process.env['PORT'] || "3000");
const hostname = process.env['HOSTNAME'] || "0.0.0.0";

async function startServer() {
  try {
    console.log("🚀 Starting OpenCode server...");
    console.log(`📍 Port: ${port}`);
    console.log(`🌐 Hostname: ${hostname}`);
    
    // Start the server using the Server.listen method
    const server = Server.listen({ port, hostname });
    
    console.log(`✅ OpenCode server running at http://${hostname}:${port}`);
    console.log(`📊 Environment: ${process.env['NODE_ENV'] || "development"}`);
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down server...');
      server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n🛑 Shutting down server...');
      server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();