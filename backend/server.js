require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./db");
const predictRouter = require("./routes/predict");
const buildSendMoneyRouter = require("./routes/sendMoney");
const dashboardRouter = require("./routes/dashboard");

const PORT = process.env.PORT || 4000;

async function main() {
  await connectDB();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  app.get("/health", (req, res) => res.json({ ok: true }));
  app.use("/predict", predictRouter);
  app.use("/send-money", buildSendMoneyRouter(io));
  app.use("/dashboard", dashboardRouter);

  io.on("connection", (socket) => {
    console.log("[socket] dashboard connected:", socket.id);
  });

  // Dummy heartbeat event so the dashboard's Socket.IO plumbing can be
  // tested before the real agent activity feed is wired to the dashboard UI.
  setInterval(() => {
    io.emit("agent:activity", {
      account_id: "heartbeat",
      decision: "none",
      action_taken: "none",
      report: `[heartbeat] server alive at ${new Date().toISOString()}`,
    });
  }, 15000);

  server.listen(PORT, () => {
    console.log(`[server] FraudGuard backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
