import { InlineKeyboard } from "grammy"

export function registerCommands(bot) {
  bot.command("start", (ctx) =>
    ctx.reply(
      "سلام! به HamoDownloader خوش اومدی.\n\nلینک یوتیوب یا لینک مستقیم فایل ویدیویی مجاز رو بفرست.\n/help برای راهنما"
    )
  )

  bot.command("help", (ctx) =>
    ctx.reply(
      "راهنمای ربات:\n\n/start شروع ربات\n/help راهنما\n/ping بررسی اتصال\n\nلینک یوتیوب: دریافت و نمایش لینک\nلینک مستقیم ویدیوی مجاز: تلاش برای ارسال ویدیو در تلگرام"
    )
  )

  bot.command("ping", (ctx) => ctx.reply("ربات فعاله ✅"))

  bot.command("id", (ctx) =>
    ctx.reply(`Chat ID: ${ctx.chat.id}`)
  )

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim()

    const youtubePattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i

    if (youtubePattern.test(text)) {
      return ctx.reply(
        "لینک یوتیوب دریافت شد ✅\n\nبرای دریافت فایل، باید امکان دانلود مجاز آن از منبع مستقیم فراهم باشد.\n\nلینک ویدیو:\n" + text
      )
    }

    let url

    try {
      url = new URL(text)
    } catch {
      return ctx.reply(
        "لطفاً یک لینک معتبر ارسال کن."
      )
    }

    if (url.protocol !== "https:") {
      return ctx.reply(
        "فقط لینک امن HTTPS پذیرفته می‌شود."
      )
    }

    const videoPattern =
      /\.(mp4|mov|m4v|webm)$/i

    if (!videoPattern.test(url.pathname)) {
      return ctx.reply(
        "این لینک مستقیم ویدیویی نیست.\nلطفاً لینک مستقیم فایل مجاز را بفرست."
      )
    }

    const status = await ctx.reply(
      "در حال ارسال ویدیو به تلگرام... ⏳"
    )

    try {
      await ctx.replyWithVideo(url.href, {
        supports_streaming: true,
        caption: "ارسال توسط HamoDownloader"
      })

      await ctx.api.deleteMessage(
        ctx.chat.id,
        status.message_id
      )
    } catch (error) {
      console.error("Video sending error:", error)

      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        "ارسال انجام نشد. ممکن است لینک قابل دسترسی نباشد یا محدودیت حجم و زیرساخت تلگرام مانع ارسال شده باشد."
      )
    }
  })
}
