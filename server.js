// Load .env for local development; must run before ./store reads process.env.
// On Render this is a no-op — variables come from the dashboard instead.
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const crypto = require('crypto');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

// Logging middleware
app.use(morgan('dev'));

// Body parser middleware
app.use(express.json({
  limit: '100kb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

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


const DONATION_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'];
const DONATION_PROGRAMS = ['general', 'education', 'empowerment'];
const FLUTTERWAVE_CURRENCIES = ['USD', 'GBP', 'EUR'];
const PAYSTACK_CURRENCIES = ['NGN'];

const getBaseUrl = (req) => {
  const configuredUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  const protocol = req.get('x-forwarded-proto') || req.protocol;
  return `${protocol}://${req.get('host')}`;
};

const createReference = (provider) => {
  const prefix = provider === 'paystack' ? 'ALM-PSK' : 'ALM-FLW';
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

const getPaymentProvider = (currency) => {
  if (PAYSTACK_CURRENCIES.includes(currency)) return 'paystack';
  if (FLUTTERWAVE_CURRENCIES.includes(currency)) return 'flutterwave';
  return null;
};

const toMinorUnit = (amount) => Math.round(Number(amount) * 100);

const normalizeAmount = (amount) => {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
};

const matchesDonationReference = (reference) => (d) =>
  d.id === reference || d.providerReference === reference;

const findDonationByReference = async (reference) => {
  const donations = await store.list('donations');
  return donations.find(matchesDonationReference(reference));
};

const updateDonationRecord = (reference, updates) =>
  store.update('donations', matchesDonationReference(reference), {
    ...updates,
    updatedAt: new Date().toISOString()
  });

const providerFetch = async (url, options) => {
  if (typeof fetch !== 'function') {
    throw new Error('This app needs Node.js 18+ because payment integration uses global fetch.');
  }

  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.message || payload.error || `Payment provider returned ${response.status}`;
    throw new Error(message);
  }

  return payload;
};

const initializePaystackDonation = async ({ donation, baseUrl }) => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  }

  const payload = await providerFetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: donation.donorEmail,
      amount: toMinorUnit(donation.amount).toString(),
      currency: donation.currency,
      reference: donation.id,
      callback_url: `${baseUrl}/donation/callback/paystack`,
      metadata: {
        donationId: donation.id,
        program: donation.program,
        donorName: donation.donorName
      }
    })
  });

  if (!payload.status || !payload.data || !payload.data.authorization_url) {
    throw new Error(payload.message || 'Paystack did not return a checkout URL.');
  }

  return {
    checkoutUrl: payload.data.authorization_url,
    providerReference: payload.data.reference || donation.id
  };
};

const initializeFlutterwaveDonation = async ({ donation, baseUrl }) => {
  if (!process.env.FLUTTERWAVE_SECRET_KEY) {
    throw new Error('FLUTTERWAVE_SECRET_KEY is not configured.');
  }

  const payload = await providerFetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tx_ref: donation.id,
      amount: donation.amount,
      currency: donation.currency,
      redirect_url: `${baseUrl}/donation/callback/flutterwave`,
      customer: {
        email: donation.donorEmail,
        name: donation.donorName || 'Anonymous Donor'
      },
      customizations: {
        title: 'Almanah Care and Love Outreach Foundation',
        description: `Donation to ${donation.program} fund`,
        logo: `${baseUrl}/logo.jpeg`
      },
      meta: {
        donationId: donation.id,
        program: donation.program
      }
    })
  });

  if (payload.status !== 'success' || !payload.data || !payload.data.link) {
    throw new Error(payload.message || 'Flutterwave did not return a checkout URL.');
  }

  return {
    checkoutUrl: payload.data.link,
    providerReference: donation.id
  };
};

const verifyPaystackReference = async (reference) => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  }

  const payload = await providerFetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
    }
  });

  return payload.data;
};

const verifyFlutterwaveTransaction = async (transactionId) => {
  if (!process.env.FLUTTERWAVE_SECRET_KEY) {
    throw new Error('Flutterwave v3 transaction verification requires FLUTTERWAVE_SECRET_KEY.');
  }

  const payload = await providerFetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
    }
  });

  return payload.data;
};

const markPaystackDonationFromVerification = async (verification) => {
  if (!verification || !verification.reference) return null;

  const donation = await findDonationByReference(verification.reference);
  if (!donation) return null;

  const expectedMinorAmount = toMinorUnit(donation.amount);
  const paymentSucceeded = verification.status === 'success';
  const amountMatches = Number(verification.amount) === expectedMinorAmount;
  const currencyMatches = verification.currency === donation.currency;

  if (!paymentSucceeded || !amountMatches || !currencyMatches) {
    return updateDonationRecord(donation.id, {
      status: 'Failed',
      providerStatus: verification.status || 'verification_failed',
      providerResponse: verification.gateway_response || 'Payment verification mismatch'
    });
  }

  return updateDonationRecord(donation.id, {
    status: 'Completed',
    providerStatus: verification.status,
    providerTransactionId: verification.id,
    providerResponse: verification.gateway_response,
    paidAt: verification.paid_at || new Date().toISOString()
  });
};

const markFlutterwaveDonationFromVerification = async (verification) => {
  if (!verification || !verification.tx_ref) return null;

  const donation = await findDonationByReference(verification.tx_ref);
  if (!donation) return null;

  const paymentSucceeded = verification.status === 'successful';
  const amountMatches = toMinorUnit(verification.amount) === toMinorUnit(donation.amount);
  const currencyMatches = verification.currency === donation.currency;

  if (!paymentSucceeded || !amountMatches || !currencyMatches) {
    return updateDonationRecord(donation.id, {
      status: 'Failed',
      providerStatus: verification.status || 'verification_failed',
      providerResponse: verification.processor_response || 'Payment verification mismatch'
    });
  }

  return updateDonationRecord(donation.id, {
    status: 'Completed',
    providerStatus: verification.status,
    providerTransactionId: verification.id,
    providerResponse: verification.processor_response,
    paidAt: verification.created_at || new Date().toISOString()
  });
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

// Delete record routes for the admin dashboard
const deleteRecordRoute = (collection, label) => async (req, res) => {
  try {
    const removed = await store.remove(collection, req.params.id);
    if (removed) {
      res.json({ success: true, message: `${label} record deleted successfully!` });
    } else {
      res.status(404).json({ success: false, error: `${label} record not found.` });
    }
  } catch (err) {
    console.error(`Error deleting from ${collection}:`, err);
    res.status(500).json({ success: false, error: 'Database write error.' });
  }
};

app.delete('/api/admin/donations/:id', checkAPIAuth, deleteRecordRoute('donations', 'Donation'));
app.delete('/api/admin/newsletter/:id', checkAPIAuth, deleteRecordRoute('newsletter', 'Subscriber'));
app.delete('/api/admin/messages/:id', checkAPIAuth, deleteRecordRoute('messages', 'Message'));

// --- Admin Authentication State & Helpers ---
const activeSessions = new Set();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const createAdminSession = (res) => {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.add(token);
  res.cookie('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  });
};

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
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    createAdminSession(res);
    res.redirect('/admin');
  } else {
    res.render('admin-login', { page: 'admin', error: 'Invalid username or password.' });
  }
});

// Admin AJAX Login Submission (POST API)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    createAdminSession(res);
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
app.get('/admin', checkAuth, async (req, res) => {
  try {
    const [donations, messages, newsletter] = await Promise.all([
      store.list('donations'),
      store.list('messages'),
      store.list('newsletter')
    ]);

    res.render('admin', {
      page: 'admin',
      donations: donations.reverse(), // Show newest first
      messages: messages.reverse(),
      newsletter: newsletter.reverse()
    });
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    res.status(500).send('Unable to load dashboard data. Please try again.');
  }
});

// --- API POST Routes ---

// Submit a contact message
app.post('/api/contact', async (req, res) => {
  const { name, email, phone, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, and message are required.' });
  }

  const newMessage = {
    id: Date.now().toString(),
    name,
    email,
    phone: phone || 'N/A',
    message,
    submittedAt: new Date().toISOString()
  };

  try {
    await store.append('messages', newMessage);
    res.json({ success: true, message: 'Message submitted successfully!' });
  } catch (err) {
    console.error('Error saving contact message:', err);
    res.status(500).json({ success: false, error: 'Database write error.' });
  }
});

// Submit a newsletter subscription
app.post('/api/newsletter', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required.' });
  }

  try {
    // Check if email already subscribed
    const newsletter = await store.list('newsletter');
    const exists = newsletter.some(sub => sub.email && sub.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      return res.json({ success: true, message: 'You are already subscribed!' });
    }

    await store.append('newsletter', {
      id: Date.now().toString(),
      email,
      subscribedAt: new Date().toISOString()
    });
    res.json({ success: true, message: 'Subscribed successfully!' });
  } catch (err) {
    console.error('Error saving newsletter subscription:', err);
    res.status(500).json({ success: false, error: 'Database write error.' });
  }
});

// Submit a donation and hand the donor off to the provider-hosted checkout
app.post('/api/donate', async (req, res) => {
  const { amount, currency = 'NGN', program = 'general', donorName = '', donorEmail } = req.body;
  const normalizedCurrency = String(currency).toUpperCase();
  const normalizedProgram = String(program).toLowerCase();
  const numAmount = normalizeAmount(amount);
  const provider = getPaymentProvider(normalizedCurrency);

  if (!numAmount || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'A valid donation amount is required.' });
  }

  if (!DONATION_CURRENCIES.includes(normalizedCurrency) || !provider) {
    return res.status(400).json({ success: false, error: 'Unsupported donation currency.' });
  }

  if (!DONATION_PROGRAMS.includes(normalizedProgram)) {
    return res.status(400).json({ success: false, error: 'Unsupported donation program.' });
  }

  if (!donorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(donorEmail))) {
    return res.status(400).json({ success: false, error: 'A valid email address is required for the payment receipt.' });
  }

  const newDonation = {
    id: createReference(provider),
    amount: numAmount,
    currency: normalizedCurrency,
    program: normalizedProgram,
    provider,
    providerReference: null,
    providerTransactionId: null,
    providerStatus: null,
    providerResponse: null,
    checkoutUrl: null,
    status: 'Pending',
    donorName: String(donorName || '').trim() || 'Anonymous Donor',
    donorEmail: String(donorEmail).trim().toLowerCase(),
    donatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    await store.append('donations', newDonation);
  } catch (err) {
    console.error('Error saving donation record:', err);
    return res.status(500).json({ success: false, error: 'Database write error.' });
  }

  try {
    const baseUrl = getBaseUrl(req);
    const initializedPayment = provider === 'paystack'
      ? await initializePaystackDonation({ donation: newDonation, baseUrl })
      : await initializeFlutterwaveDonation({ donation: newDonation, baseUrl });

    const updatedDonation = await updateDonationRecord(newDonation.id, {
      providerReference: initializedPayment.providerReference,
      providerTransactionId: initializedPayment.providerTransactionId || null,
      providerStatus: initializedPayment.providerStatus || null,
      checkoutUrl: initializedPayment.checkoutUrl
    });

    if (!updatedDonation) {
      return res.status(500).json({ success: false, error: 'Unable to save checkout details.' });
    }

    res.json({
      success: true,
      message: 'Donation checkout created successfully.',
      provider,
      reference: updatedDonation.id,
      checkoutUrl: initializedPayment.checkoutUrl
    });
  } catch (err) {
    await updateDonationRecord(newDonation.id, {
      status: 'Failed',
      providerStatus: 'initialization_failed',
      providerResponse: err.message
    }).catch(updateErr => console.error('Error marking donation as failed:', updateErr));

    console.error('Donation initialization error:', err);
    res.status(502).json({
      success: false,
      error: 'Unable to initialize payment checkout. Please try again later.'
    });
  }
});

// Donation status page. Shown after checkout; reflects the record's current
// state, so a Pending donation renders as "processing" and the page's
// auto-refresh picks up the webhook confirmation when it lands.
app.get('/donation/status', async (req, res) => {
  const reference = String(req.query.reference || '');
  let donation = null;

  if (reference) {
    try {
      donation = await findDonationByReference(reference);
    } catch (err) {
      console.error('Error loading donation status:', err);
    }
  }

  let state = 'not-found';
  if (donation) {
    if (donation.status === 'Completed') state = 'success';
    else if (donation.status === 'Failed') state = 'failed';
    else state = 'processing';
  }

  res.render('donation-status', { page: 'donation', state, donation, reference });
});

const donationStatusUrl = (reference) =>
  reference ? `/donation/status?reference=${encodeURIComponent(reference)}` : '/donation/status';

app.get('/donation/callback/paystack', async (req, res) => {
  const reference = req.query.reference || req.query.trxref;
  if (!reference) {
    return res.redirect(donationStatusUrl(''));
  }

  try {
    const verification = await verifyPaystackReference(reference);
    await markPaystackDonationFromVerification(verification);
  } catch (err) {
    // The status page renders the record as "processing" and the webhook can
    // still complete it, so a verification hiccup here is not a dead end.
    console.error('Paystack callback verification error:', err);
  }

  res.redirect(donationStatusUrl(reference));
});

app.get('/donation/callback/flutterwave', async (req, res) => {
  const transactionId = req.query.transaction_id;
  let reference = req.query.tx_ref || '';

  try {
    if (transactionId) {
      const verification = await verifyFlutterwaveTransaction(transactionId);
      await markFlutterwaveDonationFromVerification(verification);
      reference = reference || (verification && verification.tx_ref) || '';
    }
  } catch (err) {
    console.error('Flutterwave callback verification error:', err);
  }

  res.redirect(donationStatusUrl(reference));
});

app.post('/api/webhooks/paystack', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!process.env.PAYSTACK_SECRET_KEY || !signature || !req.rawBody) {
    return res.sendStatus(401);
  }

  const expectedSignature = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.sendStatus(401);
  }

  const event = req.body;
  if (event.event === 'charge.success' && event.data) {
    try {
      await markPaystackDonationFromVerification(event.data);
    } catch (err) {
      console.error('Paystack webhook processing error:', err);
      return res.sendStatus(500); // Paystack retries on non-200, so the update is not lost
    }
  }

  res.sendStatus(200);
});

app.post('/api/webhooks/flutterwave', async (req, res) => {
  const webhookHash = req.headers['verif-hash'];
  if (process.env.FLUTTERWAVE_WEBHOOK_HASH && webhookHash !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
    return res.sendStatus(401);
  }

  const event = req.body;
  const transactionId = event && event.data && event.data.id;

  if (transactionId) {
    try {
      const verification = await verifyFlutterwaveTransaction(transactionId);
      await markFlutterwaveDonationFromVerification(verification);
    } catch (err) {
      console.error('Flutterwave webhook verification error:', err);
    }
  }

  res.sendStatus(200);
});

// Start the server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Almana Outreach Foundation running on http://localhost:${PORT}`);
  console.log(`==================================================`);
});
