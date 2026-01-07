import http from "http";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import Pino from "pino";
import qrcode from "qrcode-terminal";

// ============ HTTP SERVER (biar Render Web Service "hidup") ============
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK - WA Bot Keuangan running");
  })
  .listen(PORT, () => console.log("🌐 HTTP server listening on port", PORT));

// ===================== BOT WA =====================
function formatRupiah(n) {
  const num = Number(n || 0);
  return num.toLocaleString("id-ID");
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

  // Simpan data saldo sederhana (sementara, masih RAM, nanti kita bikin DB)
  const data = new Map(); // key: jid, value: { name, income, expense, balance, history[] }

  function getUser(jid) {
    if (!data.has(jid)) {
      data.set(jid, {
        name: "teman",
        income: 0,
        expense: 0,
        balance: 0,
        history: [] // {type, amount, note, date, balanceAfter}
      });
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

    // ===== /start =====
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

    // ===== /nama =====
    if (lower.startsWith("/nama ")) {
      const name = t.slice(6).trim();
      user.name = name || "teman";
      await sock.sendMessage(from, { text: `Sip, nama diset: *${user.name}* ✅` });
      return;
    }

    // ===== /masuk <angka> <catatan> =====
    if (lower.startsWith("/masuk ")) {
      // contoh: /masuk 5000000 gaji
      const parts = t.split(" ");
      const amount = Number((parts[1] || "").replace(/[^\d]/g, ""));
      const note = parts.slice(2).join(" ").trim() || "pemasukan";

      if (!amount || amount <= 0) {
        await sock.sendMessage(from, {
          text: "Format salah. Contoh: /masuk 5000000 gaji"
        });
        return;
      }

      user.income += amount;
      user.balance += amount;

      const now = new Date();
      user.history.push({
        type: "pemasukan",
        amount,
        note,
        date: now.toISOString(),
        balanceAfter: user.balance
      });

      await sock.sendMessage(from, {
        text:
          `✅ Pemasukan dicatat\n` +
          `+ Rp ${formatRupiah(amount)} (${note})\n\n` +
          `Saldo sekarang: Rp ${formatRupiah(user.balance)}`
      });
      return;
    }

    // ===== /keluar <angka> <catatan> =====
    if (lower.startsWith("/keluar ")) {
      // contoh: /keluar 10000 pulsa
      const parts = t.split(" ");
      const amount = Number((parts[1] || "").replace(/[^\d]/g, ""));
      const note = parts.slice(2).join(" ").trim() || "pengeluaran";

      if (!amount || amount <= 0) {
        await sock.sendMessage(from, {
          text: "Format salah. Contoh: /keluar 10000 pulsa"
        });
        return;
      }

      user.expense += amount;
      user.balance -= amount;

      const now = new Date();
      user.history.push({
        type: "pengeluaran",
        amount,
        note,
        date: now.toISOString(),
        balanceAfter: user.balance
      });

      await sock.sendMessage(from, {
        text:
          `✅ Pengeluaran dicatat\n` +
          `- Rp ${formatRupiah(amount)} (${note})\n\n` +
          `Sisa saldo: Rp ${formatRupiah(user.balance)}`
      });
      return;
    }

    // ===== /saldo =====
    if (lower === "/saldo") {
      await sock.sendMessage(from, {
        text:
          `👤 ${user.name}\n\n` +
          `Total pemasukan: Rp ${formatRupiah(user.income)}\n` +
          `Total pengeluaran: Rp ${formatRupiah(user.expense)}\n` +
          `Saldo: Rp ${formatRupiah(user.balance)}`
      });
      return;
    }

    // ===== /histori =====
    if (lower === "/histori") {
      const last = user.history.slice(-10).reverse();
      if (last.length === 0) {
        await sock.sendMessage(from, { text: "Belum ada transaksi." });
        return;
      }

      const lines = last.map((h, i) => {
        const date = new Date(h.date);
        const d = date.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        const sign = h.type === "pemasukan" ? "+" : "-";
        return (
          `${i + 1}. ${d}\n` +
          `${h.type} ${sign}Rp ${formatRupiah(h.amount)} (${h.note})\n` +
          `sisa: Rp ${formatRupiah(h.balanceAfter)}`
        );
      });

      await sock.sendMessage(from, { text: `📜 Histori (10 terakhir)\n\n${lines.join("\n\n")}` });
      return;
    }

    // default
    if (t.startsWith("/")) {
      await sock.sendMessage(from, {
        text: "Perintah tidak dikenal. Ketik /start untuk lihat format."
      });
    }
  });
}

startBot().catch((e) => console.error("FATAL:", e));
