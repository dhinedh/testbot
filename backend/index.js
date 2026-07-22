require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors({ origin: 'https://testbot-gray-rho.vercel.app' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsapp-crm';
const SALES_TEAM_PHONE = process.env.SALES_TEAM_PHONE || '';
const GOOGLE_SHEETS_WEBHOOK = process.env.GOOGLE_SHEETS_WEBHOOK || '';

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
    if (!INSTAGRAM_ACCESS_TOKEN) {
        console.warn('⚠️ Missing Instagram / Meta Access Token');
        return;
    }
    const rawId = to.replace(/^(fb:|ig:)/, '');
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/me/messages`,
            params: { access_token: INSTAGRAM_ACCESS_TOKEN },
            headers: { 'Content-Type': 'application/json' },
            data: {
                recipient: { id: rawId },
                message: { text: text }
            }
        });
    } catch (error) {
        console.error(`Error sending Meta message to ${to}:`, error.response ? error.response.data : error.message);
    }
}

async function sendMetaQuickReplies(to, bodyText, buttonsArray) {
    if (!INSTAGRAM_ACCESS_TOKEN) {
        console.warn('⚠️ Missing Instagram / Meta Access Token');
        return;
    }
    const rawId = to.replace(/^(fb:|ig:)/, '');
    const quick_replies = buttonsArray.map((btn) => ({
        content_type: "text",
        title: btn.title.substring(0, 20),
        payload: btn.id
    }));

    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/me/messages`,
            params: { access_token: INSTAGRAM_ACCESS_TOKEN },
            headers: { 'Content-Type': 'application/json' },
            data: {
                recipient: { id: rawId },
                message: {
                    text: bodyText,
                    quick_replies: quick_replies
                }
            }
        });
    } catch (error) {
        console.error(`Error sending Meta quick replies to ${to}:`, error.response ? error.response.data : error.message);
    }
}

async function getMetaUserProfile(senderId, platform) {
    if (!INSTAGRAM_ACCESS_TOKEN) return null;
    try {
        if (platform === 'facebook') {
            const res = await axios.get(`https://graph.facebook.com/v20.0/${senderId}`, {
                params: {
                    fields: 'first_name,last_name',
                    access_token: INSTAGRAM_ACCESS_TOKEN
                }
            });
            if (res.data && (res.data.first_name || res.data.last_name)) {
                return `${res.data.first_name || ''} ${res.data.last_name || ''}`.trim();
            }
        } else if (platform === 'instagram') {
            const res = await axios.get(`https://graph.facebook.com/v20.0/${senderId}`, {
                params: {
                    fields: 'username,name',
                    access_token: INSTAGRAM_ACCESS_TOKEN
                }
            });
            if (res.data) {
                return res.data.name || res.data.username || null;
            }
        }
    } catch (err) {
        console.warn(`[Meta Profile Fetch Failed] senderId: ${senderId}, platform: ${platform}, error: ${err.message}`);
    }
    return null;
}

// --- Send Message Functions ---
async function sendMessage(to, text) {
    if (to.startsWith('fb:') || to.startsWith('ig:')) {
        await sendMetaMessage(to, text);
        return;
    }

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) return;
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            data: { messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } }
        });
    } catch (error) {
        console.error("Error sending message:", error.response ? error.response.data : error.message);
    }
}

async function sendInteractiveButtons(to, bodyText, buttonsArray) {
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
        await axios({
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
    } catch (error) {
        console.error("Error sending buttons:", error.response ? error.response.data : error.message);
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

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) return;
    try {
        await axios({
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
    } catch (error) {
        console.error("Error sending list:", error.response ? error.response.data : error.message);
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
        contact.area_required = messageText;
        contact.quote_step = 2;
        await contact.save();
        await sendMessage(phone, `✅ Thank you!\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 2 of 4*\n\n*Where is your project site located?*\n\n_Please type your answer_\n_(City, district or full address —\nExample: Kanchipuram · Hosur · Ambattur Chennai · Thiruvallur)_`);
        return;
    }
    
    if (contact.quote_step === 2) {
        contact.site_location = messageText;
        contact.quote_step = 3;
        await contact.save();
        await sendMessage(phone, `📍 Perfect!\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 3 of 4*\n\n*When do you plan to start the project?*\n\n*1️⃣ ⚡ Immediately — within 1 month*\n*2️⃣ 📅 In 1 to 3 months*\n*3️⃣ 🗓️ In 3 to 6 months*\n*4️⃣ 💭 Just planning — no fixed date yet*\n\n_Reply with a number_`);
        return;
    }

    if (contact.quote_step === 3) {
        if (msg === "1") contact.project_timeline = "Immediately";
        else if (msg === "2") contact.project_timeline = "1–3 months";
        else if (msg === "3") contact.project_timeline = "3–6 months";
        else if (msg === "4") contact.project_timeline = "Just planning";
        else contact.project_timeline = messageText;

        contact.quote_step = 4;
        await contact.save();
        await sendMessage(phone, `🗓️ Noted!\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 4 of 4 — Optional*\n\n*What is your approximate project budget?*\n\n*1️⃣ Under ₹20 Lakhs*\n*2️⃣ ₹20 Lakhs – ₹50 Lakhs*\n*3️⃣ ₹50 Lakhs – ₹1 Crore*\n*4️⃣ Above ₹1 Crore*\n*5️⃣ Not sure yet*\n\n_Reply with a number_`);
        return;
    }

    if (contact.quote_step === 4) {
        if (msg === "1") contact.budget_range = "Under ₹20 Lakhs";
        else if (msg === "2") contact.budget_range = "₹20–50 Lakhs";
        else if (msg === "3") contact.budget_range = "₹50L–₹1Cr";
        else if (msg === "4") contact.budget_range = "Above ₹1 Crore";
        else if (msg === "5") contact.budget_range = "Not confirmed yet";
        else contact.budget_range = messageText;

        contact.quote_step = 0;
        contact.lead_score = calculateLeadScore(contact);
        await contact.save();

        const summary = `🎉 *Thank you for your patience, Sir/Madam!*\n\nWe have received all your details.\nHere is a summary of your requirement:\n\n━━━━━━━━━━━━━━━━━\n🔧 *Service:* ${contact.selected_service || "PEB / Construction"}\n📐 *Area Required:* ${contact.area_required}\n📍 *Site Location:* ${contact.site_location}\n📅 *Timeline:* ${contact.project_timeline}\n💰 *Budget:* ${contact.budget_range}\n━━━━━━━━━━━━━━━━━\n\n✅ Your information has been updated to our project team.\n\n📞 You will receive a *personal call back within 2 hours* from our team.\n\n📄 A detailed *estimation quotation* will be prepared and shared with you based on your exact requirements.\n\nThank you for choosing *Deepika Builtech Engineering.* 🏗️\n\nWe look forward to building something great with you. Have a wonderful day! 🙏\n\n_📞 +91 96000 67611_\n_🌐 deepikabuiltech.com_`;
        await sendMessage(phone, summary);

        if (SALES_TEAM_PHONE) {
            const alert = `🔔 *NEW LEAD — Deepika Builtech CRM*\n━━━━━━━━━━━━━━━━━━━━━\n👤 *Name:* ${contact.name}\n📱 *WhatsApp:* ${phone}\n🔧 *Service:* ${contact.selected_service || "PEB"}\n📐 *Area:* ${contact.area_required}\n📍 *Location:* ${contact.site_location}\n📅 *Timeline:* ${contact.project_timeline}\n💰 *Budget:* ${contact.budget_range}\n⏰ *Received:* ${new Date().toLocaleString()}\n━━━━━━━━━━━━━━━━━━━━━\n⚡ *ACTION: Call within 2 hours*\n\nLead Score: ${contact.lead_score}`;
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
        axios.post(process.env.CRM_LEAD_WEBHOOK || 'http://localhost:5000/api/webhooks/whatsapp-bot-lead', {
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
        await sendInteractiveButtons(phone, `🏗️ *Welcome to Deepika Builtech Engineering!*\n\nTamil Nadu's most trusted Pre-Engineered Building specialists — based in Chennai.\n\n🏆 Excellence Award 2025\n✅ 10+ Years of Experience  \n✅ 150+ Projects Delivered  \n✅ 100+ Happy Clients  \n✅ 3 Manufacturing Units in Tamil Nadu\n\nPlease select an option:\n\n*1️⃣ About Us*\n*2️⃣ Our Services*\n*3️⃣ Get a Free Quote*\n*4️⃣ Contact & Locations*\n\n_Reply with a number or tap a button_ 😊`, [
            { id: "btn_about", title: "1 - About Us" },
            { id: "btn_services", title: "2 - Services" },
            { id: "btn_quote", title: "3 - Free Quote" }
        ]);
        return;
    }

    if (msg === "btn_about" || msg === "1" || msg.includes("about")) {
        await sendInteractiveButtons(phone, `🏢 *About Deepika Builtech Engineering*\n\nWe are a leading Pre-Engineered Building (PEB) construction company headquartered in Ambattur, Chennai — with 10+ years of trusted service across Tamil Nadu.\n\n🏭 *What We Build:*\nWe design, fabricate and erect high-quality PEB structures, warehouses, cold storages, mezzanine floors, industrial sheds and godowns — completely under one roof.\n\n📍 *Our 3 Locations:*\n- Head Office — Ambattur, Chennai\n- Unit I — Kanchipuram District  \n- Unit II — Thirumullaivoyal, Thiruvallur\n\n🏆 *Why 100+ Clients Choose Us:*\n✅ In-house manufacturing — no middlemen\n✅ On-time delivery — every single project\n✅ Transparent pricing — zero hidden costs\n✅ CNC precision steel fabrication\n✅ End-to-end project management\n✅ Excellence Award 2025 winner\n\nWhat would you like to do next?\n\n*1️⃣ View Our Services*\n*2️⃣ Get a Free Quote*\n*3️⃣ Back to Main Menu*`, [
            { id: "btn_services", title: "View Services" },
            { id: "btn_quote", title: "Get Free Quote" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }

    if (msg === "btn_services" || msg === "2" || msg.includes("service") || msg === "view services") {
        const sections = [
            {
                title: "Construction Services",
                rows: [
                    { id: "srv_peb", title: "🏗️ PEB Structure", description: "Pre-Engineered Buildings" },
                    { id: "srv_mezzanine", title: "📦 Mezzanine Floor", description: "Custom space expansion" },
                    { id: "srv_cold", title: "❄️ Cold Storage", description: "Insulated facilities" },
                    { id: "srv_shed", title: "🏚️ Shed Fabrication", description: "Industrial sheds" },
                    { id: "srv_godown", title: "🏭 Godown Construction", description: "Large warehouses" },
                    { id: "srv_civil", title: "🧱 Civil Construction", description: "Foundation & RC works" }
                ]
            },
            {
                title: "Actions",
                rows: [
                    { id: "btn_quote", title: "📋 Get a Free Quote" },
                    { id: "btn_menu", title: "🏠 Main Menu" }
                ]
            }
        ];

        await sendInteractiveList(
            phone, 
            `🔧 *Our Services*\n\nWe specialise in the following construction services across Tamil Nadu.\n\nTap the button below to view and select a service:`, 
            "View Services", 
            sections
        );
        return;
    }

    if (msg === "4" || msg.includes("contact") || msg.includes("location") || msg.includes("address")) {
        await sendInteractiveButtons(phone, `📞 *Contact Deepika Builtech Engineering*\n\n*📱 Call or WhatsApp:*\n+91 96000 67611\n+91 98844 87938\n\n*📧 Email:*\ndbtechengg@gmail.com\n\n*🌐 Website:*\ndeepikabuiltech.com\n\n*📍 Our 3 Locations:*\n\n*Head Office — Chennai:*\nSIDCO Industrial Estate\nAmbattur, Chennai — 600098\n\n*Unit I — Kanchipuram:*\nRajakulam Road\nKanchipuram District — 631561\n\n*Unit II — Thiruvallur:*\nSIDCO Industrial Estate\nThirumullaivoyal — 600062\n\n*🕐 Working Hours:*\nMonday – Saturday: 9 AM – 6 PM\n\nWhat would you like to do?`, [
            { id: "btn_quote", title: "Get Free Quote 📋" },
            { id: "btn_services", title: "View Services 🔧" },
            { id: "btn_menu", title: "Main Menu 🏠" }
        ]);
        return;
    }

    // Services Selection (1 to 6 from services menu)
    if (msg === "srv_peb" || msg.includes("peb")) {
        contact.selected_service = "PEB Structure"; await contact.save();
        await sendInteractiveButtons(phone, `🏗️ *Pre-Engineered Buildings (PEB)*\n\nThe fastest, strongest, and most cost-effective way to build your factory, warehouse, or industrial facility.\n\n💡 *Why Choose PEB Over RCC?*\n✅ 30–40% cheaper than RCC construction\n✅ Built and ready in just 30–45 days\n✅ Earthquake and cyclone resistant\n✅ Fully customisable — any span, height or layout\n✅ Low maintenance — long-lasting galvanised steel\n✅ Future-ready — easily expandable\n\n🏭 *Best Suited For:*\nFactories · Warehouses · Industrial Sheds · Distribution Centres · Manufacturing Plants · Steel Buildings\n\n📌 We handle everything:\nDesign → Fabrication → Transport → Erection → Handover\n\nInterested in a free estimate?`, [
            { id: "btn_quote", title: "Yes-Get Free Quote" },
            { id: "btn_services", title: "Back to Services" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }
    if (msg === "srv_mezzanine" || msg.includes("mezzanine")) {
        contact.selected_service = "Mezzanine Floor"; await contact.save();
        await sendInteractiveButtons(phone, `📦 *Mezzanine Floor Construction*\n\nMaximise your existing space without building a new facility. A mezzanine floor doubles your usable area at a fraction of the cost.\n\n✅ Custom designed for your exact space\n✅ Heavy load-bearing structural capacity\n✅ Safe staircase and handrail included\n✅ Quick installation with minimal disruption\n✅ Perfect for storage, offices or production\n\n💡 *Did You Know?*\nA well-designed mezzanine can give you 70–80% extra usable space within your existing building!\n\nInterested in a free estimate?`, [
            { id: "btn_quote", title: "Yes-Get Free Quote" },
            { id: "btn_services", title: "Back to Services" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }
    if (msg === "srv_cold" || msg.includes("cold") || msg.includes("storage")) {
        contact.selected_service = "Cold Storage"; await contact.save();
        await sendInteractiveButtons(phone, `❄️ *Cold Storage Construction*\n\nWe design and build insulated cold storage facilities engineered for precise temperature control and maximum energy efficiency.\n\n✅ PUF panel insulated walls, floors and ceiling\n✅ Single and multi-temperature chamber options\n✅ Blast freezer and chilling room combinations\n✅ Designed for FSSAI and food safety compliance\n✅ Integrated refrigeration system support\n✅ Anti-condensation and drainage systems\n\n🏭 *Best For:*\nFood Processing · Pharmaceuticals · Dairy · Seafood · Agriculture · Vegetables and Fruits\n\nInterested in a free estimate?`, [
            { id: "btn_quote", title: "Yes-Get Free Quote" },
            { id: "btn_services", title: "Back to Services" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }
    if (msg === "srv_shed" || msg.includes("shed")) {
        contact.selected_service = "Shed Fabrication"; await contact.save();
        await sendInteractiveButtons(phone, `🏚️ *Shed Fabrication*\n\nWe fabricate and erect high-quality industrial sheds for workshops, storage, vehicle parking, and light manufacturing operations.\n\n✅ MS and galvanised steel fabrication\n✅ Custom size and height options\n✅ Fast erection — minimal site time\n✅ Roofing sheet options — GI, colour coated\n✅ Side cladding and ventilation included\n✅ Strong and durable — built to last 25+ years\n\n💡 *Ideal for:*\nVehicle Sheds · Tool Rooms · Small Workshops · Agricultural Storage · Pump Houses\n\nInterested in a free estimate?`, [
            { id: "btn_quote", title: "Yes-Get Free Quote" },
            { id: "btn_services", title: "Back to Services" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }
    if (msg === "srv_godown" || msg.includes("godown")) {
        contact.selected_service = "Godown Construction"; await contact.save();
        await sendInteractiveButtons(phone, `🏭 *Godown Construction*\n\nWe build robust, large-span godowns and warehouses for commercial and industrial storage operations across Tamil Nadu.\n\n✅ Clear span up to 60+ metres — no interior columns\n✅ High-bay storage compatible design\n✅ Natural ventilation and lighting options\n✅ Dock levellers and loading bay options\n✅ Fire safety and sprinkler ready\n✅ Completed in 45–60 days\n\n💡 *Perfect For:*\nFMCG Storage · Logistics Hubs · Raw Material Storage · Finished Goods · E-Commerce Fulfilment Centres\n\nInterested in a free estimate?`, [
            { id: "btn_quote", title: "Yes-Get Free Quote" },
            { id: "btn_services", title: "Back to Services" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }
    if (msg === "srv_civil" || msg.includes("civil")) {
        contact.selected_service = "Civil Construction"; await contact.save();
        await sendInteractiveButtons(phone, `🧱 *Civil Construction*\n\nWe provide complete civil construction services alongside our PEB and steel fabrication work — giving you one trusted contractor for your entire project.\n\n✅ Foundation and footing works\n✅ RCC column and slab construction\n✅ Compound wall and boundary wall\n✅ Office block and admin building\n✅ Toilet block and utility construction\n✅ Flooring — plain cement and epoxy\n\n💡 *Advantage:*\nWhen you combine our civil and PEB services, you get seamless coordination, single-point accountability, and significant cost savings.\n\nInterested in a free estimate?`, [
            { id: "btn_quote", title: "Yes-Get Free Quote" },
            { id: "btn_services", title: "Back to Services" },
            { id: "btn_menu", title: "Main Menu" }
        ]);
        return;
    }

    // Trigger Quote Flow (from "3" in main menu, or "Get Free Quote" button)
    if (msg === "btn_quote" || msg === "3" || msg.includes("quote") || msg.includes("yes")) {
        contact.quote_step = 1;
        if (!contact.selected_service) contact.selected_service = "PEB / General Enquiry";
        await contact.save();
        await sendMessage(phone, `📋 *Let's get your FREE project estimate!*\n\nThis will take less than 2 minutes. 🕐\n\nOur expert team will prepare a detailed quotation based on your requirements.\n\n━━━━━━━━━━━━━━━━━\n❓ *Question 1 of 4*\n\n*What is the total area you need for your project?*\n\n_Please type your answer_\n_(Example: 5,000 sq ft · 10,000 sq ft · 1 acre · 2 grounds)_`);
        return;
    }

    if (msg === "btn_menu" || msg.includes("main menu") || msg.includes("back to")) {
        await sendInteractiveButtons(phone, `Main Menu`, [
            { id: "btn_about", title: "1 - About Us" },
            { id: "btn_services", title: "2 - Services" },
            { id: "btn_quote", title: "3 - Free Quote" }
        ]);
        return;
    }

    // Fallback
    await sendInteractiveButtons(phone, `😊 *Thank you for your message!*\n\nI didn't quite understand that. Let me show you our main menu so I can help you better.\n\n*1️⃣ About Us*\n*2️⃣ Our Services*\n*3️⃣ Get a Free Quote*\n*4️⃣ Contact & Locations*\n*5️⃣ 💬 Talk to a Human*\n\n_Reply with a number or tap a button_ 👇`, [
        { id: "btn_menu", title: "Main Menu" },
        { id: "btn_quote", title: "Get Free Quote" },
        { id: "btn_human", title: "Talk to Human" }
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
            axios.post(process.env.CRM_ENQUIRY_WEBHOOK || 'http://localhost:5000/api/webhooks/whatsapp-bot-enquiry', {
                CustomerName: name || phone,
                WhatsAppNumber: phone,
                MessageText: message.type === 'text' ? message.text.body : `Selection: ${messageText}`
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
                        const displayName = profileName || (platform === 'facebook' ? `Facebook Lead (${senderId.slice(-4)})` : `Instagram Lead (${senderId.slice(-4)})`);
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
                        contact.messages.push({ text: messageText, time: now });
                    }
                    await contact.save();

                    // Sync enquiry immediately with Deepika CRM
                    axios.post(process.env.CRM_ENQUIRY_WEBHOOK || 'http://localhost:5000/api/webhooks/whatsapp-bot-enquiry', {
                        CustomerName: contact.name,
                        WhatsAppNumber: unifiedPhoneId,
                        MessageText: (messaging.message && messaging.message.quick_reply) || messaging.postback ? `Selection: ${messageText}` : messageText
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
