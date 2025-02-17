require("dotenv").config()
const TelegramBot = require("node-telegram-bot-api")
const fs = require("fs")
const path = require("path")

const USER_BOT_TOKEN = process.env.USER_BOT_TOKEN
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN
const ADMIN_CHAT_ID = Number.parseInt(process.env.ADMIN_CHAT_ID)

// Bot yaratish
const userBot = new TelegramBot(USER_BOT_TOKEN, {
  polling: true,
  filepath: false,
  request: {
    retryTimeout: 5000,
  },
})
const adminBot = new TelegramBot(ADMIN_BOT_TOKEN, {
  polling: true,
  filepath: false,
  request: {
    retryTimeout: 5000,
  },
})

const users = {}
let correctAnswers = {}
let tests = []
let lastMessageId = null
const lastUserMessageId = {}

// Bot ma'lumotlarini saqlash uchun
let botInfo = {
  name: "Test Bot",
  description: "Test ishlash va tekshirish uchun bot",
  photo: "bot-photo.jpg",
  createdAt: new Date().toISOString(),
}

// Cache for active user sessions
const userSessions = new Map()

// Ma'lumotlarni saqlash va yuklash funksiyalari
function saveData() {
  const data = {
    correctAnswers,
    tests,
    botInfo,
  }
  fs.writeFileSync("data/botData.json", JSON.stringify(data))
}

function loadData() {
  if (fs.existsSync("data/botData.json")) {
    const data = JSON.parse(fs.readFileSync("data/botData.json"))
    correctAnswers = data.correctAnswers
    tests = data.tests
    botInfo = data.botInfo
  }
}

// Ensure data directory exists
if (!fs.existsSync("data")) {
  fs.mkdirSync("data")
}

// Bot ishga tushganda ma'lumotlarni yuklash
loadData()

// Xatoliklarni nazorat qilish
userBot.on("polling_error", (error) => console.log("User bot polling error:", error))
adminBot.on("polling_error", (error) => console.log("Admin bot polling error:", error))

// Function to update user sessions asynchronously
async function updateUserSessions() {
  for (const [chatId, session] of userSessions.entries()) {
    try {
      if (session.step === "test_in_progress") {
        const updatedTest = tests.find((t) => t.name === session.currentTestId)
        if (updatedTest && updatedTest.active) {
          // Test is still active, no need to update
          continue
        }
        // Test was deactivated or removed, notify user
        await userBot.sendMessage(
          chatId,
          "⚠️ Kechirasiz, joriy test o'zgartirildi yoki o'chirildi. Iltimos, yangi test tanlang.",
        )
        await showUserMenu(chatId)
        userSessions.delete(chatId)
      }
    } catch (error) {
      console.error(`Error updating session for chat ${chatId}:`, error)
    }
  }
}

// === ADMIN BOT === //
adminBot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id
  if (chatId !== ADMIN_CHAT_ID) return
  await deleteLastMessage(chatId)
  await showAdminMainMenu(chatId)
})

adminBot.onText(/\/setphoto/, async (msg) => {
  const chatId = msg.chat.id
  if (chatId !== ADMIN_CHAT_ID) return

  await deleteLastMessage(chatId)
  const message = await adminBot.sendMessage(chatId, "🖼 <b>Botning yangi rasmini yuklang:</b>", { parse_mode: "HTML" })
  lastMessageId = message.message_id
  users[chatId] = { step: "set_bot_photo" }
})

adminBot.onText(/\/setdesc/, async (msg) => {
  const chatId = msg.chat.id
  if (chatId !== ADMIN_CHAT_ID) return

  await deleteLastMessage(chatId)
  const message = await adminBot.sendMessage(chatId, "📝 <b>Botning yangi tavsifini yozing:</b>", {
    parse_mode: "HTML",
  })
  lastMessageId = message.message_id
  users[chatId] = { step: "set_bot_desc" }
})

async function deleteLastMessage(chatId) {
  if (lastMessageId) {
    try {
      await adminBot.deleteMessage(chatId, lastMessageId)
    } catch (error) {
      console.log("Error deleting message:", error)
    }
  }
}

async function showAdminMainMenu(chatId) {
  const msg = await adminBot.sendMessage(chatId, "🎯 <b>Admin paneliga xush kelibsiz</b>", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📝 Yangi test yaratish", callback_data: "create_test" }],
        [{ text: "✅ Natija yaratish", callback_data: "create_result" }],
        [{ text: "📊 Natijalar ro'yxati", callback_data: "show_answers" }],
        [{ text: "🖼 Bot rasmini o'zgartirish", callback_data: "change_photo" }],
        [{ text: "📝 Bot tavsifini o'zgartirish", callback_data: "change_desc" }],
      ],
    },
  })
  lastMessageId = msg.message_id
}

async function showTestList(chatId) {
  const keyboard = []

  tests.forEach((test, index) => {
    keyboard.push([
      { text: `${test.name}`, callback_data: `test:${index}` },
      {
        text: test.active ? "🔴 O'chirish" : "🟢 Yoqish",
        callback_data: `toggle_activity:${index}`,
      },
      { text: "🗑 Olib tashlash", callback_data: `remove_test:${index}` },
    ])
  })

  keyboard.push([{ text: "➕ Yangi test yuklash", callback_data: "add_new_test" }])
  keyboard.push([{ text: "⬅️ Orqaga", callback_data: "back_to_main" }])

  await deleteLastMessage(chatId)
  const msg = await adminBot.sendMessage(chatId, "📚 <b>Testlar ro'yxati:</b>", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: keyboard,
    },
  })
  lastMessageId = msg.message_id
}

async function showAnswersList(chatId) {
  const keyboard = []

  Object.entries(correctAnswers).forEach(([testId, data]) => {
    keyboard.push([
      { text: `${testId}: ${data.answers}`, callback_data: `answer:${testId}` },
      {
        text: data.active ? "🔴 O'chirish" : "🟢 Yoqish",
        callback_data: `toggle_answer:${testId}`,
      },
      { text: "🗑 Olib tashlash", callback_data: `remove_answer:${testId}` },
    ])
  })

  keyboard.push([{ text: "⬅️ Orqaga", callback_data: "back_to_main" }])

  await deleteLastMessage(chatId)
  const msg = await adminBot.sendMessage(chatId, "📊 <b>Natijalar ro'yxati:</b>", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: keyboard,
    },
  })
  lastMessageId = msg.message_id
}

adminBot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id
  if (chatId !== ADMIN_CHAT_ID) return

  const data = query.data

  try {
    switch (data) {
      case "create_test":
        await deleteLastMessage(chatId)
        await showTestList(chatId)
        break

      case "create_result":
        await deleteLastMessage(chatId)
        const msg = await adminBot.sendMessage(
          chatId,
          "📝 <b>To'g'ri javoblarni quyidagi formatda yozing:</b>\n\n<code>1211:ABCD...</code>",
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "back_to_main" }]],
            },
          },
        )
        lastMessageId = msg.message_id
        break

      case "show_answers":
        await showAnswersList(chatId)
        break

      case "add_new_test":
        await deleteLastMessage(chatId)
        users[chatId] = { step: "new_test_name" }
        const newMsg = await adminBot.sendMessage(chatId, "📝 <b>Yangi test nomini kiriting:</b>", {
          parse_mode: "HTML",
        })
        lastMessageId = newMsg.message_id
        break

      case "back_to_main":
        await showAdminMainMenu(chatId)
        break

      case "change_photo":
        await deleteLastMessage(chatId)
        users[chatId] = { step: "set_bot_photo" }
        const photoMsg = await adminBot.sendMessage(chatId, "🖼 <b>Botning yangi rasmini yuklang:</b>", {
          parse_mode: "HTML",
        })
        lastMessageId = photoMsg.message_id
        break

      case "change_desc":
        await deleteLastMessage(chatId)
        users[chatId] = { step: "set_bot_desc" }
        const descMsg = await adminBot.sendMessage(chatId, "📝 <b>Botning yangi tavsifini yozing:</b>", {
          parse_mode: "HTML",
        })
        lastMessageId = descMsg.message_id
        break

      default:
        if (data.startsWith("toggle_activity:")) {
          const testId = Number.parseInt(data.split(":")[1])
          tests[testId].active = !tests[testId].active
          await adminBot.answerCallbackQuery(query.id, `✅ Test ${tests[testId].active ? "yoqildi" : "o'chirildi"}`)
          await showTestList(chatId)
          updateUserSessions() // Update user sessions asynchronously
        } else if (data.startsWith("toggle_answer:")) {
          const testId = data.split(":")[1]
          correctAnswers[testId].active = !correctAnswers[testId].active
          await adminBot.answerCallbackQuery(
            query.id,
            `✅ Natija ${correctAnswers[testId].active ? "yoqildi" : "o'chirildi"}`,
          )
          await showAnswersList(chatId)
          updateUserSessions() // Update user sessions asynchronously
        } else if (data.startsWith("remove_test:")) {
          const testId = Number.parseInt(data.split(":")[1])
          if (tests[testId]?.filename) {
            try {
              fs.unlinkSync(`data/${tests[testId].filename}`)
            } catch (err) {
              console.log("File delete error:", err)
            }
          }
          tests.splice(testId, 1)
          await adminBot.answerCallbackQuery(query.id, "✅ Test o'chirildi")
          await showTestList(chatId)
          updateUserSessions() // Update user sessions asynchronously
        } else if (data.startsWith("remove_answer:")) {
          const testId = data.split(":")[1]
          delete correctAnswers[testId]
          await adminBot.answerCallbackQuery(query.id, "✅ Natija o'chirildi")
          await showAnswersList(chatId)
          updateUserSessions() // Update user sessions asynchronously
        }
    }
  } catch (error) {
    console.error("Callback query error:", error)
    await adminBot.sendMessage(chatId, "❌ Xatolik yuz berdi. Qaytadan urinib ko'ring.")
  }
})

adminBot.on("message", async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text

  if (chatId !== ADMIN_CHAT_ID) return
  if (text === "/start") return

  try {
    if (users[chatId]?.step === "new_test_name") {
      users[chatId].newTestName = text
      users[chatId].step = "new_test_file"
      await deleteLastMessage(chatId)
      const msg = await adminBot.sendMessage(chatId, "📤 <b>Test PDF faylini yuklang</b>", { parse_mode: "HTML" })
      lastMessageId = msg.message_id
    } else if (text && text.includes(":")) {
      const [testId, answers] = text.split(":")
      correctAnswers[testId] = {
        answers: answers.toUpperCase(),
        active: true,
      }
      await deleteLastMessage(chatId)
      const msg = await adminBot.sendMessage(chatId, "✅ <b>Natija saqlandi!</b>", {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "back_to_main" }]],
        },
      })
      lastMessageId = msg.message_id
      updateUserSessions() // Update user sessions asynchronously
    } else if (users[chatId]?.step === "set_bot_desc") {
      botInfo.description = text
      await deleteLastMessage(chatId)
      const message = await adminBot.sendMessage(chatId, "✅ <b>Bot tavsifi yangilandi!</b>", { parse_mode: "HTML" })
      lastMessageId = message.message_id
      setTimeout(() => showAdminMainMenu(chatId), 1500)
      delete users[chatId]
    }
  } catch (error) {
    console.error("Message handling error:", error)
    await adminBot.sendMessage(chatId, "❌ Xatolik yuz berdi. Qaytadan urinib ko'ring.")
  }
})

adminBot.on("document", async (msg) => {
  const chatId = msg.chat.id
  if (chatId !== ADMIN_CHAT_ID) return

  if (users[chatId]?.step === "new_test_file") {
    try {
      const fileId = msg.document.file_id
      const fileName = `test_${Date.now()}.pdf`

      if (!fs.existsSync("data")) {
        fs.mkdirSync("data")
      }

      const filePath = await adminBot.downloadFile(fileId, "data")
      fs.renameSync(filePath, `data/${fileName}`)

      tests.push({
        name: users[chatId].newTestName,
        filename: fileName,
        active: true,
      })

      delete users[chatId]
      await deleteLastMessage(chatId)
      const message = await adminBot.sendMessage(chatId, "✅ <b>Test muvaffaqiyatli qo'shildi!</b>", {
        parse_mode: "HTML",
      })
      lastMessageId = message.message_id
      setTimeout(() => showTestList(chatId), 1500)
      updateUserSessions() // Update user sessions asynchronously
    } catch (error) {
      console.error("File upload error:", error)
      await adminBot.sendMessage(chatId, "❌ Fayl yuklashda xatolik yuz berdi. Qaytadan urinib ko'ring.")
    }
  }
})

adminBot.on("photo", async (msg) => {
  const chatId = msg.chat.id
  if (chatId !== ADMIN_CHAT_ID) return

  if (users[chatId]?.step === "set_bot_photo") {
    try {
      const photo = msg.photo[msg.photo.length - 1] // Eng katta o'lchamdagi rasm
      const file = await adminBot.downloadFile(photo.file_id, "data")

      // Eski rasmni o'chirish
      if (fs.existsSync(`data/${botInfo.photo}`)) {
        fs.unlinkSync(`data/${botInfo.photo}`)
      }

      // Yangi rasmni saqlash
      const newFileName = `bot-photo-${Date.now()}.jpg`
      fs.renameSync(file, `data/${newFileName}`)
      botInfo.photo = newFileName

      await deleteLastMessage(chatId)
      const message = await adminBot.sendMessage(chatId, "✅ <b>Bot rasmi yangilandi!</b>", { parse_mode: "HTML" })
      lastMessageId = message.message_id
      setTimeout(() => showAdminMainMenu(chatId), 1500)
      delete users[chatId]
    } catch (error) {
      console.error("Photo upload error:", error)
      await adminBot.sendMessage(chatId, "❌ Rasm yuklashda xatolik yuz berdi.")
    }
  }
})

// === USER BOT === //
userBot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id

  try {
    // Bot rasmini yuborish
    if (fs.existsSync(`data/${botInfo.photo}`)) {
      await userBot.sendPhoto(chatId, fs.createReadStream(`data/${botInfo.photo}`), {
        caption: `🤖 <b>${botInfo.name}</b>\n\n📝 ${botInfo.description}\n\n⏰ Bot ishga tushirilgan vaqt: ${new Date(botInfo.createdAt).toLocaleString("uz-UZ")}`,
        parse_mode: "HTML",
      })
    }

    const message = await userBot.sendMessage(
      chatId,
      "👋 <b>Assalomu alaykum!</b>\nIltimos, ismingiz va familiyangizni kiriting.",
      { parse_mode: "HTML" },
    )
    lastUserMessageId[chatId] = message.message_id
    userSessions.set(chatId, { step: "name" })
  } catch (error) {
    console.error("Start command error:", error)
    const message = await userBot.sendMessage(
      chatId,
      "👋 <b>Assalomu alaykum!</b>\nIltimos, ismingiz va familiyangizni kiriting.",
      { parse_mode: "HTML" },
    )
    lastUserMessageId[chatId] = message.message_id
    userSessions.set(chatId, { step: "name" })
  }
})

userBot.on("message", async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text

  if (!userSessions.has(chatId)) return

  try {
    const session = userSessions.get(chatId)
    if (session.step === "name") {
      session.name = text
      session.step = "phone"
      const message = await userBot.sendMessage(
        chatId,
        `👤 Rahmat, <b>${text}</b>.\n📱 Endi telefon raqamingizni ulashing:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [[{ text: "📞 Raqamni ulashish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      )
      lastUserMessageId[chatId] = message.message_id
      userSessions.set(chatId, session)
    } else if (session.step === "check_answers") {
      const [testId, answers] = text.split(":")
      if (!correctAnswers[testId] || !correctAnswers[testId].active) {
        const message = await userBot.sendMessage(chatId, "❌ Bu test ID bo'yicha natijalar topilmadi.")
        lastUserMessageId[chatId] = message.message_id
        setTimeout(() => showUserMenu(chatId), 1500)
        session.step = "menu"
        userSessions.set(chatId, session)
        return
      }

      const correct = correctAnswers[testId].answers
      let correctCount = 0,
        wrongCount = 0

      for (let i = 0; i < Math.min(answers.length, correct.length); i++) {
        if (answers[i].toUpperCase() === correct[i]) correctCount++
        else wrongCount++
      }

      const message = await userBot.sendMessage(
        chatId,
        `📊 <b>Natijangiz:</b>\n✅ To'g'ri: ${correctCount}\n❌ Noto'g'ri: ${wrongCount}`,
        { parse_mode: "HTML" },
      )
      lastUserMessageId[chatId] = message.message_id

      // Admin botga natijalarni yuborish
      await sendResultToAdmin(session, testId, correctCount, wrongCount)

      setTimeout(() => showUserMenu(chatId), 2000)
      session.step = "menu"
      userSessions.set(chatId, session)
    } else if (text === "📝 Test tekshirish") {
      session.step = "check_answers"
      const message = await userBot.sendMessage(
        chatId,
        "📝 Javoblarni quyidagi formatda yozing:\n<code>1211:ABCD...</code>",
        { parse_mode: "HTML" },
      )
      lastUserMessageId[chatId] = message.message_id
      userSessions.set(chatId, session)
    } else if (text === "📚 Test ishlash") {
      try {
        const activeTests = tests.filter((test) => test.active)
        if (activeTests.length === 0) {
          const message = await userBot.sendMessage(chatId, "❌ Hozircha faol testlar yo'q.")
          lastUserMessageId[chatId] = message.message_id
          setTimeout(() => showUserMenu(chatId), 1500)
          return
        }

        const randomTest = activeTests[Math.floor(Math.random() * activeTests.length)]
        const filePath = path.join("data", randomTest.filename)

        if (!fs.existsSync(filePath)) {
          console.error(`Test file not found: ${filePath}`)
          await userBot.sendMessage(chatId, "❌ Kechirasiz, test fayli topilmadi. Iltimos, adminga murojaat qiling.")
          await notifyAdminAboutMissingFile(randomTest)
          setTimeout(() => showUserMenu(chatId), 1500)
          return
        }

        // Send document without storing message ID
        await userBot.sendDocument(chatId, fs.createReadStream(filePath))

        // Store only the menu message ID
        const message = await userBot.sendMessage(
          chatId,
          `📝 Test ID: ${randomTest.name}\nJavoblarni yuborish uchun 'Javob berish' tugmasini bosing`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "✍️ Javob berish", callback_data: "submit_answers" }]],
            },
          },
        )
        lastUserMessageId[chatId] = message.message_id
        session.currentTestId = randomTest.name
        session.step = "test_in_progress"
        userSessions.set(chatId, session)
      } catch (error) {
        console.error("Error in Test ishlash:", error)
        await userBot.sendMessage(chatId, "❌ Test yuklashda xatolik yuz berdi. Iltimos, adminga murojaat qiling.")
      }
    }
  } catch (error) {
    console.error("User message handling error:", error)
    await userBot.sendMessage(chatId, "❌ Xatolik yuz berdi. Qaytadan urinib ko'ring.")
  }
})

userBot.on("contact", async (msg) => {
  const chatId = msg.chat.id
  const phone = msg.contact.phone_number

  if (userSessions.has(chatId) && userSessions.get(chatId).step === "phone") {
    const session = userSessions.get(chatId)
    session.phone = phone
    session.step = "menu"
    userSessions.set(chatId, session)
    await showUserMenu(chatId)
  }
})

userBot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id
  if (query.data === "submit_answers") {
    const session = userSessions.get(chatId)
    session.step = "check_answers"
    const message = await userBot.sendMessage(
      chatId,
      `📝 Test ID: ${session.currentTestId}\nJavoblaringizni quyidagi formatda yuboring:\n<code>${session.currentTestId}:ABCD...</code>`,
      { parse_mode: "HTML" },
    )
    lastUserMessageId[chatId] = message.message_id
    userSessions.set(chatId, session)
  }
})

async function showUserMenu(chatId) {
  const message = await userBot.sendMessage(chatId, "📋 <b>Qanday harakat qilamiz?</b>", {
    parse_mode: "HTML",
    reply_markup: {
      keyboard: [[{ text: "📝 Test tekshirish" }], [{ text: "📚 Test ishlash" }]],
      resize_keyboard: true,
    },
  })
  lastUserMessageId[chatId] = message.message_id
}

// Foydalanuvchi natijalarini adminga yuborish funksiyasi
async function sendResultToAdmin(user, testId, correctCount, wrongCount) {
  const now = new Date()
  await adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `👤 <b>Foydalanuvchi:</b> ${user.name}\n📱 <b>Tel:</b> ${user.phone}\n🔢 <b>Test ID:</b> ${testId}\n📊 <b>Natija:</b> ${correctCount} to'g'ri, ${wrongCount} noto'g'ri\n🕒 <b>Yuborilgan vaqt:</b> ${now.toLocaleString("uz-UZ")}`,
    { parse_mode: "HTML" },
  )
}

async function notifyAdminAboutMissingFile(test) {
  await adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `⚠️ <b>Diqqat!</b>\n\nQuyidagi test fayli topilmadi:\nTest nomi: ${test.name}\nFayl nomi: ${test.filename}\n\nIltimos, faylni tekshiring va qayta yuklang.`,
    { parse_mode: "HTML" },
  )
}

// Botni ishga tushirish
console.log("🚀 Bot ishga tushdi!")

// Ma'lumotlarni saqlash
process.on("SIGINT", () => {
  saveData()
  process.exit()
})

// Xatoliklarni nazorat qilish
process.on("unhandledRejection", (error) => {
  console.log("unhandledRejection:", error)
})

// Add error handlers for both bots
userBot.on("error", (error) => {
  console.log("User bot error:", error.code)
  if (error.code === "EFATAL") {
    process.exit(1)
  }
})

adminBot.on("error", (error) => {
  console.log("Admin bot error:", error.code)
  if (error.code === "EFATAL") {
    process.exit(1)
  }
})

