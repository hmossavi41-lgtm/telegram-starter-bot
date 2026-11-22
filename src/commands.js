
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { request } from "undici"
import { InlineKeyboard } from "grammy"

const PUBLIC_URL =
  process.env.PUBLIC_URL || "https://hamodownloader.fadehost.app"

const videos = new Map()
const userModes = new Map()

const MENU_TEXT = `
🤖 به Hamo AI خوش آمدی!

دستیار هوشمند و جعبه‌ابزار شما.

از منوی زیر یک بخش را انتخاب کن:
`

function mainMenu() {
  return new InlineKeyboard()
    .text("🧠 گفت‌وگو با Hamo AI", "ai_chat")
    .row()
    .text("🌐 مترجم", "ai_translate")
    .text("✍️ نویسنده متن", "ai_writer")
    .row()
    .text("🎬 HamoStream", "stream_mode")
}

function backMenu() {
  return new InlineKeyboard()
    .text("🏠 منوی اصلی", "home")
}

function isValidVideoUrl(value) {
  try {
    const url = new URL(value)

    if (url.protocol !== "https:") return false
    if (url.username || url.password) return false

    const host = url.hostname.toLowerCase()

    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return false

    if (
      host === "cf.linkulu.com" &&
      /^\/dl\/[a-f0-9]+$/i.test(url.pathname)
    ) {
      return true
    }

    return /\.(mp4|m4v|mov|webm)$/i.test(url.pathname)

  } catch {
    return false
  }
}

// HamoStream server
function startWebServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(
        req.url,
        "http://localhost"
      ).pathname

      const match = pathname.match(
        /^\/(watch|stream)\/([a-f0-9-]+)$/
      )

      if (!match) {
        res.writeHead(404)
        res.end("Not found")
        return
      }

      const [, action, id] = match
      const item = videos.get(id)

      if (!item || item.expires < Date.now()) {
        videos.delete(id)
        res.writeHead(404)
        res.end("Link expired")
        return
      }

      if (action === "watch") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        })

        res.end(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HamoStream</title>
<style>
body {
  margin: 0;
  background: #111;
  color: white;
  font-family: sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}
h2 { color: #00d4aa; }
video {
  width: 95%;
  max-width: 900px;
  border-radius: 12px;
  background: black;
}
p { color: #aaa; }
</style>
</head>
<body>
<h2>HamoStream 🎬</h2>
<video
  src="/stream/${id}"
  controls
  playsinline
  preload="metadata">
مرورگر شما از پخش ویدئو پشتیبانی نمی‌کند.
</video>
<p>پخش آنلاین توسط HamoStream</p>
</body>
</html>`)
        return
      }

      const headers = {}

      if (req.headers.range) {
        headers.range = req.headers.range
      }

      const upstream = await request(item.url, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        headersTimeout: 20000,
        bodyTimeout: 0,
        maxRedirections: 0
      })

      if (![200, 206, 304, 416].includes(upstream.statusCode)) {
        upstream.body.destroy()
        res.writeHead(502)
        res.end("Video source unavailable")
        return
      }

      const responseHeaders = {
        "Content-Type":
          upstream.headers["content-type"] || "video/mp4",
        "Accept-Ranges":
          upstream.headers["accept-ranges"] || "bytes",
        "Cache-Control": "no-store"
      }

      for (const name of [
        "content-length",
        "content-range",
        "last-modified",
        "etag"
      ]) {
        if (upstream.headers[name]) {
          responseHeaders[name] = upstream.headers[name]
        }
      }

      res.writeHead(upstream.statusCode, responseHeaders)

      if (req.method === "HEAD" || upstream.statusCode === 304) {
        upstream.body.destroy()
        res.end()
        return
      }

      upstream.body.pipe(res)

      req.on("close", () => {
        if (!res.writableEnded) {
          upstream.body.destroy()
        }
      })

    } catch (error) {
      console.error("Stream error:", error)

      if (!res.headersSent) {
        res.writeHead(502)
      }

      res.end("Streaming error")
    }
  })

  server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("[web] HamoStream server started")
  })
}

export function registerCommands(bot) {
  startWebServer()

  // Start
  bot.command("start", async (ctx) => {
    userModes.delete(ctx.from.id)

    await ctx.reply(MENU_TEXT, {
      reply_markup: mainMenu()
    })
  })

  // Main menu
  bot.command("menu", async (ctx) => {
    userModes.delete(ctx.from.id)

    await ctx.reply(MENU_TEXT, {
      reply_markup: mainMenu()
    })
  })

  // Help
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "راهنمای Hamo AI\n\n" +
      "/start - شروع\n" +
      "/menu - منوی اصلی\n" +
      "/ping - بررسی وضعیت ربات\n\n" +
      "برای پخش ویدئو، لینک مستقیم یا لینک پشتیبانی‌شده Linkulu بفرست."
    )
  })

  // Ping
  bot.command("ping", async (ctx) => {
    await ctx.reply("Hamo AI و HamoStream فعال هستند ✅")
  })

  // Menu buttons
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data
    const userId = ctx.from.id

    await ctx.answerCallbackQuery()

    if (data === "home") {
      userModes.delete(userId)

      await ctx.editMessageText(MENU_TEXT, {
        reply_markup: mainMenu()
      })
      return
    }

    const sections = {
      ai_chat: {
        mode: "ai",
        text:
          "🧠 گفت‌وگو با Hamo AI\n\n" +
          "بخش گفت‌وگو انتخاب شد.\n" +
          "اتصال مدل هوش مصنوعی هنوز فعال نشده و در مرحله بعد اضافه می‌شود."
      },

      ai_translate: {
        mode: "translate",
        text:
          "🌐 مترجم Hamo\n\n" +
          "بخش ترجمه انتخاب شد.\n" +
          "برای فعال‌شدن ترجمه هوشمند، اتصال سرویس AI لازم است."
      },

      ai_writer: {
        mode: "writer",
        text:
          "✍️ نویسنده Hamo\n\n" +
          "بخش نویسندگی انتخاب شد.\n" +
          "برای فعال‌شدن تولید و اصلاح متن، اتصال سرویس AI لازم است."
      },

      stream_mode: {
        mode: "stream",
        text:
          "🎬 HamoStream\n\n" +
          "لینک مستقیم ویدئو یا لینک دانلود پشتیبانی‌شده Linkulu را بفرست."
      }
    }

    const section = sections[data]

    if (!section) return

    userModes.set(userId, section.mode)

    await ctx.editMessageText(section.text, {
      reply_markup: backMenu()
    })
  })

  // Text messages
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim()
    const userId = ctx.from.id

    // Video links always go to HamoStream
    if (isValidVideoUrl(text)) {
      const id = randomUUID()

      videos.set(id, {
        url: text,
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000
      })

      for (const [key, value] of videos) {
        if (value.expires < Date.now()) {
          videos.delete(key)
        }
      }

      const watchUrl = `${PUBLIC_URL}/watch/${id}`

      await ctx.reply(
        `لینک پخش آنلاین آماده شد 🎬\n\n${watchUrl}\n\nاین لینک تا ۷ روز معتبر است.`
      )
      return
    }

    const mode = userModes.get(userId)

    if (mode === "ai") {
      await ctx.reply(
        "پیامت دریافت شد 🧠\n\n" +
        "اتصال هوش مصنوعی هنوز فعال نشده است. این قابلیت در مرحله بعد راه‌اندازی می‌شود."
      )
      return
    }

    if (mode === "translate") {
      await ctx.reply(
        "متنت دریافت شد 🌐\n\n" +
        "برای ترجمه هوشمند باید ابتدا سرویس AI را متصل کنیم."
      )
      return
    }

    if (mode === "writer") {
      await ctx.reply(
        "درخواستت دریافت شد ✍️\n\n" +
        "بخش نویسندگی پس از اتصال هوش مصنوعی فعال می‌شود."
      )
      return
    }

    if (mode === "stream") {
      await ctx.reply(
        "این لینک قابل قبول نیست.\n\n" +
        "لطفاً لینک مستقیم HTTPS ویدئو یا لینک دانلود معتبر Linkulu بفرست."
      )
      return
    }

    await ctx.reply(
      "برای شروع، از منوی اصلی یک بخش را انتخاب کن:",
      {
        reply_markup: mainMenu()
      }
    )
  })
}
