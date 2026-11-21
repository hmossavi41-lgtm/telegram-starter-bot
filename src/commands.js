import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { request } from "undici"

const PUBLIC_URL =
  process.env.PUBLIC_URL || "https://hamodownloader.fadehost.app"

const videos = new Map()

function isValidVideoUrl(value) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()

    if (url.protocol !== "https:") return false
    if (url.username || url.password) return false

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

    return /\.(mp4|m4v|mov|webm)$/i.test(url.pathname)
  } catch {
    return false
  }
}

function startWebServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(
        req.url,
        "http://localhost"
      ).pathname

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
<video controls playsinline preload="metadata">
<source src="/stream/${id}" type="video/mp4">
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

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "سلام! به HamoStream خوش آمدی 🎬\n\nلینک مستقیم ویدئوی HTTPS را بفرست تا لینک پخش آنلاین ساخته شود."
    )
  })

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "راهنما:\n\nلینک مستقیم HTTPS با پسوند MP4، MOV، M4V یا WEBM بفرست.\nربات لینک پخش آنلاین می‌سازد."
    )
  })

  bot.command("ping", async (ctx) => {
    await ctx.reply("HamoStream فعاله ✅")
  })

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim()

    if (!isValidVideoUrl(text)) {
      await ctx.reply(
        "لطفاً لینک مستقیم HTTPS ویدئو با پسوند MP4، MOV، M4V یا WEBM بفرست."
      )
      return
    }

    const id = randomUUID()

    videos.set(id, {
      url: text,
      expires: Date.now() + 6 * 60 * 60 * 1000
    })

    for (const [key, value] of videos) {
      if (value.expires < Date.now()) {
        videos.delete(key)
      }
    }

    const watchUrl = `${PUBLIC_URL}/watch/${id}`

    await ctx.reply(
      `لینک پخش آنلاین آماده شد 🎬\n\n${watchUrl}\n\nاین لینک تا ۶ ساعت معتبر است.`
    )
  })
}
