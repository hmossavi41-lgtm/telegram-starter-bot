import { InputFile } from "grammy"
import { pipeline } from "node:stream/promises"
import { createWriteStream, createReadStream } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { request } from "undici"

const MAX_FILE_SIZE = 45 * 1024 * 1024
const MAX_DOWNLOAD_TIME = 5 * 60 * 1000

export function registerCommands(bot) {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "سلام به HamoDownloader 🎬\n\nلینک ویدئو بفرست:\n\nپشتیبانی از لینک مستقیم و تشخیص لینک یوتیوب و اینستاگرام."
    )
  })

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "راهنما:\n\nلینک مستقیم MP4، MOV، M4V یا WEBM برای دریافت ویدئو بفرست.\n\nلینک YouTube و Instagram هم شناسایی می‌شود.\n\nحداکثر حجم فایل مستقیم: ۴۵ مگابایت."
    )
  })

  bot.command("ping", async (ctx) => {
    await ctx.reply("ربات فعاله ✅")
  })

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim()

    let url

    try {
      url = new URL(text)
    } catch {
      await ctx.reply("لطفاً یک لینک معتبر بفرست.")
      return
    }

    if (url.protocol !== "https:") {
      await ctx.reply("فقط لینک HTTPS پذیرفته می‌شود.")
      return
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, "")

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host === "instagram.com"
    ) {
      await ctx.reply(
        "لینک شناسایی شد ✅\n\nاین سایت شناسایی شده، اما دریافت خودکار ویدئو از آن هنوز فعال نیست.\n\nاگر لینک مستقیم فایل ویدئو را داری، آن را ارسال کن."
      )
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

      if (info.size === 0) {
        throw new Error("EMPTY_FILE")
      }

      if (info.size > MAX_FILE_SIZE) {
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

      let message = "دریافت ویدئو ناموفق بود."

      if (error.message === "FILE_TOO_LARGE") {
        message = "حجم ویدئو بیشتر از ۴۵ مگابایت است."
      } else if (error.name === "AbortError") {
        message = "زمان دریافت ویدئو تمام شد."
      }

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
