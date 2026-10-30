require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./db");
const predictRouter = require("./routes/predict");
const buildSendMoneyRouter = require("./routes/sendMoney");
const dashboardRouter = require("./routes/dashboard");
const accountsRouter = require("./routes/accounts");
const systemRouter = require("./routes/system");

const PORT = process.env.PORT || 4000;

async function main() {
  await connectDB();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });
  app.set("io", io); // routes that emit live events read it via req.app.get("io")

  app.get("/health", (req, res) => res.json({ ok: true }));
  app.use("/system", systemRouter);
  app.use("/accounts", accountsRouter);
  app.use("/predict", predictRouter);
  app.use("/send-money", buildSendMoneyRouter(io));
  app.use("/dashboard", dashboardRouter);

  io.on("connection", (socket) => {
    console.log("[socket] client connected:", socket.id);
  });

  server.listen(PORT, () => {
    console.log(`[server] FraudGuard backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
