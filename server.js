import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const app = express();

const PORT = process.env.PORT || 5000;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY || '';
const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET environment variable is not set. Set it in your .env file.');
  process.exit(1);
}
const AUTH_USERNAME = process.env.AUTH_USERNAME || '';
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || '';


app.use(cors());
app.use(express.json());

// JWT auth middleware
function authenticateJWT(req, res, next) {
  if (req.path === '/login' || req.path === '/health') return next(); // Allow login route
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

app.use(authenticateJWT);

// Login route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username !== AUTH_USERNAME) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, AUTH_PASSWORD_HASH);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

app.post('/translate', async (req, res) => {
  const { text, source_lang, target_lang } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }
  if (!source_lang) {
    return res.status(400).json({ error: 'source_lang is required' });
  }
  if (!target_lang) {
    return res.status(400).json({ error: 'target_lang is required' });
  }
  try {
    const params = new URLSearchParams();
    params.append('text', text);
    params.append('source_lang', source_lang);
    params.append('target_lang', target_lang);
    console.log(params);
    const deeplRes = await fetch(DEEPL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    const data = await deeplRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DRY: Shared function to sync to Anki
async function syncToAnki() {
  const url = "http://localhost:8765";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: 'sync',
      version: 6,
    })
  });
  return response.json();
}

app.post('/sync-anki', async (req, res) => {
  console.log("POST to /sync-anki");
  try {
    const syncResult = await syncToAnki();
    res.json(syncResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/add-card', async (req, res) => {
  console.log("POST to /add-card");
  console.log(req.body);

  try {
    const { frontContent, backContent } = req.body;

    // Input validation
    if (!frontContent) {
      return res.status(400).json({ error: 'frontContent is required' });
    }
    if (!backContent) {
      return res.status(400).json({ error: 'backContent is required' });
    }

    const note = {
      deckName: "Ankify",
      modelName: "Basic",
      fields: {
        Front: frontContent,
        Back: backContent
      },
      options: {
        allowDuplicate: false,
      },
      tags: "pt-br"
    };

    const response = await fetch("http://localhost:8765", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "addNote",
        version: 6,
        params: { note: note }
      }),
    });

    const data = await response.json();

    // Check if AnkiConnect returned an error
    if (data.error) {
      return res.status(500).json({ error: data.error });
    }
    console.log(data);

    // Wait 1 second before syncing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Sync to Anki after successful add
    let syncResult;
    try {
      syncResult = await syncToAnki();
    } catch (syncErr) {
      return res.status(500).json({ error: `Sync Error: ${syncErr}` });
    }

    res.json({ add: data, sync: syncResult });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/simplify', async (req, res) => {
  const { systemPrompt, userPrompt } = req.body;
  if (!systemPrompt || !userPrompt) {
    return res.status(400).json({ error: 'systemPrompt and userPrompt are required' });
  }
  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 512,
        temperature: 0.7
      })
    });
    const data = await openaiRes.json();
    const simplified = data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ simplified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/health', (req, res) => res.status(200).json({ status: "Healthy!"}))

app.listen(PORT, () => {
  console.log(`Backend Ankify server running on ${PORT}`);
}); 