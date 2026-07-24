require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- Health & Root Endpoints ---
app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head><title>WhatsApp Bot & CRM Backend</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc;">
            <h1 style="color: #22c55e;">✅ WhatsApp Bot & CRM Server is Live!</h1>
            <p>Server Status: <strong>Operational</strong></p>
            <p>Webhook URL: <code>https://whatapp-automation-kxml.onrender.com/webhook</code></p>
            <p>CRM API Endpoint: <code>/crm</code></p>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsapp-crm';
const SALES_TEAM_PHONE = process.env.SALES_TEAM_PHONE || '';
const GOOGLE_SHEETS_WEBHOOK = process.env.GOOGLE_SHEETS_WEBHOOK || '';

function getMetaToken(platform) {
    if (platform === 'facebook' && process.env.PAGE_ACCESS_TOKEN) {
        return process.env.PAGE_ACCESS_TOKEN.trim().replace(/^["']|["']$/g, '');
    }
    const token = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || process.env.ACCESS_TOKEN || '';
    return token.trim().replace(/^["']|["']$/g, '');
}

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
    }],
    selected_service: { type: String, default: "" },
    area_required: { type: String, default: "" },
    site_location: { type: String, default: "" },
    project_timeline: { type: String, default: "" },
    budget_range: { type: String, default: "" },
    quote_step: { type: Number, default: 0 },
    lead_status: { type: String, default: "New" },
    lead_score: { type: Number, default: 0 },
    is_paused: { type: Boolean, default: false }
});

const Contact = mongoose.model('Contact', contactSchema);

// --- Meta Send API Helpers for Facebook Messenger & Instagram DM ---
async function sendMetaMessage(to, text) {
    const isIG = to.startsWith('ig:');
    const token = getMetaToken(isIG ? 'instagram' : 'facebook');
    if (!token) {
        console.warn('⚠️ Missing Instagram / Meta Access Token');
        return;
    }
    const rawId = to.replace(/^(fb:|ig:)/, '');
    const data = {
        recipient: { id: rawId },
        message: { text: text }
    };

    // If Instagram token starts with IGAA, try Instagram Graph API first
    const primaryUrl = (isIG && token.startsWith('IGAA'))
        ? `https://graph.instagram.com/v20.0/me/messages`
        : `https://graph.facebook.com/v20.0/me/messages`;
    const secondaryUrl = (isIG && token.startsWith('IGAA'))
        ? `https://graph.facebook.com/v20.0/me/messages`
        : `https://graph.instagram.com/v20.0/me/messages`;

    try {
        await axios.post(primaryUrl, data, {
            params: { access_token: token },
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        console.log(`✅ [Meta DM Sent] Successfully sent message to ${to}`);
    } catch (error) {
        try {
            await axios.post(secondaryUrl, data, {
                params: { access_token: token },
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            console.log(`✅ [Meta DM Sent via fallback API] Successfully sent message to ${to}`);
        } catch (err2) {
            console.error(`Error sending Meta message to ${to}:`, error.response ? error.response.data : error.message);
        }
    }
}

async function sendMetaQuickReplies(to, bodyText, buttonsArray) {
    const isIG = to.startsWith('ig:');
    const token = getMetaToken(isIG ? 'instagram' : 'facebook');
    if (!token) {
        console.warn('⚠️ Missing Instagram / Meta Access Token');
        return;
    }
    const rawId = to.replace(/^(fb:|ig:)/, '');

    const primaryUrl = (isIG && token.startsWith('IGAA'))
        ? `https://graph.instagram.com/v20.0/me/messages`
        : `https://graph.facebook.com/v20.0/me/messages`;
    const secondaryUrl = (isIG && token.startsWith('IGAA'))
        ? `https://graph.facebook.com/v20.0/me/messages`
        : `https://graph.instagram.com/v20.0/me/messages`;

    // For Facebook Messenger, try Button Template first for in-bubble buttons
    if (!isIG && buttonsArray.length <= 3) {
        const buttonTemplateData = {
            recipient: { id: rawId },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: bodyText.length > 630 ? bodyText.substring(0, 630) + '...' : bodyText,
                        buttons: buttonsArray.map(btn => ({
                            type: "postback",
                            title: btn.title.substring(0, 20),
                            payload: btn.id
                        }))
                    }
                }
            }
        };

        try {
            await axios.post(primaryUrl, buttonTemplateData, {
                params: { access_token: token },
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            console.log(`✅ [Meta Button Template Sent] Successfully sent buttons to ${to}`);
            return;
        } catch (err) {
            console.warn(`[Meta Button Template Fallback] Retrying with Quick Replies for ${to}:`, err.response ? err.response.data : err.message);
        }
    }

    // Quick Replies format (for Instagram or fallback)
    const quick_replies = buttonsArray.map((btn) => ({
        content_type: "text",
        title: btn.title.substring(0, 20),
        payload: btn.id
    }));
    const data = {
        recipient: { id: rawId },
        message: {
            text: bodyText,
            quick_replies: quick_replies
        }
    };

    try {
        await axios.post(primaryUrl, data, {
            params: { access_token: token },
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        console.log(`✅ [Meta QuickReplies Sent] Successfully sent buttons to ${to}`);
    } catch (error) {
        try {
            await axios.post(secondaryUrl, data, {
                params: { access_token: token },
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            console.log(`✅ [Meta QuickReplies Sent via fallback API] Successfully sent buttons to ${to}`);
        } catch (err2) {
            console.error(`Error sending Meta quick replies to ${to}:`, error.response ? error.response.data : error.message);
        }
    }
}

async function getMetaUserProfile(senderId, platform) {
    const pageToken = (process.env.PAGE_ACCESS_TOKEN || process.env.ACCESS_TOKEN || '').trim().replace(/^["']|["']$/g, '');
    const igToken = (process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || pageToken).trim().replace(/^["']|["']$/g, '');

    if (platform === 'facebook' && pageToken) {
        try {
            const res = await axios.get(`https://graph.facebook.com/v20.0/${senderId}`, {
                params: { fields: 'first_name,last_name,name', access_token: pageToken }
            });
            if (res.data && (res.data.name || res.data.first_name || res.data.last_name)) {
                return res.data.name || `${res.data.first_name || ''} ${res.data.last_name || ''}`.trim();
            }
        } catch (e) {
            console.warn(`[FB Profile Fetch Error] ${senderId}: ${e.message}`);
        }
    } else if (platform === 'instagram') {
        // Try Meta Graph API with Page Token
        if (pageToken) {
            try {
                const res = await axios.get(`https://graph.facebook.com/v20.0/${senderId}`, {
                    params: { fields: 'name,username', access_token: pageToken }
                });
                if (res.data && (res.data.username || res.data.name)) {
                    return res.data.username ? `@${res.data.username}${res.data.name ? ` (${res.data.name})` : ''}` : res.data.name;
                }
            } catch (e) {
                console.warn(`[IG FB-Graph Fetch Failed] ${senderId}: ${e.message}`);
            }
        }

        // Try Instagram API with IG Token
        if (igToken) {
            try {
                const res = await axios.get(`https://graph.instagram.com/v20.0/${senderId}`, {
                    params: { fields: 'username,name', access_token: igToken }
                });
                if (res.data && (res.data.username || res.data.name)) {
                    return res.data.username ? `@${res.data.username}${res.data.name ? ` (${res.data.name})` : ''}` : res.data.name;
                }
            } catch (e) {
                console.warn(`[IG Direct Fetch Failed] ${senderId}: ${e.message}`);
            }
        }
    }
    return null;
}

// --- Send Message Functions ---
async function sendImageMessage(to, imageUrl, caption = '') {
    if (to.startsWith('fb:') || to.startsWith('ig:')) return;
    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN || !imageUrl) return;
    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'image',
                image: { link: imageUrl, caption: caption }
            }
        });
        console.log(`✅ [WhatsApp Image Sent] Sent to ${to}, ID: ${response.data?.messages?.[0]?.id}`);
    } catch (error) {
        console.error("❌ [WhatsApp Image Error]:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

async function sendImageWithButtons(to, imageUrl, bodyText, buttonsArray) {
    if (to.startsWith('fb:') || to.startsWith('ig:')) {
        await sendMetaQuickReplies(to, bodyText, buttonsArray);
        return;
    }

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) return;
    const buttons = buttonsArray.map((btn) => ({
        type: "reply",
        reply: { id: btn.id, title: btn.title.substring(0, 20) }
    }));

    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    header: {
                        type: 'image',
                        image: { link: imageUrl }
                    },
                    body: { text: bodyText },
                    action: { buttons }
                }
            }
        });
        console.log(`✅ [WhatsApp Image+Buttons Sent] Sent to ${to}, ID: ${response.data?.messages?.[0]?.id}`);
    } catch (error) {
        console.warn("⚠️ [Image Header Fallback] Sending image then interactive buttons...");
        await sendImageMessage(to, imageUrl);
        await sendInteractiveButtons(to, bodyText, buttonsArray);
    }
}

async function sendMessage(to, text) {
    if (to.startsWith('fb:') || to.startsWith('ig:')) {
        await sendMetaMessage(to, text);
        return;
    }

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error(`❌ [WhatsApp Send Error] Missing credentials! PHONE_NUMBER_ID: ${Boolean(PHONE_NUMBER_ID)}, ACCESS_TOKEN: ${Boolean(ACCESS_TOKEN)}`);
        return;
    }
    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            data: { messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } }
        });
        console.log(`✅ [WhatsApp Sent] Message sent to ${to}, ID: ${response.data?.messages?.[0]?.id}`);
    } catch (error) {
        console.error("❌ [WhatsApp Send Error]:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

async function sendInteractiveButtons(to, bodyText, buttonsArray) {
    if (to.startsWith('fb:') || to.startsWith('ig:')) {
        await sendMetaQuickReplies(to, bodyText, buttonsArray);
        return;
    }

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error(`❌ [WhatsApp Buttons Error] Missing credentials! PHONE_NUMBER_ID: ${Boolean(PHONE_NUMBER_ID)}, ACCESS_TOKEN: ${Boolean(ACCESS_TOKEN)}`);
        return;
    }
    const buttons = buttonsArray.map((btn) => ({
        type: "reply",
        reply: { id: btn.id, title: btn.title.substring(0, 20) }
    }));

    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'interactive',
                interactive: { type: 'button', body: { text: bodyText }, action: { buttons } }
            }
        });
        console.log(`✅ [WhatsApp Buttons Sent] Sent to ${to}, ID: ${response.data?.messages?.[0]?.id}`);
    } catch (error) {
        console.error("❌ [WhatsApp Buttons Error]:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

async function sendInteractiveList(to, bodyText, buttonText, sections) {
    if (to.startsWith('fb:') || to.startsWith('ig:')) {
        // Flatten all section rows to map list rows to quick reply buttons
        const buttonsArray = [];
        sections.forEach((sec) => {
            if (sec.rows) {
                sec.rows.forEach((row) => {
                    buttonsArray.push({ id: row.id, title: row.title });
                });
            }
        });
        // Limit to Meta's limit of 13 quick replies
        await sendMetaQuickReplies(to, bodyText, buttonsArray.slice(0, 13));
        return;
    }

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error(`❌ [WhatsApp List Error] Missing credentials! PHONE_NUMBER_ID: ${Boolean(PHONE_NUMBER_ID)}, ACCESS_TOKEN: ${Boolean(ACCESS_TOKEN)}`);
        return;
    }
    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'interactive',
                interactive: { 
                    type: 'list', 
                    body: { text: bodyText }, 
                    action: { 
                        button: buttonText.substring(0, 20),
                        sections: sections
                    } 
                }
            }
        });
        console.log(`✅ [WhatsApp List Sent] Sent to ${to}, ID: ${response.data?.messages?.[0]?.id}`);
    } catch (error) {
        console.error("❌ [WhatsApp List Error]:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

// --- Lead Scoring ---
function calculateLeadScore(contact) {
    let score = 0;
    const budget = contact.budget_range;
    if (budget === "Above ₹1 Crore" || budget === "₹50L–₹1Cr") score += 40;
    else if (budget === "₹20–50 Lakhs") score += 25;
    else if (budget === "Under ₹20 Lakhs") score += 10;

    const timeline = contact.project_timeline;
    if (timeline === "Immediately") score += 30;
    else if (timeline === "1–3 months") score += 20;
    else if (timeline === "3–6 months") score += 10;
    else if (timeline === "Just planning") score += 5;

    const service = contact.selected_service;
    if (service === "Godown" || service === "Cold Storage" || service.includes("PEB")) score += 15;

    if (contact.site_location.toLowerCase().includes("tamil nadu") || contact.site_location.toLowerCase().includes("chennai")) score += 10;
    return score;
}

// --- Chatbot Logic ---
async function handleBotReply(phone, messageText, contact) {
    if (contact.is_paused) return; // Human takeover active

    const msg = messageText.toLowerCase().trim();

    // Human Takeover check
    if (msg === "5" || msg === "btn_human" || msg.includes("human") || msg.includes("agent") || msg.includes("talk to someone")) {
        contact.is_paused = true;
        await contact.save();
        await sendMessage(phone, `👋 *Connecting you to our team!*\n\nOur team member will respond to you shortly. In the meantime, you can also reach us directly:\n\n📞 *Call/WhatsApp:* +91 96000 67611\n\n_Average response time: under 30 minutes during working hours (9 AM – 6 PM)_`);
        if (SALES_TEAM_PHONE) {
            await sendMessage(SALES_TEAM_PHONE, `⚠️ *HUMAN ASSISTANCE REQUIRED*\nCustomer: ${contact.name} (${phone})\nNeeds to talk to an agent.`);
        }
        return;
    }

    // --- QUOTE COLLECTION FLOW ---
    if (contact.quote_step === 1) {
        contact.name = messageText;
        contact.quote_step = 2;
        await contact.save();
        await sendMessage(phone, `👤 Thank you, ${contact.name}!\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 2 of 5*\n\n*What is the total area you need for your project?*\n\n_Please type your answer_\n_(Example: 5,000 sq ft · 10,000 sq ft · 1 acre · 2 grounds)_`);
        return;
    }
    
    if (contact.quote_step === 2) {
        contact.area_required = messageText;
        contact.quote_step = 3;
        await contact.save();
        await sendMessage(phone, `✅ Noted!\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 3 of 5*\n\n*Where is your project site located?*\n\n_Please type your answer_\n_(City, district or full address —\nExample: Kanchipuram · Hosur · Ambattur Chennai · Thiruvallur)_`);
        return;
    }

    if (contact.quote_step === 3) {
        contact.site_location = messageText;
        contact.quote_step = 4;
        await contact.save();
        await sendMessage(phone, `📍 Perfect!\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 4 of 5*\n\n*When do you plan to start the project?*\n\n*1️⃣ ⚡ Immediately — within 1 month*\n*2️⃣ 📅 In 1 to 3 months*\n*3️⃣ 🗓️ In 3 to 6 months*\n*4️⃣ 💭 Just planning — no fixed date yet*\n\n_Reply with a number_`);
        return;
    }

    if (contact.quote_step === 4) {
        if (msg === "1") contact.project_timeline = "Immediately";
        else if (msg === "2") contact.project_timeline = "1–3 months";
        else if (msg === "3") contact.project_timeline = "3–6 months";
        else if (msg === "4") contact.project_timeline = "Just planning";
        else contact.project_timeline = messageText;

        contact.quote_step = 5;
        await contact.save();
        await sendMessage(phone, `🗓️ Noted!\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 5 of 5 — Optional*\n\n*What is your approximate project budget?*\n\n*1️⃣ Under ₹20 Lakhs*\n*2️⃣ ₹20 Lakhs – ₹50 Lakhs*\n*3️⃣ ₹50 Lakhs – ₹1 Crore*\n*4️⃣ Above ₹1 Crore*\n*5️⃣ Not sure yet*\n\n_Reply with a number_`);
        return;
    }

    if (contact.quote_step === 5) {
        if (msg === "1") contact.budget_range = "Under ₹20 Lakhs";
        else if (msg === "2") contact.budget_range = "₹20–50 Lakhs";
        else if (msg === "3") contact.budget_range = "₹50L–₹1Cr";
        else if (msg === "4") contact.budget_range = "Above ₹1 Crore";
        else if (msg === "5") contact.budget_range = "Not confirmed yet";
        else contact.budget_range = messageText;

        contact.quote_step = 0;
        contact.lead_score = calculateLeadScore(contact);
        await contact.save();

        const summary = `🎉 *Thank you for your patience, Sir/Madam! (${contact.name})*\n\nWe have received all your details.\nHere is a summary of your requirement:\n\n━━━━━━━━━━━━━━━━━\n👤 *Name:* ${contact.name}\n🔧 *Service:* ${contact.selected_service || "PEB / Construction"}\n📐 *Area Required:* ${contact.area_required}\n📍 *Site Location:* ${contact.site_location}\n📅 *Timeline:* ${contact.project_timeline}\n💰 *Budget:* ${contact.budget_range}\n━━━━━━━━━━━━━━━━━\n\n✅ Your information has been updated to our project team.\n\n📞 You will receive a *personal call back within 2 hours* from our team.\n\n📄 A detailed *estimation quotation* will be prepared and shared with you based on your exact requirements.\n\nThank you for choosing *Deepika Builtech Engineering.* 🏗️\n\nWe look forward to building something great with you. Have a wonderful day! 🙏\n\n_📞 +91 96000 67611_\n_🌐 deepikabuiltech.com_`;
        await sendMessage(phone, summary);

        if (SALES_TEAM_PHONE) {
            const alert = `🔔 *NEW LEAD — Deepika Builtech CRM*\n━━━━━━━━━━━━━━━━━━━━━\n👤 *Name:* ${contact.name}\n📱 *Contact ID:* ${phone}\n🔧 *Service:* ${contact.selected_service || "PEB"}\n📐 *Area:* ${contact.area_required}\n📍 *Location:* ${contact.site_location}\n📅 *Timeline:* ${contact.project_timeline}\n💰 *Budget:* ${contact.budget_range}\n⏰ *Received:* ${new Date().toLocaleString()}\n━━━━━━━━━━━━━━━━━━━━━\n⚡ *ACTION: Call within 2 hours*\n\nLead Score: ${contact.lead_score}`;
            await sendMessage(SALES_TEAM_PHONE, alert);
        }

        if (GOOGLE_SHEETS_WEBHOOK) {
            axios.post(GOOGLE_SHEETS_WEBHOOK, {
                Timestamp: new Date().toISOString(), CustomerName: contact.name, WhatsAppNumber: phone,
                ServiceSelected: contact.selected_service, AreaRequired: contact.area_required, SiteLocation: contact.site_location,
                Timeline: contact.project_timeline, BudgetRange: contact.budget_range, LeadScore: contact.lead_score, LeadStatus: contact.lead_status
            }).catch(e => console.error("Webhook error"));
        }

        // Push lead to Deepika CRM Supabase backend
        axios.post(process.env.CRM_LEAD_WEBHOOK || 'https://deepika-builtech-crm-4jj1.onrender.com/api/webhooks/whatsapp-bot-lead', {
            CustomerName: contact.name,
            WhatsAppNumber: phone,
            ServiceSelected: contact.selected_service,
            AreaRequired: contact.area_required,
            SiteLocation: contact.site_location,
            Timeline: contact.project_timeline,
            BudgetRange: contact.budget_range,
            LeadScore: contact.lead_score,
            LeadStatus: contact.lead_status || 'New'
        })
        .then(() => console.log(`[CRM Sync] Lead successfully synced to CRM for ${contact.name}`))
        .catch(err => console.error(`[CRM Sync Error] Failed to push lead to CRM:`, err.message));

        return;
    }

    // --- MAIN MENUS ---
    const isWelcome = msg.includes("hi") || msg.includes("hello") || msg.includes("hey") || msg.includes("start") || msg.includes("hai") || msg.includes("vanakkam") || contact.messageCount === 1;

    if (isWelcome) {
        const welcomeText = `👋 Welcome to Mansara Foods!

We're happy to serve you.

Please choose an option below:

1️⃣ Shop Products
2️⃣ Orders
3️⃣ Business (Dealers & Bulk Orders)
4️⃣ Help & Support`;

        const imageUrl = process.env.WELCOME_IMAGE_URL || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800';

        await sendImageWithButtons(phone, imageUrl, welcomeText, [
            { id: "btn_shop", title: "1 - Shop Products" },
            { id: "btn_orders", title: "2 - Orders" },
            { id: "btn_business", title: "3 - Business" }
        ]);
        return;
    }

    // Option 1: Shop Products
    if (msg === "btn_shop" || msg === "1" || msg.includes("shop") || msg.includes("product")) {
        await sendInteractiveButtons(phone, `🛍️ *Mansara Foods — Shop Products*\n\nExplore our wide range of authentic products:\n\n1️⃣ 🌾 Traditional Rice & Grains\n2️⃣ 🌶️ Authentic Spices & Masalas\n3️⃣ 🍿 Healthy Snacks & Savouries\n4️⃣ 🍯 Pure Honey, Ghee & Oils\n\nReply with a number or select an option below:`, [
            { id: "btn_orders", title: "2 - Orders" },
            { id: "btn_business", title: "3 - Business" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }

    // Option 2: Orders
    if (msg === "btn_orders" || msg === "2" || msg.includes("order")) {
        await sendInteractiveButtons(phone, `📦 *Mansara Foods — Orders & Tracking*\n\nHow can we help with your order?\n\n1️⃣ Track Existing Order\n2️⃣ Cancel / Modify Order\n3️⃣ Shipping & Delivery Info\n\nPlease reply with your Order ID or select an option below:`, [
            { id: "btn_shop", title: "1 - Shop Products" },
            { id: "btn_business", title: "3 - Business" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }

    // Option 3: Business (Dealers & Bulk Orders)
    if (msg === "btn_business" || msg === "3" || msg.includes("business") || msg.includes("dealer") || msg.includes("bulk")) {
        await sendInteractiveButtons(phone, `🏢 *Mansara Foods — Business & Bulk Orders*\n\nPartner with Mansara Foods!\n\n✅ Wholesale Pricing\n✅ Distributorship & Dealership\n✅ Direct Factory Supply & Exports\n\n📞 *Call Business Desk:* +91 96000 67611\n📧 *Email:* business@mansarafoods.com\n\nPlease reply with your Name & Business Location:`, [
            { id: "btn_shop", title: "1 - Shop Products" },
            { id: "btn_orders", title: "2 - Orders" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }

    // Option 4: Help & Support
    if (msg === "btn_support" || msg === "4" || msg.includes("help") || msg.includes("support")) {
        contact.is_paused = true;
        await contact.save();
        await sendInteractiveButtons(phone, `💬 *Mansara Foods — Help & Support*\n\nOur team is happy to assist you! 🙏\n\n📞 *Call/WhatsApp:* +91 96000 67611\n📧 *Email:* support@mansarafoods.com\n⏰ *Working Hours:* Mon – Sat (9 AM – 6 PM)\n\nAn agent will respond to you shortly!`, [
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }

    // Main Menu
    if (msg === "btn_menu" || msg.includes("main menu") || msg.includes("back")) {
        const welcomeText = `👋 Welcome to Mansara Foods!

We're happy to serve you.

Please choose an option below:

1️⃣ Shop Products
2️⃣ Orders
3️⃣ Business (Dealers & Bulk Orders)
4️⃣ Help & Support`;

        await sendInteractiveButtons(phone, welcomeText, [
            { id: "btn_shop", title: "1 - Shop Products" },
            { id: "btn_orders", title: "2 - Orders" },
            { id: "btn_business", title: "3 - Business" }
        ]);
        return;
    }

    // Fallback
    const welcomeText = `👋 Welcome to Mansara Foods!

We're happy to serve you.

Please choose an option below:

1️⃣ Shop Products
2️⃣ Orders
3️⃣ Business (Dealers & Bulk Orders)
4️⃣ Help & Support`;

    await sendInteractiveButtons(phone, welcomeText, [
        { id: "btn_shop", title: "1 - Shop Products" },
        { id: "btn_orders", title: "2 - Orders" },
        { id: "btn_business", title: "3 - Business" }
    ]);
}

// --- Cron Jobs for Automated Follow-ups ---
// Run every day at 10:00 AM IST
cron.schedule('0 10 * * *', async () => {
    console.log("Running Daily Follow-up Cron Job...");
    const now = new Date();
    
    // Day 3 Follow-up
    const threeDaysAgo = new Date(now.getTime() - (72 * 60 * 60 * 1000));
    const day3Contacts = await Contact.find({ 
        lead_status: "New", 
        lastSeen: { $lt: threeDaysAgo },
        quote_step: 0,
        messageCount: { $gt: 1 } 
    });

    for (const contact of day3Contacts) {
        await sendMessage(contact.phone, `👋 *Hello from Deepika Builtech Engineering!*\n\nWe noticed you enquired with us a couple of days ago regarding ${contact.selected_service || 'our services'}.\n\nWe want to make sure you received our best attention. 🙏\n\nOur team is ready to assist you with a free site consultation and detailed quotation.\n\nShall we arrange a call at your convenient time?\n\n*1️⃣ Yes — Call me today*\n*2️⃣ Tomorrow is better*\n*3️⃣ I'll get back to you later*`);
    }

    // Note: Day 7 review request requires lead_status to be "Handover Complete" which would be set via the CRM dashboard.
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const completedContacts = await Contact.find({
        lead_status: "Handover Complete",
        lastSeen: { $lt: sevenDaysAgo }
    });

    for (const contact of completedContacts) {
        await sendMessage(contact.phone, `🏗️ *Project Complete — Thank You!*\n\nIt was our honour to build your project in ${contact.site_location || 'your location'}.\n\nWe hope everything is perfect and meeting your expectations. 🙏\n\nYour feedback means everything to us and helps other businesses like yours find the right construction partner.\n\n*Could you spare 1 minute to leave us a Google Review?* ⭐⭐⭐⭐⭐\n\n👉 [Google Review Link]\n\nThank you for trusting Deepika Builtech Engineering. We look forward to serving you again! 🏆`);
        // Mark as reviewed so we don't spam them
        contact.lead_status = "Review Requested";
        await contact.save();
    }
}, { timezone: "Asia/Kolkata" });

// --- Webhook Endpoints ---
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) res.status(200).send(challenge);
    else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    const body = req.body;
    console.log(`📩 [Webhook Event Received] Object: ${body && body.object}`);

    // 1. WhatsApp Webhook Entry
    if (body.object === 'whatsapp_business_account' && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
        const webhook_event = body.entry[0].changes[0].value;
        const message = webhook_event.messages[0];
        const contactInfo = webhook_event.contacts && webhook_event.contacts[0] ? webhook_event.contacts[0] : null;
        
        let messageText = '';
        if (message.type === 'text') messageText = message.text.body;
        else if (message.type === 'interactive') {
            if (message.interactive.button_reply) messageText = message.interactive.button_reply.id;
            else if (message.interactive.list_reply) messageText = message.interactive.list_reply.id;
        }

        if (messageText) {
            const phone = message.from;
            const name = contactInfo && contactInfo.profile ? contactInfo.profile.name : '';
            
            // Sync enquiry immediately with Deepika CRM
            axios.post(process.env.CRM_ENQUIRY_WEBHOOK || 'https://deepika-builtech-crm-4jj1.onrender.com/api/webhooks/whatsapp-bot-enquiry', {
                CustomerName: name || phone,
                WhatsAppNumber: phone,
                MessageText: message.type === 'text' ? message.text.body : `Selection: ${messageText}`,
                SourceChannel: 'WhatsApp'
            })
            .then(() => console.log(`[CRM Enquiry Sync] Message synced to CRM for ${phone}`))
            .catch(e => console.error("[CRM Enquiry Sync Error]:", e.message));

            try {
                let contact = await Contact.findOne({ phone });
                const now = new Date();
                if (!contact) {
                    contact = new Contact({ phone, name: name || phone, firstSeen: now, lastSeen: now, messageCount: 1, messages: [{ text: messageText, time: now }] });
                } else {
                    contact.lastSeen = now;
                    contact.messageCount += 1;
                    if (name) contact.name = name;
                    contact.messages.push({ text: messageText, time: now });
                }
                await contact.save();
                await handleBotReply(phone, messageText, contact);
            } catch(e) {
                console.error("DB Error processing webhook:", e);
            }
        }
    }

    // 2. Facebook Messenger / Instagram DM Webhook Entry
    if ((body.object === 'page' || body.object === 'instagram') && Array.isArray(body.entry)) {
        const platform = body.object === 'page' ? 'facebook' : 'instagram';

        for (const entry of body.entry) {
            // Build unified list of messaging events (from entry.messaging, entry.standby, or entry.changes)
            const messagingList = [];
            if (entry.messaging && Array.isArray(entry.messaging)) {
                messagingList.push(...entry.messaging);
            }
            if (entry.standby && Array.isArray(entry.standby)) {
                messagingList.push(...entry.standby);
            }
            if (entry.changes && Array.isArray(entry.changes)) {
                for (const change of entry.changes) {
                    if (change.field === 'messages' && change.value) {
                        messagingList.push(change.value);
                    }
                }
            }

            for (const messaging of messagingList) {
                // Ignore echoes (messages sent by Page or IG account itself)
                if (messaging.message && messaging.message.is_echo) continue;

                const senderId = (messaging.sender && messaging.sender.id) || (messaging.from && (messaging.from.id || messaging.from));
                if (!senderId) continue;

                let messageText = '';
                if (messaging.postback && messaging.postback.payload) {
                    messageText = messaging.postback.payload;
                } else if (messaging.postback && messaging.postback.title) {
                    messageText = messaging.postback.title;
                } else if (messaging.message && messaging.message.quick_reply) {
                    messageText = messaging.message.quick_reply.payload;
                } else if (messaging.message && messaging.message.text) {
                    messageText = messaging.message.text;
                } else if (messaging.text) {
                    messageText = messaging.text;
                }

                if (!messageText) continue;

                const unifiedPhoneId = platform === 'facebook' ? `fb:${senderId}` : `ig:${senderId}`;
                console.log(`💬 [Meta DM Received] Platform: ${platform}, Sender: ${senderId}, Text: "${messageText}"`);

                try {
                    let contact = await Contact.findOne({ phone: unifiedPhoneId });
                    const now = new Date();
                    if (!contact) {
                        const profileName = await getMetaUserProfile(senderId, platform);
                        const fallbackName = platform === 'facebook' ? `Facebook User (${senderId.slice(-6)})` : `Instagram User (${senderId.slice(-6)})`;
                        const displayName = profileName || fallbackName;
                        contact = new Contact({ 
                            phone: unifiedPhoneId, 
                            name: displayName, 
                            firstSeen: now, 
                            lastSeen: now, 
                            messageCount: 1, 
                            messages: [{ text: messageText, time: now }] 
                        });
                    } else {
                        contact.lastSeen = now;
                        contact.messageCount += 1;
                        if (!contact.name || contact.name.includes('Lead') || contact.name.includes('Customer') || contact.name.startsWith('ig:') || contact.name.startsWith('fb:')) {
                            const updatedProfile = await getMetaUserProfile(senderId, platform);
                            if (updatedProfile) contact.name = updatedProfile;
                        }
                        contact.messages.push({ text: messageText, time: now });
                    }
                    await contact.save();

                    // Sync enquiry immediately with Deepika CRM
                    axios.post(process.env.CRM_ENQUIRY_WEBHOOK || 'https://deepika-builtech-crm-4jj1.onrender.com/api/webhooks/whatsapp-bot-enquiry', {
                        CustomerName: contact.name,
                        WhatsAppNumber: unifiedPhoneId,
                        MessageText: (messaging.message && messaging.message.quick_reply) || messaging.postback ? `Selection: ${messageText}` : messageText,
                        SourceChannel: platform === 'facebook' ? 'Facebook Messenger' : 'Instagram Direct'
                    })
                    .then(() => console.log(`[CRM Enquiry Sync] Message synced to CRM for ${unifiedPhoneId}`))
                    .catch(e => console.error("[CRM Enquiry Sync Error]:", e.message));

                    await handleBotReply(unifiedPhoneId, messageText, contact);
                } catch (e) {
                    console.error("DB Error processing Meta webhook:", e);
                }
            }
        }
    }
});

// --- Dashboard API Endpoints ---
app.get('/crm', async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ lastSeen: -1 });
        res.json({ totalContacts: contacts.length, contacts });
    } catch (err) { res.status(500).json({ error: "Failed to fetch contacts" }); }
});

app.get('/crm/:phone', async (req, res) => {
    try {
        const contact = await Contact.findOne({ phone: req.params.phone });
        if (contact) res.json(contact);
        else res.status(404).json({ error: "Contact not found" });
    } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.delete('/crm/:phone', async (req, res) => {
    try {
        const result = await Contact.deleteOne({ phone: req.params.phone });
        if (result.deletedCount > 0) res.json({ success: true });
        else res.status(404).json({ error: "Contact not found" });
    } catch (err) { res.status(500).json({ error: "Failed to delete" }); }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
