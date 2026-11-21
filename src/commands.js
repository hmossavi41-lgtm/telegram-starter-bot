import { pipeline } from "node:stream/promises"
import { createWriteStream, createReadStream } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { request } from "undici"

const MAX_FILE_SIZE = 45 * 1024 * 1024
const MAX_DOWNLOAD_TIME = 5 * 60 * 1000

export function registerCommands(bot) {
  bot.command("start", ctx =>
    ctx.reply("سلام! به HamoDownloader خوش اومدی 🎬\nلینک مستقیم MP4 بفرست.")
  )

  bot.command("help", ctx =>
    ctx.reply("لینک مستقیم HTTPS با پسوند MP4 بفرست. دریافت فایل به‌صورت جریانی انجام می‌شود.")
  )

  bot.command("ping", ctx => ctx.reply("ربات فعاله ✅"))

  bot.on("message:text", async ctx => {
    let url

    try {
      url = new URL(ctx.message.text.trim())
    } catch {
      return ctx.reply("لینک معتبر نیست.")
    }

    if (url.protocol !== "https:") {
      return ctx.reply("فقط لینک HTTPS پذیرفته می‌شود.")
    }

    if (!/\.(mp4|mov|m4v|webm)$/i.test(url.pathname)) {
      return ctx.reply("فعلاً فقط لینک مستقیم ویدئو پشتیبانی می‌شود.")
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
          throw new Error(`HTTP ${response.statusCode}`)
        }

        const length = Number(response.headers["content-length"] || 0)

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

      if (info.size > MAX_FILE_SIZE) {
        throw new Error("FILE_TOO_LARGE")
      }

      await ctx.replyWithVideo(
        createReadStream(file),
        { caption: "ارسال توسط HamoDownloader 🎬" }
      )

      await ctx.api.deleteMessage(ctx.chat.id, status.message_id)
    } catch (error) {
      console.error("Download error:", error)

      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        error.message === "FILE_TOO_LARGE"
          ? "حجم فایل از حد مجاز این نسخه بیشتر است."
          : "دریافت یا ارسال فایل ناموفق بود."
      )
    } finally {
      if (folder) {
        await rm(folder, { recursive: true, force: true })
      }
    }
  })
}
