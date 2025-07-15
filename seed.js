const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create contact lists
  const customersList = await prisma.contactList.upsert({
    where: { name: 'customers' },
    update: {},
    create: {
      name: 'customers',
      description: 'Existing customers'
    }
  });

  const prospectsList = await prisma.contactList.upsert({
    where: { name: 'prospects' },
    update: {},
    create: {
      name: 'prospects',
      description: 'Potential customers'
    }
  });

  const newsletterList = await prisma.contactList.upsert({
    where: { name: 'newsletter' },
    update: {},
    create: {
      name: 'newsletter',
      description: 'Newsletter subscribers'
    }
  });

  const appointmentsList = await prisma.contactList.upsert({
    where: { name: 'appointments' },
    update: {},
    create: {
      name: 'appointments',
      description: 'Appointment reminders'
    }
  });

  console.log('✅ Contact lists created');

  // Create sample contacts
  const john = await prisma.contact.upsert({
    where: { phone: '+0987654321' },
    update: {},
    create: {
      name: 'John Smith',
      phone: '+0987654321',
      email: 'john@example.com',
      optedOut: false,
      contactListMemberships: {
        create: [
          { contactListId: customersList.id },
          { contactListId: newsletterList.id }
        ]
      }
    }
  });

  const sarah = await prisma.contact.upsert({
    where: { phone: '+1122334455' },
    update: {},
    create: {
      name: 'Sarah Johnson',
      phone: '+1122334455',
      email: 'sarah@example.com',
      optedOut: false,
      contactListMemberships: {
        create: [
          { contactListId: customersList.id },
          { contactListId: appointmentsList.id }
        ]
      }
    }
  });

  const mike = await prisma.contact.upsert({
    where: { phone: '+5566778899' },
    update: {},
    create: {
      name: 'Mike Davis',
      phone: '+5566778899',
      email: 'mike@example.com',
      optedOut: true,
      contactListMemberships: {
        create: [
          { contactListId: prospectsList.id }
        ]
      }
    }
  });

  console.log('✅ Sample contacts created');

  // Create a sample campaign
  const campaign = await prisma.campaign.create({
    data: {
      name: 'Welcome Campaign',
      message: 'Welcome to our service! Reply STOP to opt out.',
      status: 'completed',
      sentCount: 2,
      deliveredCount: 2,
      failedCount: 0,
      optOutCount: 0,
      sentAt: new Date(Date.now() - 86400000), // 1 day ago
      targetLists: {
        create: [
          { contactListId: customersList.id }
        ]
      }
    }
  });

  console.log('✅ Sample campaign created');

  // Create sample messages
  await prisma.message.createMany({
    data: [
      {
        twilioSid: 'SM_sample_1',
        from: '+1234567890',
        to: '+0987654321',
        body: 'Hello! This is a test message from our SMS system.',
        direction: 'outbound',
        status: 'delivered',
        timestamp: new Date(Date.now() - 3600000),
        contactId: john.id,
        campaignId: campaign.id
      },
      {
        twilioSid: 'SM_sample_2',
        from: '+0987654321',
        to: '+1234567890',
        body: 'Thank you for the update. Looking forward to hearing from you soon.',
        direction: 'inbound',
        status: 'received',
        timestamp: new Date(Date.now() - 1800000),
        contactId: john.id
      },
      {
        twilioSid: 'SM_sample_3',
        from: '+1234567890',
        to: '+1122334455',
        body: 'Your appointment has been confirmed for tomorrow at 2:00 PM.',
        direction: 'outbound',
        status: 'delivered',
        timestamp: new Date(Date.now() - 900000),
        contactId: sarah.id
      },
      {
        twilioSid: 'SM_sample_4',
        from: '+1122334455',
        to: '+1234567890',
        body: 'Perfect! See you then. Should I bring anything specific?',
        direction: 'inbound',
        status: 'received',
        timestamp: new Date(Date.now() - 300000),
        contactId: sarah.id
      },
      {
        twilioSid: 'SM_sample_5',
        from: '+5566778899',
        to: '+1234567890',
        body: 'Hi, I received your marketing message. Can you tell me more about your services?',
        direction: 'inbound',
        status: 'received',
        timestamp: new Date(Date.now() - 120000),
        contactId: mike.id
      }
    ]
  });

  console.log('✅ Sample messages created');

  console.log('🎉 Database seeded successfully!');
  console.log('\n📊 Summary:');
  console.log(`- Contact Lists: ${await prisma.contactList.count()}`);
  console.log(`- Contacts: ${await prisma.contact.count()}`);
  console.log(`- Messages: ${await prisma.message.count()}`);
  console.log(`- Campaigns: ${await prisma.campaign.count()}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });