export function registerCommands(bot) {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "سلام! به HamoDownloader خوش اومدی 🎬\n\n" +
      "لینک ویدئو رو بفرست تا بررسی کنم.\n\n" +
      "/help راهنما\n" +
      "/ping بررسی اتصال"
    )
  })

  bot.command("help", (ctx) =>
    ctx.reply(
      "راهنمای HamoDownloader:\n\n" +
      "• لینک مستقیم MP4: ارسال ویدئو\n" +
      "• لینک YouTube: تشخیص لینک و راهنمای دریافت مجاز\n" +
      "• لینک سایت‌های دیگر: بررسی اولیه\n\n" +
      "برای دانلود، فایل باید از منبع مجاز و قابل دسترس باشد."
    )
  )

  bot.command("ping", (ctx) =>
    ctx.reply("ربات فعاله ✅")
  )

  bot.command("id", (ctx) =>
    ctx.reply(`Chat ID: ${ctx.chat.id}`)
  )

  bot.on("message:text", async (ctx) => {
    const input = ctx.message.text.trim()

    let url

    try {
      url = new URL(input)
    } catch {
      return ctx.reply("لطفاً یک لینک معتبر بفرست.")
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      return ctx.reply("این نوع لینک پشتیبانی نمی‌شود.")
    }

    const host = url.hostname.toLowerCase()

    const videoSites = [
      "youtube.com",
      "youtu.be",
      "vimeo.com",
      "dailymotion.com"
    ]

    const isVideoSite = videoSites.some(
      site => host === site || host.endsWith("." + site)
    )

    if (isVideoSite) {
      return ctx.reply(
        "لینک ویدئو دریافت شد ✅\n\n" +
        "این سایت شناسایی شد، اما دانلود خودکار آن هنوز فعال نیست.\n" +
        "برای دریافت، باید فایل از منبع مجاز در دسترس باشد."
      )
    }

    if (url.protocol !== "https:") {
      return ctx.reply("لطفاً از لینک HTTPS استفاده کن.")
    }

    const videoPattern = /\.(mp4|mov|m4v|webm)$/i

    if (!videoPattern.test(url.pathname)) {
      return ctx.reply(
        "این لینک مستقیم ویدئو نیست یا پسوند آن قابل تشخیص نیست."
      )
    }

    const status = await ctx.reply(
      "در حال ارسال ویدئو... ⏳"
    )

    try {
      await ctx.replyWithVideo(url.href, {
        supports_streaming: true,
        caption: "ارسال توسط HamoDownloader 🎬"
      })

      await ctx.api.deleteMessage(
        ctx.chat.id,
        status.message_id
      )
    } catch (error) {
      console.error("Video error:", error)

      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        "ارسال ناموفق بود. ممکن است لینک یا حجم فایل پشتیبانی نشود."
      )
    }
  })
}
