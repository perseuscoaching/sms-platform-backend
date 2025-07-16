const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const twilio = require('twilio');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' });

// Twilio client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ===== API ROUTES =====

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'SMS Platform API is running' });
});

// Get all messages
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      include: {
        contact: true,
        campaign: true
      },
      orderBy: { timestamp: 'desc' }
    });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get all contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({
      include: {
        contactListMemberships: {
          include: {
            contactList: true
          }
        },
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 1
        }
      }
    });
    res.json(contacts);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Get all contact lists
app.get('/api/contact-lists', async (req, res) => {
  try {
    const lists = await prisma.contactList.findMany({
      include: {
        _count: {
          select: { contacts: true }
        }
      }
    });
    res.json(lists);
  } catch (error) {
    console.error('Error fetching contact lists:', error);
    res.status(500).json({ error: 'Failed to fetch contact lists' });
  }
});

// Get all campaigns
app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        messages: true,
        targetLists: {
          include: {
            contactList: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Send individual SMS
app.post('/api/send-sms', async (req, res) => {
  try {
    const { to, body, contactId } = req.body;
    
    // Send via Twilio
    const message = await twilioClient.messages.create({
      body: body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });

    // Save to database
    const dbMessage = await prisma.message.create({
      data: {
        twilioSid: message.sid,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: to,
        body: body,
        direction: 'outbound',
        status: 'pending',
        timestamp: new Date(),
        contactId: contactId
      },
      include: {
        contact: true
      }
    });

    // Broadcast to all connected clients
    io.emit('new_message', dbMessage);

    res.json({ success: true, message: dbMessage });
  } catch (error) {
    console.error('Error sending SMS:', error);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

// Send bulk SMS campaign
app.post('/api/campaigns', async (req, res) => {
  try {
    const { name, message, targetListIds } = req.body;

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: name,
        message: message,
        status: 'sending',
        sentCount: 0,
        deliveredCount: 0,
        failedCount: 0,
        optOutCount: 0,
        targetLists: {
          create: targetListIds.map(listId => ({
            contactListId: listId
          }))
        }
      }
    });

    // Get contacts from target lists
    const contacts = await prisma.contact.findMany({
      where: {
        optedOut: false,
        contactListMemberships: {
          some: {
            contactListId: {
              in: targetListIds
            }
          }
        }
      }
    });

    // Send messages to all contacts
    const messagePromises = contacts.map(async (contact) => {
      try {
        const twilioMessage = await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: contact.phone
        });

        const dbMessage = await prisma.message.create({
          data: {
            twilioSid: twilioMessage.sid,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: contact.phone,
            body: message,
            direction: 'outbound',
            status: 'pending',
            timestamp: new Date(),
            contactId: contact.id,
            campaignId: campaign.id
          },
          include: {
            contact: true,
            campaign: true
          }
        });

        // Broadcast each message
        io.emit('new_message', dbMessage);
        
        return dbMessage;
      } catch (error) {
        console.error(`Failed to send to ${contact.phone}:`, error);
        return null;
      }
    });

    const sentMessages = await Promise.all(messagePromises);
    const successfulMessages = sentMessages.filter(msg => msg !== null);

    // Update campaign stats
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'completed',
        sentCount: successfulMessages.length,
        deliveredCount: 0 // Will be updated via webhooks
      }
    });

    const updatedCampaign = await prisma.campaign.findUnique({
      where: { id: campaign.id },
      include: {
        messages: true,
        targetLists: {
          include: {
            contactList: true
          }
        }
      }
    });

    // Broadcast campaign update
    io.emit('campaign_updated', updatedCampaign);

    res.json({ success: true, campaign: updatedCampaign });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// Create contact list
app.post('/api/contact-lists', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    // Check if list name already exists
    const existingList = await prisma.contactList.findUnique({
      where: { name: name.toLowerCase().replace(/\s+/g, '_') }
    });
    
    if (existingList) {
      // Add timestamp to make it unique
      const uniqueName = `${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
      const list = await prisma.contactList.create({
        data: {
          name: uniqueName,
          description: description
        }
      });
      io.emit('contact_list_created', list);
      res.json(list);
    } else {
      const list = await prisma.contactList.create({
        data: {
          name: name.toLowerCase().replace(/\s+/g, '_'),
          description: description
        }
      });
      io.emit('contact_list_created', list);
      res.json(list);
    }
  } catch (error) {
    console.error('Error creating contact list:', error);
    const errorMessage = error.code === 'P2002' 
      ? 'A list with this name already exists' 
      : 'Failed to create contact list';
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

// Upload contacts CSV
app.post('/api/contacts/upload', upload.single('csv'), async (req, res) => {
  // Extend timeout for large uploads
  req.setTimeout(300000); // 5 minutes
  
  try {
    const { listId } = req.body;
    const contacts = [];
    let skippedRows = 0;
    let rowCount = 0;

    console.log('Starting CSV upload for list:', listId);

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (row) => {
        rowCount++;
        // Debug first few rows
        if (rowCount <= 3) {
          console.log('Row', rowCount, ':', row);
        }
        
        // Try to find phone number in various possible column names
        const phone = row.phone || row.Phone || row.PHONE || 
                     row.mobile || row.Mobile || row.MOBILE ||
                     row.number || row.Number || row.NUMBER ||
                     row.cell || row.Cell || row.CELL ||
                     Object.values(row).find(val => val && val.toString().match(/^\+?\d{10,}$/));
        
        // Try to find name in various possible column names
        const name = row.name || row.Name || row.NAME || 
                    row.firstname || row.first_name || row['First Name'] ||
                    row.lastname || row.last_name || row['Last Name'] ||
                    row.fullname || row['Full Name'] || 'Contact ' + rowCount;
        
        if (phone) {
          contacts.push({
            name: name ? name.toString().trim() : 'Contact ' + rowCount,
            phone: phone.toString().trim(),
            email: row.email || row.Email || row.EMAIL || null,
            optedOut: false
          });
        } else {
          skippedRows++;
          if (skippedRows <= 5) {
            console.log('Skipped row', rowCount, '- no phone found:', row);
          }
        }
      })
      .on('error', (error) => {
        console.error('CSV parsing error:', error);
        res.status(500).json({ error: 'Failed to parse CSV file' });
      })
      .on('end', async () => {
        try {
          console.log(`Processing ${contacts.length} contacts...`);
          
          // Process in batches to avoid timeouts
          const batchSize = 100;
          const createdContacts = [];
          
          for (let i = 0; i < contacts.length; i += batchSize) {
            const batch = contacts.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(contacts.length/batchSize)}`);
            
            const batchResults = await Promise.all(
              batch.map(async (contactData) => {
              // Check if contact already exists
              const existing = await prisma.contact.findUnique({
                where: { phone: contactData.phone }
              });

              if (existing) {
                // Add to list if not already in it
                await prisma.contactListMembership.upsert({
                  where: {
                    contactId_contactListId: {
                      contactId: existing.id,
                      contactListId: parseInt(listId)
                    }
                  },
                  update: {},
                  create: {
                    contactId: existing.id,
                    contactListId: parseInt(listId)
                  }
                });
                return existing;
              } else {
                // Create new contact
                const newContact = await prisma.contact.create({
                  data: {
                    ...contactData,
                    contactListMemberships: {
                      create: {
                        contactListId: parseInt(listId)
                      }
                    }
                  }
                });
                return newContact;
              }
            })
          );
          
          createdContacts.push(...batchResults);
        }

          // Clean up uploaded file
          fs.unlinkSync(req.file.path);

          // Broadcast update
          io.emit('contacts_uploaded', { 
            count: createdContacts.length, 
            listId: parseInt(listId) 
          });

          console.log(`CSV Upload Complete: ${createdContacts.length} contacts processed, ${skippedRows} rows skipped out of ${rowCount} total rows`);
          
          res.json({ 
            success: true, 
            contactsProcessed: createdContacts.length,
            totalRows: rowCount,
            skippedRows: skippedRows
          });
        } catch (dbError) {
          console.error('Database error during CSV upload:', dbError);
          res.status(500).json({ error: 'Failed to save contacts to database' });
        }
      });
  } catch (error) {
    console.error('Error uploading contacts:', error);
    res.status(500).json({ error: 'Failed to upload contacts' });
  }
});

// Toggle contact opt-out status
app.patch('/api/contacts/:id/opt-out', async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(id) }
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const updatedContact = await prisma.contact.update({
      where: { id: parseInt(id) },
      data: { optedOut: !contact.optedOut }
    });

    io.emit('contact_updated', updatedContact);
    res.json(updatedContact);
  } catch (error) {
    console.error('Error toggling opt-out:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// ===== TWILIO WEBHOOKS =====

// Incoming SMS webhook
app.post('/webhook/sms', async (req, res) => {
  try {
    const { From, To, Body, MessageSid } = req.body;

    // Find or create contact
    let contact = await prisma.contact.findUnique({
      where: { phone: From }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: From, // Use phone as name initially
          phone: From,
          optedOut: false
        }
      });
    }

    // Check for opt-out keywords
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'OPT-OUT'];
    const isOptOut = optOutKeywords.some(keyword => 
      Body.toUpperCase().includes(keyword)
    );

    if (isOptOut) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { optedOut: true }
      });
      
      // Send confirmation
      await twilioClient.messages.create({
        body: "You have been unsubscribed from our messages. Reply START to resubscribe.",
        from: To,
        to: From
      });
    }

    // Save incoming message
    const message = await prisma.message.create({
      data: {
        twilioSid: MessageSid,
        from: From,
        to: To,
        body: Body,
        direction: 'inbound',
        status: 'received',
        timestamp: new Date(),
        contactId: contact.id
      },
      include: {
        contact: true
      }
    });

    // Broadcast to all connected clients
    io.emit('new_message', message);

    // Respond to Twilio
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    res.status(500).send('Error');
  }
});

// Message status webhook
app.post('/webhook/status', async (req, res) => {
  try {
    const { MessageSid, MessageStatus } = req.body;

    // Update message status in database
    const updatedMessage = await prisma.message.update({
      where: { twilioSid: MessageSid },
      data: { status: MessageStatus },
      include: {
        contact: true,
        campaign: true
      }
    });

    // Update campaign stats if it's a campaign message
    if (updatedMessage.campaignId) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: updatedMessage.campaignId },
        include: { messages: true }
      });

      const deliveredCount = campaign.messages.filter(m => m.status === 'delivered').length;
      const failedCount = campaign.messages.filter(m => m.status === 'failed').length;

      await prisma.campaign.update({
        where: { id: updatedMessage.campaignId },
        data: {
          deliveredCount,
          failedCount
        }
      });
    }

    // Broadcast update
    io.emit('message_status_update', updatedMessage);

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling status update:', error);
    res.status(500).send('Error');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📞 Twilio webhook: ${process.env.PUBLIC_URL}/webhook/sms`);
  console.log(`📊 Status webhook: ${process.env.PUBLIC_URL}/webhook/status`);
});