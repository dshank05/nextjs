/**
 * Helper script to list vendors or create test vendor
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

async function listVendors() {
  console.log('\n📋 Listing all vendors...\n');

  try {
    const response = await axios.get(`${API_BASE}/vendors`, {
      params: { limit: 100 }
    });

    if (response.data.vendors && response.data.vendors.length > 0) {
      console.table(response.data.vendors.map(v => ({
        ID: v.id,
        Name: v.vendor_name,
        Contact: v.contact_no || '-',
        Email: v.email || '-'
      })));

      console.log(`\nTotal: ${response.data.vendors.length} vendors`);
    } else {
      console.log('No vendors found.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

async function createTestVendor() {
  console.log('\n🔨 Creating "e2e test" vendor...\n');

  try {
    const response = await axios.post(`${API_BASE}/vendors`, {
      vendor_name: 'e2e test',
      contact_no: '9999999999',
      email: 'e2e@test.com',
      address: 'Test Address',
      city: 'Test City',
      state: 'Test State',
      pincode: '000000',
      gstin: 'TEST123456789',
      notes: 'Vendor created for E2E testing'
    });

    console.log('✅ Vendor created successfully!');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Name: ${response.data.vendor_name}`);

    return response.data.id;
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.response) {
      console.error('Response:', err.response.data);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'list') {
    await listVendors();
  } else if (command === 'create') {
    await createTestVendor();
  } else {
    console.log('\nUsage:');
    console.log('  node scripts/setup-test-vendor.js list    - List all vendors');
    console.log('  node scripts/setup-test-vendor.js create  - Create "e2e test" vendor');
    console.log('');
  }
}

main().catch(console.error);
