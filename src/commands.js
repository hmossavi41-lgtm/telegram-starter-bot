import { Bot, InputFile } from "grammy"
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
      "سلام! به HamoDownloader خوش اومدی 🎬\n\nلینک مستقیم ویدئو با پسوند MP4، MOV، M4V یا WEBM بفرست."
    )
  })

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "راهنما 🎬\n\nیک لینک مستقیم HTTPS به فایل ویدئویی بفرست.\nحداکثر حجم قابل دریافت: ۴۵ مگابایت."
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
      await ctx.reply("لینک معتبر نیست.")
      return
    }

    if (url.protocol !== "https:") {
      await ctx.reply("فقط لینک HTTPS پذیرفته می‌شود.")
      return
    }

    if (!/\.(mp4|mov|m4v|webm)$/i.test(url.pathname)) {
      await ctx.reply(
        "فعلاً فقط لینک مستقیم فایل ویدئویی پشتیبانی می‌شود."
      )
      return
    }

    const status = await ctx.reply("در حال دریافت ویدئو... ⏳")
    let folder

    try {
      folder = await mkdtemp(path.join(tmpdir(), "hamo-"))
      const file = path.join(folder, "video.mp4")

      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, MAX_DOWNLOAD_TIME)

      try {
        const response = await request(url, {
          method: "GET",
          signal: controller.signal,
          headersTimeout: 15000,
          bodyTimeout: 30000
        })

        if (response.statusCode !== 200) {
          response.body.destroy()
          throw new Error(`HTTP_${response.statusCode}`)
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
        {
          caption: "ارسال توسط HamoDownloader 🎬"
        }
      )

      await ctx.api.deleteMessage(
        ctx.chat.id,
        status.message_id
      ).catch(() => {})
    } catch (error) {
      console.error("Download error:", error)

      let message = "دریافت یا ارسال ویدئو ناموفق بود."

      if (error.message === "FILE_TOO_LARGE") {
        message = "حجم فایل بیشتر از حد مجاز ۴۵ مگابایت است."
      } else if (error.name === "AbortError") {
        message = "زمان دریافت ویدئو تمام شد. دوباره امتحان کن."
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
