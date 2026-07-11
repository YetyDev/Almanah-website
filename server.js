const express = require('express');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Logging middleware
app.use(morgan('dev'));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Redirect requests ending with .html to their clean counterparts (e.g. /privacy.html -> /privacy)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const cleanPath = req.path.slice(0, -5);
    if (cleanPath === '/index') {
      return res.redirect(301, '/');
    }
    return res.redirect(301, cleanPath);
  }
  next();
});

// Copy the generated background image from the artifacts directory to the public workspace
const sourceImg = "C:\\Users\\Dell\\.gemini\\antigravity-ide\\brain\\f645e1b1-6ec5-4138-9496-d8a9a6e400cd\\hero_background_1782729110586.png";
const destImg1 = path.join(__dirname, 'public', 'images', 'hero-bg.png');
const destImg2 = path.join(__dirname, 'images', 'hero-bg.png');
try {
  if (fs.existsSync(sourceImg)) {
    fs.mkdirSync(path.dirname(destImg1), { recursive: true });
    fs.copyFileSync(sourceImg, destImg1);
    fs.mkdirSync(path.dirname(destImg2), { recursive: true });
    fs.copyFileSync(sourceImg, destImg2);
    console.log(`Successfully copied background image to both public/images/ and images/`);
  }
} catch (copyErr) {
  console.error('Error copying background image:', copyErr);
}

// Sync all images from root images/ to public/images/
const srcImagesDir = path.join(__dirname, 'images');
const destImagesDir = path.join(__dirname, 'public', 'images');
try {
  if (fs.existsSync(srcImagesDir)) {
    fs.mkdirSync(destImagesDir, { recursive: true });
    const files = fs.readdirSync(srcImagesDir);
    files.forEach(file => {
      const srcFile = path.join(srcImagesDir, file);
      const destFile = path.join(destImagesDir, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, destFile);
      }
    });
    console.log('Successfully synced all images from root images/ to public/images/');
  }
} catch (err) {
  console.error('Error syncing images:', err);
}


// Database file paths
const DATA_DIR = path.join(__dirname, 'data');
const DONATIONS_FILE = path.join(DATA_DIR, 'donations.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const NEWSLETTER_FILE = path.join(DATA_DIR, 'newsletter.json');

// Helper function to read database files safely
const readDB = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return [];
  }
};

// Helper function to write to database files safely
const writeDB = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`Error writing to ${filePath}:`, err);
    return false;
  }
};

// --- Page Routes ---

// cPanel, Webmail, and WHM redirects for hosting compatibility
app.get('/cpanel', (req, res) => {
  res.redirect(`https://${req.hostname}:2083`);
});

app.get('/webmail', (req, res) => {
  res.redirect(`https://${req.hostname}:2096`);
});

app.get('/whm', (req, res) => {
  res.redirect(`https://${req.hostname}:2087`);
});

// Home Page
app.get('/', (req, res) => {
  res.render('index', { page: 'home' });
});

// About Us Page
app.get('/about', (req, res) => {
  res.render('about', { page: 'about' });
});

// Programs Page
app.get('/programs', (req, res) => {
  res.render('programs', { page: 'programs' });
});

// Events Page
app.get('/events', (req, res) => {
  res.render('events', { page: 'events' });
});

// Impact Page
app.get('/impact', (req, res) => {
  res.render('impact', { page: 'impact' });
});

// Contact Us Page
app.get('/contact', (req, res) => {
  res.render('contact', { page: 'contact' });
});

// Privacy Policy Page
app.get('/privacy', (req, res) => {
  res.render('privacy', { page: 'privacy' });
});

// Terms of Use Page
app.get('/terms', (req, res) => {
  res.render('terms', { page: 'terms' });
});

// Middleware to check auth for API endpoints
const checkAPIAuth = (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session && activeSessions.has(cookies.admin_session)) {
    next();
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized.' });
  }
};

// Delete donation record route
app.delete('/api/admin/donations/:id', checkAPIAuth, (req, res) => {
  const { id } = req.params;
  let donations = readDB(DONATIONS_FILE);
  const initialLength = donations.length;
  donations = donations.filter(d => d.id !== id);
  
  if (donations.length < initialLength) {
    writeDB(DONATIONS_FILE, donations);
    res.json({ success: true, message: 'Donation record deleted successfully!' });
  } else {
    res.status(404).json({ success: false, error: 'Donation record not found.' });
  }
});

// Delete newsletter subscription record route
app.delete('/api/admin/newsletter/:id', checkAPIAuth, (req, res) => {
  const { id } = req.params;
  let newsletter = readDB(NEWSLETTER_FILE);
  const initialLength = newsletter.length;
  newsletter = newsletter.filter(n => n.id !== id);
  
  if (newsletter.length < initialLength) {
    writeDB(NEWSLETTER_FILE, newsletter);
    res.json({ success: true, message: 'Subscriber record deleted successfully!' });
  } else {
    res.status(404).json({ success: false, error: 'Subscriber record not found.' });
  }
});

// Delete contact message record route
app.delete('/api/admin/messages/:id', checkAPIAuth, (req, res) => {
  const { id } = req.params;
  let messages = readDB(MESSAGES_FILE);
  const initialLength = messages.length;
  messages = messages.filter(m => m.id !== id);
  
  if (messages.length < initialLength) {
    writeDB(MESSAGES_FILE, messages);
    res.json({ success: true, message: 'Message record deleted successfully!' });
  } else {
    res.status(404).json({ success: false, error: 'Message record not found.' });
  }
});

// --- Admin Authentication State & Helpers ---
const activeSessions = new Set();

const parseCookies = (cookieHeader) => {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
};

const checkAuth = (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session && activeSessions.has(cookies.admin_session)) {
    next();
  } else {
    res.redirect('/admin/login');
  }
};

// Admin Login Page (GET)
app.get('/admin/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session && activeSessions.has(cookies.admin_session)) {
    return res.redirect('/admin');
  }
  res.render('admin-login', { page: 'admin', error: null });
});

// Admin Login Submission (POST)
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === 'admin' && password === 'admin123') {
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    activeSessions.add(token);
    res.cookie('admin_session', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.redirect('/admin');
  } else {
    res.render('admin-login', { page: 'admin', error: 'Invalid username or password.' });
  }
});

// Admin AJAX Login Submission (POST API)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === 'admin' && password === 'admin123') {
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    activeSessions.add(token);
    res.cookie('admin_session', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid username or password.' });
  }
});

// Admin Logout (GET)
app.get('/admin/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session) {
    activeSessions.delete(cookies.admin_session);
  }
  res.clearCookie('admin_session');
  res.redirect('/admin/login');
});

// Admin Dashboard Page (Protected)
app.get('/admin', checkAuth, (req, res) => {
  const donations = readDB(DONATIONS_FILE);
  const messages = readDB(MESSAGES_FILE);
  const newsletter = readDB(NEWSLETTER_FILE);

  res.render('admin', {
    page: 'admin',
    donations: donations.reverse(), // Show newest first
    messages: messages.reverse(),
    newsletter: newsletter.reverse()
  });
});

// --- API POST Routes ---

// Submit a contact message
app.post('/api/contact', (req, res) => {
  const { name, email, phone, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, and message are required.' });
  }

  const messages = readDB(MESSAGES_FILE);
  const newMessage = {
    id: Date.now().toString(),
    name,
    email,
    phone: phone || 'N/A',
    message,
    submittedAt: new Date().toISOString()
  };

  messages.push(newMessage);
  if (writeDB(MESSAGES_FILE, messages)) {
    res.json({ success: true, message: 'Message submitted successfully!' });
  } else {
    res.status(500).json({ success: false, error: 'Database write error.' });
  }
});

// Submit a newsletter subscription
app.post('/api/newsletter', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required.' });
  }

  const newsletter = readDB(NEWSLETTER_FILE);
  
  // Check if email already subscribed
  const exists = newsletter.some(sub => sub.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.json({ success: true, message: 'You are already subscribed!' });
  }

  const newSubscription = {
    id: Date.now().toString(),
    email,
    subscribedAt: new Date().toISOString()
  };

  newsletter.push(newSubscription);
  if (writeDB(NEWSLETTER_FILE, newsletter)) {
    res.json({ success: true, message: 'Subscribed successfully!' });
  } else {
    res.status(500).json({ success: false, error: 'Database write error.' });
  }
});

// Submit a donation
app.post('/api/donate', (req, res) => {
  const { amount, currency } = req.body;
  const numAmount = parseFloat(amount);
  
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'A valid donation amount is required.' });
  }

  const donations = readDB(DONATIONS_FILE);
  const newDonation = {
    id: 'TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
    amount: numAmount,
    currency: currency || 'USD',
    status: 'Completed',
    donatedAt: new Date().toISOString()
  };

  donations.push(newDonation);
  if (writeDB(DONATIONS_FILE, donations)) {
    res.json({ success: true, message: 'Donation processed successfully!', donation: newDonation });
  } else {
    res.status(500).json({ success: false, error: 'Database write error.' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Almana Outreach Foundation running on http://localhost:${PORT}`);
  console.log(`==================================================`);
});
