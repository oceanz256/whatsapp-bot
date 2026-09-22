const { makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')

// --- CONFIGURE HERE ---
const BAD_WORDS = ['porn', 'xxx', 'sex', 'nude', 'naked', 'pussy', 'dick', 'cum', 'onlyfans']
const ALLOW_ADMINS_TO_SEND_LINKS = true // set false if even admins can't send links

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, printQRInTerminal: true })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const sender = msg.key.participant || from
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || "").toLowerCase()

    // === 1. VIEW ONCE RECOVER ===
    const viewOnce = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message
    if (viewOnce) {
      try {
        const buffer = await downloadMediaMessage({ key: msg.key, message: viewOnce }, 'buffer', {}, { logger: console, reuploadRequest: sock.updateMediaMessage })
        const type = Object.keys(viewOnce)[0]
        if (type.includes('image')) await sock.sendMessage(sock.user.id, { image: buffer, caption: `ViewOnce from ${sender}` })
        if (type.includes('video')) await sock.sendMessage(sock.user.id, { video: buffer, caption: `ViewOnce from ${sender}` })
      } catch(e){}
      return
    }

    if (!from.endsWith('@g.us')) return
    const metadata = await sock.groupMetadata(from)
    const botIsAdmin = metadata.participants.find(p => p.id === sock.user.id)?.admin
    const senderIsAdmin = metadata.participants.find(p => p.id === sender)?.admin
    if (!botIsAdmin) return
    if (ALLOW_ADMINS_TO_SEND_LINKS && senderIsAdmin) return

    // === 2. ANTI-LINK ===
    const linkRegex = /(https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/|instagram\.com|tiktok\.com)/i
    if (linkRegex.test(text)) {
      await sock.sendMessage(from, { delete: msg.key })
      await sock.sendMessage(from, { text: `❌ Link detected & deleted @${sender.split('@')[0]}`, mentions: [sender] })
      return
    }

    // === 3. ANTI-MENTION ===
    const mentionCount = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length || 0
    if (mentionCount > 5 || text.includes('@all') || text.includes('@everyone')) {
      await sock.sendMessage(from, { delete: msg.key })
      await sock.sendMessage(from, { text: `❌ Mass mention blocked @${sender.split('@')[0]}`, mentions: [sender] })
      return
    }

    // === 4. ANTI-FAKE / HIGHLY FORWARDED ===
    const context = msg.message.extendedTextMessage?.contextInfo
    if (context?.isForwarded && context?.forwardingScore > 3) { // 3 = forwarded many times
      await sock.sendMessage(from, { delete: msg.key })
      await sock.sendMessage(from, { text: `❌ Highly forwarded messages not allowed @${sender.split('@')[0]}`, mentions: [sender] })
      return
    }

    // === 5. ANTI-PORN / BAD WORDS ===
    if (BAD_WORDS.some(w => text.includes(w))) {
      await sock.sendMessage(from, { delete: msg.key })
      await sock.sendMessage(from, { text: `❌ Inappropriate language blocked @${sender.split('@')[0]}`, mentions: [sender] })
      return
    }
  })
}
start()
