import { default as makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import Pino from "pino";
import qrcode from "qrcode-terminal";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");

  const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: "silent" }),
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    if (u.qr) {
      console.log("=== SCAN QR ===");
      qrcode.generate(u.qr, { small: true });
    }
    if (u.connection === "open") {
      console.log("✅ BOT CONNECTED");
    }
    if (u.connection === "close") {
      console.log("❌ BOT DISCONNECTED");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (text.toLowerCase() === "/start") {
      await sock.sendMessage(from, {
        text: "Halo 👋 Bot WA Render Free aktif"
      });
    }
  });
}

startBot();
import http from "http";

const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(port, () => {
  console.log("🌐 HTTP server listening on port", port);
});

