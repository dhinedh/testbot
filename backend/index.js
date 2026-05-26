require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsapp-crm';

// --- MongoDB Setup ---
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const contactSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String },
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 0 },
    messages: [{
        text: String,
        time: { type: Date, default: Date.now }
    }]
});

const Contact = mongoose.model('Contact', contactSchema);

// --- CRM Functions (Async) ---
async function saveToCRM(phone, name, messageText) {
    try {
        let contact = await Contact.findOne({ phone });
        const now = new Date();

        if (!contact) {
            // New contact
            contact = new Contact({
                phone: phone,
                name: name || phone,
                firstSeen: now,
                lastSeen: now,
                messageCount: 1,
                messages: [{ text: messageText, time: now }]
            });
            await contact.save();
        } else {
            // Existing contact
            contact.lastSeen = now;
            contact.messageCount += 1;
            if (name) {
                contact.name = name;
            }
            contact.messages.push({ text: messageText, time: now });
            await contact.save();
        }
        return contact;
    } catch (err) {
        console.error('Error saving to CRM:', err);
        return null;
    }
}

// --- Chatbot Logic ---
function getBotReply(message, contact) {
    if (!contact) return `I'm having trouble accessing the database. Please try again.`;

    const msg = message.toLowerCase().trim();
    const isNew = contact.messageCount === 1;

    const menu = `\nReply with:\n1️⃣ Services\n2️⃣ Pricing\n3️⃣ Talk to a human`;

    if (isNew) {
        return `👋 Welcome! I'm here to help.` + menu;
    }

    if (msg === "1" || msg.includes("service")) {
        return `Here are our services:\n- Web Development\n- WhatsApp Bots\n- CRM Integrations` + menu;
    }

    if (msg === "2" || msg.includes("price") || msg.includes("cost")) {
        return `Our pricing is custom tailored to your needs. Starting from $99.` + menu;
    }

    if (msg === "3" || msg.includes("human") || msg.includes("agent")) {
        return `Our team will contact you shortly!`;
    }

    if (msg.includes("hi") || msg.includes("hello") || msg.includes("hey")) {
        return `👋 Hello again! How can I help you?` + menu;
    }

    return `I didn't quite catch that. Here is what I can do:` + menu;
}

// --- Send Message ---
async function sendMessage(to, text) {
    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error("Missing WhatsApp credentials in .env");
        return;
    }
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text }
            }
        });
        console.log(`Message sent to ${to}`);
    } catch (error) {
        console.error("Error sending message:", error.response ? error.response.data : error.message);
    }
}

// --- Webhook Endpoints ---
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    // Return 200 immediately per Meta requirements
    res.sendStatus(200);

    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
            const webhook_event = body.entry[0].changes[0].value;
            const message = webhook_event.messages[0];
            const contactInfo = webhook_event.contacts && webhook_event.contacts[0] ? webhook_event.contacts[0] : null;
            
            if (message.type === 'text') {
                const phone = message.from;
                const messageText = message.text.body;
                const name = contactInfo && contactInfo.profile ? contactInfo.profile.name : '';

                // Save to CRM asynchronously
                const contact = await saveToCRM(phone, name, messageText);
                
                if (contact) {
                    // Get reply
                    const replyText = getBotReply(messageText, contact);
                    // Send reply
                    await sendMessage(phone, replyText);
                }
            }
        }
    }
});

// --- Dashboard API Endpoints ---
app.get('/crm', async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ lastSeen: -1 });
        res.json({
            totalContacts: contacts.length,
            contacts: contacts
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch contacts" });
    }
});

app.get('/crm/:phone', async (req, res) => {
    try {
        const contact = await Contact.findOne({ phone: req.params.phone });
        if (contact) {
            res.json(contact);
        } else {
            res.status(404).json({ error: "Contact not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.delete('/crm/:phone', async (req, res) => {
    try {
        const result = await Contact.deleteOne({ phone: req.params.phone });
        if (result.deletedCount > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Contact not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Failed to delete contact" });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
