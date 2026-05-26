require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors({ origin: 'https://testbot-gray-rho.vercel.app' }));
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
async function sendInteractiveButtons(to, bodyText, buttonLabels) {
    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) return;
    
    const buttons = buttonLabels.map((label, index) => ({
        type: "reply",
        reply: {
            id: `btn_${index + 1}`,
            title: label.substring(0, 20)
        }
    }));

    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: bodyText },
                    action: { buttons }
                }
            }
        });
        console.log(`Interactive buttons sent to ${to}`);
    } catch (error) {
        console.error("Error sending buttons:", error.response ? error.response.data : error.message);
    }
}

async function handleBotReply(phone, messageText, contact) {
    if (!contact) {
        await sendMessage(phone, `I'm having trouble accessing the database. Please try again.`);
        return;
    }

    const msg = messageText.toLowerCase().trim();
    const isNew = contact.messageCount === 1;

    if (isNew || msg.includes("hi") || msg.includes("hello") || msg.includes("hey")) {
        await sendInteractiveButtons(
            phone,
            `👋 Hello! How can I help you?`,
            ["Services", "Pricing", "Talk to a human"]
        );
        return;
    }

    if (msg === "btn_1" || msg.includes("service")) {
        await sendMessage(phone, `Here are our services:\n- Web Development\n- WhatsApp Bots\n- CRM Integrations`);
        await sendInteractiveButtons(phone, `What would you like to do next?`, ["Pricing", "Talk to a human"]);
        return;
    }

    if (msg === "btn_2" || msg.includes("price") || msg.includes("cost")) {
        await sendMessage(phone, `Our pricing is custom tailored to your needs. Starting from $99.`);
        await sendInteractiveButtons(phone, `Want to connect with our team?`, ["Talk to a human"]);
        return;
    }

    if (msg === "btn_3" || msg.includes("human") || msg.includes("agent")) {
        await sendMessage(phone, `Our team will contact you shortly!`);
        return;
    }

    await sendInteractiveButtons(
        phone,
        `I didn't quite catch that. Here is what I can do:`,
        ["Services", "Pricing", "Talk to a human"]
    );
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
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
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
            
            let messageText = '';
            if (message.type === 'text') {
                messageText = message.text.body;
            } else if (message.type === 'interactive' && message.interactive.button_reply) {
                messageText = message.interactive.button_reply.id;
            }

            if (messageText) {
                const phone = message.from;
                const name = contactInfo && contactInfo.profile ? contactInfo.profile.name : '';

                // Save to CRM asynchronously
                const contact = await saveToCRM(phone, name, messageText);
                
                if (contact) {
                    await handleBotReply(phone, messageText, contact);
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
