import { InputFile } from "grammy"
import { pipeline } from "node:stream/promises"
import { createWriteStream, createReadStream } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { request } from "undici"

const MAX_FILE_SIZE = 45 * 1024 * 1024
const MAX_DOWNLOAD_TIME = 5 * 60 * 1000

function identifyLink(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "")

  if (["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    return "youtube"
  }

  if (host === "instagram.com") {
    return "instagram"
  }

  return "direct"
}

async function getPageInfo(url) {
  try {
    const response = await request(url, {
      method: "GET",
      headersTimeout: 10000,
      bodyTimeout: 10000,
      headers: {
        "user-agent": "Mozilla/5.0"
      }
    })

    const chunks = []
    let size = 0

    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 500000) break
      chunks.push(chunk)
    }

    const html = Buffer.concat(chunks).toString("utf8")
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)

    return match
      ? match[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim()
      : null
  } catch {
    return null
  }
}

export function registerCommands(bot) {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "سلام به HamoDownloader 🎬\n\nلینک یوتیوب، اینستاگرام یا لینک مستقیم MP4 بفرست."
    )
  })

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "راهنما:\n\nلینک یوتیوب و اینستاگرام شناسایی می‌شود.\nلینک مستقیم MP4، MOV، M4V و WEBM قابل دریافت است.\nحداکثر حجم فایل مستقیم: ۴۵ مگابایت."
    )
  })

  bot.command("ping", async (ctx) => {
    await ctx.reply("ربات فعاله ✅")
  })

  bot.on("message:text", async (ctx) => {
    let url

    try {
      url = new URL(ctx.message.text.trim())
    } catch {
      await ctx.reply("لطفاً لینک معتبر بفرست.")
      return
    }

    if (url.protocol !== "https:") {
      await ctx.reply("فقط لینک HTTPS پذیرفته می‌شود.")
      return
    }

    const type = identifyLink(url)

    if (type !== "direct") {
      const status = await ctx.reply("در حال بررسی لینک... ⏳")
      const title = await getPageInfo(url)

      let message

      if (type === "youtube") {
        message = "لینک یوتیوب شناسایی شد ✅"
      } else {
        message = "لینک اینستاگرام شناسایی شد ✅"
      }

      if (title) {
        message += `\n\nعنوان: ${title}`
      }

      message +=
        "\n\nبرای دریافت فایل، باید از روش رسمی و دارای مجوز استفاده شود. دانلود خودکار این پلتفرم هنوز فعال نیست."

      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        message
      ).catch(() => {})

      return
    }

    if (!/\.(mp4|mov|m4v|webm)$/i.test(url.pathname)) {
      await ctx.reply("این لینک مستقیم فایل ویدئویی نیست.")
      return
    }

    const status = await ctx.reply("در حال دریافت ویدئو... ⏳")
    let folder

    try {
      folder = await mkdtemp(path.join(tmpdir(), "hamo-"))
      const file = path.join(folder, "video.mp4")
      const controller = new AbortController()

      const timer = setTimeout(
        () => controller.abort(),
        MAX_DOWNLOAD_TIME
      )

      try {
        const response = await request(url, {
          method: "GET",
          signal: controller.signal,
          headersTimeout: 15000,
          bodyTimeout: 30000
        })

        if (response.statusCode !== 200) {
          response.body.destroy()
          throw new Error("DOWNLOAD_FAILED")
        }

        const length = Number(
          response.headers["content-length"] || 0
        )

        if (length > MAX_FILE_SIZE) {
          response.body.destroy()
          throw new Error("FILE_TOO_LARGE")
        }

        await pipeline(
          response.body,
          createWriteStream(file),
          { signal: controller.signal }
        )
      } finally {
        clearTimeout(timer)
      }

      const info = await stat(file)

      if (info.size === 0 || info.size > MAX_FILE_SIZE) {
        throw new Error("FILE_TOO_LARGE")
      }

      await ctx.replyWithVideo(
        new InputFile(createReadStream(file), "video.mp4"),
        { caption: "ارسال توسط HamoDownloader 🎬" }
      )

      await ctx.api.deleteMessage(
        ctx.chat.id,
        status.message_id
      ).catch(() => {})
    } catch (error) {
      console.error("Download error:", error)

      const message =
        error.message === "FILE_TOO_LARGE"
          ? "حجم ویدئو بیشتر از ۴۵ مگابایت است."
          : "دریافت ویدئو ناموفق بود."

      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        message
      ).catch(() => {})
    } finally {
      if (folder) {
        await rm(folder, {
          recursive: true,
          force: true
        }).catch(() => {})
      }
    }
  })
}
