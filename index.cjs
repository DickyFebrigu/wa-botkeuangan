const http = require("http");
const qrcode = require("qrcode-terminal");
const Pino = require("pino");

const { default: makeWASocket, useMultiFileAuthState } =
  require("@whiskeysockets/baileys");

// HTTP server biar Render Web Service hidup
const PORT = process.env.PORT || 10000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK - WA Bot Keuangan running");
  })
  .listen(PORT, () => console.log("🌐 HTTP server listening on port", PORT));

function formatRupiah(n) {
  return Number(n || 0).toLocaleString("id-ID");
}

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
    if (u.connection === "open") console.log("✅ BOT CONNECTED");
    if (u.connection === "close") console.log("❌ BOT DISCONNECTED");
  });

  const data = new Map();
  function getUser(jid) {
    if (!data.has(jid)) {
      data.set(jid, { name: "teman", income: 0, expense: 0, balance: 0, history: [] });
    }
    return data.get(jid);
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages?.[0];
    if (!msg?.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const t = text.trim();
    const lower = t.toLowerCase();
    const user = getUser(from);

    if (lower === "/start") {
      await sock.sendMessage(from, {
        text:
          `Halo 👋 aku Bot Keuangan.\n\n` +
          `Format:\n` +
          `1) /nama Febri\n` +
          `2) /masuk 5000000 gaji\n` +
          `3) /keluar 10000 pulsa\n` +
          `4) /saldo\n` +
          `5) /histori`
      });
      return;
    }

    if (lower.startsWith("/nama ")) {
      user.name = t.slice(6).trim() || "teman";
      await sock.sendMessage(from, { text: `✅ Nama diset: *${user.name}*` });
      return;
    }

    if (lower.startsWith("/masuk ")) {
      const parts = t.split(" ");
      const amount = Number((parts[1] || "").replace(/[^\d]/g, ""));
      const note = parts.slice(2).join(" ").trim() || "pemasukan";
      if (!amount) return sock.sendMessage(from, { text: "Format: /masuk 5000000 gaji" });

      user.income += amount;
      user.balance += amount;
      user.history.push({ type: "IN", amount, note, date: new Date().toISOString(), balanceAfter: user.balance });

      await sock.sendMessage(from, {
        text: `✅ + Rp ${formatRupiah(amount)} (${note})\nSaldo: Rp ${formatRupiah(user.balance)}`
      });
      return;
    }

    if (lower.startsWith("/keluar ")) {
      const parts = t.split(" ");
      const amount = Number((parts[1] || "").replace(/[^\d]/g, ""));
      const note = parts.slice(2).join(" ").trim() || "pengeluaran";
      if (!amount) return sock.sendMessage(from, { text: "Format: /keluar 10000 pulsa" });

      user.expense += amount;
      user.balance -= amount;
      user.history.push({ type: "OUT", amount, note, date: new Date().toISOString(), balanceAfter: user.balance });

      await sock.sendMessage(from, {
        text: `✅ - Rp ${formatRupiah(amount)} (${note})\nSisa: Rp ${formatRupiah(user.balance)}`
      });
      return;
    }

    if (lower === "/saldo") {
      await sock.sendMessage(from, {
        text:
          `👤 ${user.name}\n` +
          `Pemasukan: Rp ${formatRupiah(user.income)}\n` +
          `Pengeluaran: Rp ${formatRupiah(user.expense)}\n` +
          `Saldo: Rp ${formatRupiah(user.balance)}`
      });
      return;
    }

    if (lower === "/histori") {
      const last = user.history.slice(-10).reverse();
      if (!last.length) return sock.sendMessage(from, { text: "Belum ada transaksi." });

      const lines = last.map((h, i) => {
        const d = new Date(h.date).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        const sign = h.type === "IN" ? "+" : "-";
        return `${i + 1}. ${d}\n${sign}Rp ${formatRupiah(h.amount)} (${h.note})\nsisa: Rp ${formatRupiah(h.balanceAfter)}`;
      });

      await sock.sendMessage(from, { text: `📜 Histori (10 terakhir)\n\n${lines.join("\n\n")}` });
      return;
    }

    if (t.startsWith("/")) {
      await sock.sendMessage(from, { text: "Perintah tidak dikenal. Ketik /start" });
    }
  });
}

startBot().catch((e) => console.error("FATAL:", e));
