import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { request } from "undici"
import { InlineKeyboard } from "grammy"
import QRCode from "qrcode"
import { PDFDocument, StandardFonts } from "pdf-lib"

const PUBLIC_URL = process.env.PUBLIC_URL || "https://hamodownloader.fadehost.app"

const AI_API_URL = process.env.AI_API_URL
const AI_API_KEY = process.env.AI_API_KEY
const AI_MODEL = process.env.AI_MODEL

const videos = new Map()
const userModes = new Map()
const conversations = new Map()

const MAX_HISTORY = 20

const MENU_TEXT = `
🤖 به HamoBot خوش آمدی!

جعبه‌ابزار هوشمند و چندمنظوره شما.

از منوی زیر یک قابلیت را انتخاب کن:
`

function mainMenu() {
  return new InlineKeyboard()
    .text("🧠 هوش مصنوعی", "ai_chat")
    .text("🌐 مترجم", "ai_translate")
    .row()
    .text("✍️ نویسنده متن", "ai_writer")
    .text("🎬 HamoStream", "stream_mode")
    .row()
    .text("🔳 ساخت QR Code", "qr")
    .text("📄 ابزار PDF", "pdf")
    .row()
    .text("🔤 ابزار متن", "text_tools")
    .text("🎮 سرگرمی", "games")
    .row()
    .text("⚙️ تنظیمات", "settings")
}

function backMenu() {
  return new InlineKeyboard().text("🏠 منوی اصلی", "home")
}

function chatMenu() {
  return new InlineKeyboard()
    .text("🔄 گفت‌وگوی جدید", "new_chat")
    .row()
    .text("🗑 پاک‌کردن تاریخچه", "clear_chat")
    .row()
    .text("🏠 منوی اصلی", "home")
}

function getHistory(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, [])
  }
  return conversations.get(userId)
}

async function askAI(history) {
  if (!AI_API_URL || !AI_API_KEY || !AI_MODEL) {
    return "اتصال هوش مصنوعی هنوز تنظیم نشده است."
  }

  try {
    const response = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: history
      }),
      signal: AbortSignal.timeout(60000)
    })

    const data = await response.json()

    if (!response.ok) {
      console.error("[AI error]", response.status, data)
      return "ارتباط با هوش مصنوعی برقرار نشد."
    }

    return data.choices?.[0]?.message?.content ||
      "پاسخی دریافت نشد."

  } catch (error) {
    console.error("[AI connection error]", error)
    return "خطا در اتصال به هوش مصنوعی."
  }
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
    ) return true

    return /\.(mp4|m4v|mov|webm)$/i.test(url.pathname)

  } catch {
    return false
  }
}

function startWebServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname
      const match = pathname.match(/^\/(watch|stream)\/([a-f0-9-]+)$/)

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
<video src="/stream/${id}" controls playsinline preload="metadata"></video>
<p>پخش آنلاین توسط HamoStream</p>
</body>
</html>`)
        return
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405)
        res.end()
        return
      }

      const headers = {}
      if (req.headers.range) headers.range = req.headers.range

      const upstream = await request(item.url, {
        method: req.method,
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
        "Content-Type": upstream.headers["content-type"] || "video/mp4",
        "Accept-Ranges": upstream.headers["accept-ranges"] || "bytes",
        "Cache-Control": "no-store"
      }

      for (const name of ["content-length", "content-range", "last-modified", "etag"]) {
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
        if (!res.writableEnded) upstream.body.destroy()
      })

    } catch (error) {
      console.error("[Stream error]", error)
      if (!res.headersSent) res.writeHead(502)
      res.end("Streaming error")
    }
  })

  server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("[web] HamoStream server started")
  })
}

async function createPdf(text) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const safeText = text.replace(/[^\x20-\x7E\n]/g, "?").slice(0, 3000)

  page.drawText(safeText, {
    x: 45,
    y: 790,
    size: 12,
    font,
    maxWidth: 505,
    lineHeight: 18
  })

  return await pdf.save()
}

export function registerCommands(bot) {
  startWebServer()

  bot.command("start", async (ctx) => {
    userModes.delete(ctx.from.id)
    await ctx.reply(MENU_TEXT, { reply_markup: mainMenu() })
  })

  bot.command("menu", async (ctx) => {
    userModes.delete(ctx.from.id)
    await ctx.reply(MENU_TEXT, { reply_markup: mainMenu() })
  })

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "راهنمای HamoBot\n\n" +
      "/start - شروع\n" +
      "/menu - منوی اصلی\n" +
      "/ping - بررسی وضعیت"
    )
  })

  bot.command("ping", async (ctx) => {
    await ctx.reply("HamoBot فعال است ✅")
  })

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

    if (data === "ai_chat") {
      userModes.set(userId, "ai")
      await ctx.editMessageText(
        "🧠 گفت‌وگو با Hamo AI\n\nپیامت را ارسال کن.",
        { reply_markup: chatMenu() }
      )
      return
    }

    if (data === "new_chat") {
      conversations.set(userId, [])
      userModes.set(userId, "ai")
      await ctx.editMessageText(
        "🔄 گفت‌وگوی جدید شروع شد!\n\nپیامت را بفرست.",
        { reply_markup: chatMenu() }
      )
      return
    }

    if (data === "clear_chat") {
      conversations.set(userId, [])
      userModes.set(userId, "ai")
      await ctx.editMessageText(
        "🗑 تاریخچه پاک شد.",
        { reply_markup: chatMenu() }
      )
      return
    }

    if (data === "settings") {
      userModes.delete(userId)
      await ctx.editMessageText(
        "⚙️ تنظیمات HamoBot\n\nمدیریت تاریخچه گفت‌وگو.",
        { reply_markup: chatMenu() }
      )
      return
    }

    if (data === "qr") {
      userModes.set(userId, "qr")
      await ctx.editMessageText(
        "🔳 ساخت QR Code\n\nمتن یا لینک موردنظرت را ارسال کن.",
        { reply_markup: backMenu() }
      )
      return
    }

    if (data === "pdf") {
      userModes.set(userId, "pdf")
      await ctx.editMessageText(
        "📄 ساخت PDF\n\nمتن موردنظرت را ارسال کن تا فایل PDF بسازم.",
        { reply_markup: backMenu() }
      )
      return
    }

    if (data === "text_tools") {
      userModes.set(userId, "text_tools")
      await ctx.editMessageText(
        "🔤 ابزار متن\n\nمتنت را بفرست تا تعداد کلمات و حروف آن را محاسبه کنم.",
        { reply_markup: backMenu() }
      )
      return
    }

    if (data === "games") {
      userModes.set(userId, "games")
      await ctx.editMessageText(
        "🎮 بازی حدس عدد\n\nیک عدد بین ۱ تا ۱۰ حدس بزن!",
        { reply_markup: backMenu() }
      )
      return
    }

    const sections = {
      ai_translate: {
        mode: "translate",
        text: "🌐 مترجم Hamo\n\nمتنت را ارسال کن."
      },
      ai_writer: {
        mode: "writer",
        text: "✍️ نویسنده Hamo\n\nدرخواست نوشتن یا ویرایش متن را بفرست."
      },
      stream_mode: {
        mode: "stream",
        text: "🎬 HamoStream\n\nلینک مستقیم HTTPS ویدئو را بفرست."
      }
    }

    const section = sections[data]
    if (!section) return

    userModes.set(userId, section.mode)
    await ctx.editMessageText(section.text, {
      reply_markup: backMenu()
    })
  })

  bot.on("message:text", async (ctx) => {
    const messageText = ctx.message.text.trim()
    const userId = ctx.from.id
    const mode = userModes.get(userId)

    if (mode === "qr") {
      try {
        const qr = await QRCode.toBuffer(messageText, {
          type: "png",
          width: 500,
          margin: 2
        })

        await ctx.replyWithPhoto(
          new Blob([qr], { type: "image/png" }),
          { caption: "🔳 QR Code شما آماده شد." }
        )
      } catch (error) {
        console.error(error)
        await ctx.reply("خطا در ساخت QR Code.")
      }
      return
    }

    if (mode === "pdf") {
      try {
        const pdf = await createPdf(messageText)
        await ctx.replyWithDocument(
          new Blob([pdf], { type: "application/pdf" }),
          { caption: "📄 فایل PDF ساخته شد." }
        )
      } catch (error) {
        console.error(error)
        await ctx.reply("خطا در ساخت PDF.")
      }
      return
    }

    if (mode === "text_tools") {
      const chars = [...messageText].length
      const words = messageText.trim().split(/\s+/).filter(Boolean).length

      await ctx.reply(
        `🔤 نتیجه بررسی متن\n\n` +
        `تعداد کاراکتر: ${chars}\n` +
        `تعداد کلمات: ${words}\n` +
        `تعداد خطوط: ${messageText.split("\n").length}`,
        { reply_markup: backMenu() }
      )
      return
    }

    if (mode === "games") {
      const guess = Number(messageText)

      if (!Number.isInteger(guess) || guess < 1 || guess > 10) {
        await ctx.reply("لطفاً یک عدد صحیح بین ۱ تا ۱۰ بفرست.")
        return
      }

      const answer = Math.floor(Math.random() * 10) + 1

      await ctx.reply(
        guess === answer
          ? "🎉 آفرین! درست حدس زدی."
          : `این بار نشد! عدد من ${answer} بود.`,
        { reply_markup: backMenu() }
      )
      return
    }

    if (isValidVideoUrl(messageText)) {
      const id = randomUUID()

      videos.set(id, {
        url: messageText,
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000
      })

      const watchUrl = `${PUBLIC_URL}/watch/${id}`

      await ctx.reply(
        `لینک پخش آنلاین آماده شد 🎬\n\n${watchUrl}\n\nاعتبار: ۷ روز`
      )
      return
    }

    if (mode === "ai") {
      const history = getHistory(userId)

      history.push({ role: "user", content: messageText })

      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY)
      }

      await ctx.replyWithChatAction("typing")

      const answer = await askAI(history)

      history.push({ role: "assistant", content: answer })

      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY)
      }

      await ctx.reply(answer, { reply_markup: chatMenu() })
      return
    }

    if (mode === "translate" || mode === "writer") {
      const prompt = mode === "translate"
        ? `این متن را ترجمه کن. اگر زبان مقصد مشخص نیست به فارسی ترجمه کن:\n\n${messageText}`
        : `این درخواست نویسندگی را انجام بده:\n\n${messageText}`

      const answer = await askAI([
        { role: "user", content: prompt }
      ])

      await ctx.reply(answer, { reply_markup: backMenu() })
      return
    }

    if (mode === "stream") {
      await ctx.reply(
        "این لینک معتبر نیست. لطفاً لینک مستقیم HTTPS ویدئو را ارسال کن."
      )
      return
    }

    await ctx.reply(
      "برای شروع، از منوی اصلی یک بخش را انتخاب کن:",
      { reply_markup: mainMenu() }
    )
  })
}
