# 🚀 SMS Marketing Platform - Complete Deployment Guide

## 📋 Prerequisites

- Node.js 18+ installed
- PostgreSQL database (local or hosted)
- Twilio account with phone number
- Git

## 🏗️ Step 1: Backend Setup

### 1.1 Initialize Backend Project
```bash
mkdir sms-platform-backend
cd sms-platform-backend
npm init -y
```

### 1.2 Install Dependencies
```bash
npm install @prisma/client cors csv-parser dotenv express multer socket.io twilio
npm install -D nodemon prisma
```

### 1.3 Setup Database with Prisma
```bash
npx prisma init
```

1. Copy the `schema.prisma` file contents to `prisma/schema.prisma`
2. Copy the `server.js` file contents to `server.js`
3. Copy the `package.json` dependencies to your `package.json`

### 1.4 Environment Configuration
1. Copy `.env.example` to `.env`
2. Fill in your values:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/sms_platform"
TWILIO_ACCOUNT_SID="your_twilio_account_sid"
TWILIO_AUTH_TOKEN="your_twilio_auth_token"
TWILIO_PHONE_NUMBER="+1234567890"
PORT=3001
PUBLIC_URL="https://your-app.com"
```

### 1.5 Database Migration
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 1.6 Seed Database (Optional)
Create `seed.js`:
```javascript
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Create sample contact lists
  const customersList = await prisma.contactList.create({
    data: {
      name: 'customers',
      description: 'Existing customers'
    }
  });

  const prospectsList = await prisma.contactList.create({
    data: {
      name: 'prospects',
      description: 'Potential customers'
    }
  });

  // Create sample contacts
  await prisma.contact.create({
    data: {
      name: 'John Smith',
      phone: '+1234567890',
      email: 'john@example.com',
      contactListMemberships: {
        create: {
          contactListId: customersList.id
        }
      }
    }
  });

  console.log('✅ Database seeded successfully');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Run seed:
```bash
node seed.js
```

## 🔧 Step 2: Twilio Configuration

### 2.1 Setup Webhooks
1. Go to your Twilio Console
2. Navigate to Phone Numbers → Manage → Active Numbers
3. Click on your SMS-enabled phone number
4. Set webhook URLs:
   - **Incoming Messages**: `https://your-app.com/webhook/sms`
   - **Status Updates**: `https://your-app.com/webhook/status`

### 2.2 Test Webhooks Locally (Development)
Use ngrok to expose local server:
```bash
npm install -g ngrok
ngrok http 3001
```

Use the ngrok URL for webhooks during development.

## 🚀 Step 3: Deployment Options

### Option A: Railway (Recommended - Easiest)

1. **Create account**: Go to [railway.app](https://railway.app)
2. **Connect GitHub**: Link your repository
3. **Add PostgreSQL**: Click "New" → "Database" → "PostgreSQL"
4. **Deploy backend**: 
   - Click "New" → "GitHub Repo"
   - Select your backend repository
   - Railway auto-detects Node.js

5. **Set Environment Variables**:
   ```
   DATABASE_URL=postgresql://username:password@host:port/database
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_PHONE_NUMBER=+1234567890
   PUBLIC_URL=https://your-app.railway.app
   ```

6. **Domain**: Railway provides a domain automatically

### Option B: Render

1. **Create account**: Go to [render.com](https://render.com)
2. **Create PostgreSQL database**:
   - Dashboard → "New" → "PostgreSQL"
   - Copy connection string

3. **Create Web Service**:
   - Dashboard → "New" → "Web Service"
   - Connect GitHub repository
   - Set build command: `npm install && npx prisma generate && npx prisma migrate deploy`
   - Set start command: `npm start`

4. **Environment Variables**:
   ```
   DATABASE_URL=your_postgres_url
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_PHONE_NUMBER=+1234567890
   PUBLIC_URL=https://your-app.onrender.com
   ```

### Option C: Supabase + Railway (Fastest Real-time)

1. **Database**: Create project at [supabase.com](https://supabase.com)
2. **Backend**: Deploy on Railway as above
3. **Real-time**: Supabase provides built-in real-time subscriptions

## 📱 Step 4: Frontend Updates

### 4.1 Install Dependencies
In your Electron/React project:
```bash
npm install socket.io-client
```

### 4.2 Environment Variables
Create `.env` in frontend:
```env
REACT_APP_API_URL=https://your-backend-url.com
```

### 4.3 Update Component
Replace your current React component with the updated frontend code that uses APIs and Socket.IO.

## 🔧 Step 5: Post-Deployment Setup

### 5.1 Update Twilio Webhooks
Update your Twilio phone number webhooks to point to your deployed backend:
- `https://your-deployed-backend.com/webhook/sms`
- `https://your-deployed-backend.com/webhook/status`

### 5.2 Test the System
1. **Send test SMS**: Use the compose tab to send a message
2. **Reply test**: Send SMS to your Twilio number from external phone
3. **Bulk test**: Create a small campaign with 1-2 contacts
4. **Upload test**: Upload a small CSV with contacts

### 5.3 Production Considerations

**Security**:
```javascript
// Add to server.js for production
app.use(express.json({ limit: '10mb' }));
app.use(helmet()); // Install: npm install helmet

// Add JWT authentication middleware
const jwt = require('jsonwebtoken');
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Protect routes: app.get('/api/messages', authenticateToken, async (req, res) => {
```

**Rate Limiting**:
```javascript
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);
```

## 📊 Step 6: Monitoring & Analytics

### 6.1 Database Monitoring
- Use Prisma Studio: `npx prisma studio`
- Monitor query performance
- Set up automated backups

### 6.2 Application Monitoring
```javascript
// Add to server.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});
```

### 6.3 Twilio Usage Monitoring
Monitor your Twilio console for:
- Message delivery rates
- Failed messages
- Account balance
- Usage patterns

## 🚨 Troubleshooting

### Common Issues:

**Database Connection**:
```bash
# Test connection
npx prisma studio
```

**Twilio Webhooks**:
```bash
# Check webhook logs in Twilio console
# Test webhook endpoints manually
curl -X POST https://your-app.com/webhook/sms \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+1234567890&To=+0987654321&Body=Test&MessageSid=test123"
```

**Socket.IO Connection**:
```javascript
// Add debug logging
const io = socketIo(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});
```

**CORS Issues**:
```javascript
// More permissive CORS for development
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
```

## ✅ Final Checklist

- [ ] Backend deployed and accessible
- [ ] Database connected and migrated
- [ ] Twilio webhooks configured
- [ ] Frontend updated with API calls
- [ ] Socket.IO real-time updates working
- [ ] Test message sending/receiving
- [ ] Bulk campaigns functional
- [ ] Contact upload working
- [ ] Opt-out handling implemented
- [ ] Production security measures added

## 🎉 You're Live!

Your SMS marketing platform is now ready for your 5-person team to use! The system will:
- ✅ Handle incoming/outgoing SMS in real-time
- ✅ Manage contacts and lists
- ✅ Send bulk campaigns
- ✅ Track delivery status
- ✅ Handle opt-outs automatically
- ✅ Sync across all connected clients

**Need help?** The system logs everything to console, and you can monitor via:
- Database: Prisma Studio
- Backend: Server logs
- Twilio: Console webhooks section