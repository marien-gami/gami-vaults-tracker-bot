// telegram.js
import "dotenv/config";

const TOKEN = process.env.BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) {
  throw new Error("⚠️ BOT_TOKEN missing in .env");
}

// Appel brut à l'API Bot. Renvoie `result` ou lève une erreur (avec .code = error_code).
export async function telegramApi(method, body = {}, { timeoutMs = 15_000 } = {}) {
  const res = await fetch(`${API_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(`Telegram ${method} : ${data.error_code} ${data.description}`);
    err.code = data.error_code;
    throw err;
  }
  return data.result;
}

export async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    const result = await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra
    });
    console.log(`✅ Message sent to ${chatId}`);
    return result;
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return null;
  }
}
