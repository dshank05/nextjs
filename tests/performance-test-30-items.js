const fetch = require('node-fetch');

async function testPurchaseCreationWith30Items() {
  console.log('🚀 Starting performance test: Purchase creation with 30 items');

  try {
    // ===== STEP 1: Fetch 30 real products from database =====
    console.log('📦 Fetching 30 real products from database...');
    const productsResponse = await fetch('http://localhost:3000/api/products?limit=30');
    if (!productsResponse.ok) {
      throw new Error('Failed to fetch products');
    }
    const productsData = await productsResponse.json();
    const products = productsData.products || [];

    if (products.length < 30) {
      console.warn(`⚠️ Only ${products.length} products available, using all of them`);
    }

    console.log(`✅ Fetched ${products.length} products`);

    // ===== STEP 2: Create purchase payload with 30 items =====
    console.log('📝 Creating purchase payload...');

    // Use first vendor (assuming vendors exist)
    const vendorsResponse = await fetch('http://localhost:3000/api/vendors?dropdown=true');
    const vendorsData = await vendorsResponse.json();
    const vendorId = vendorsData.vendors?.[0]?.id || 1;

    // Create 30 purchase items from real products
    const items = products.slice(0, 30).map((product, index) => ({
      product_id: product.id.toString(),
      product_name: product.product_name,
      qty: Math.floor(Math.random() * 5) + 1, // Random qty 1-5
      rate: Math.floor(Math.random() * 1000) + 100, // Random rate 100-1100
      gst_percentage: 18, // Standard GST
      cgst: 0, // Will be calculated
      sgst: 0, // Will be calculated
      igst: 0, // Will be calculated
      tax: 0, // Will be calculated
      total: 0, // Will be calculated
      car_model: 'Test Model',
      model_id: 1,
      company_id: product.company_id || 1,
      part: `PART-${index + 1}`
    }));

    // Calculate totals for each item
    items.forEach(item => {
      const subtotal = item.qty * item.rate;
      const taxAmount = (subtotal * item.gst_percentage) / 100;
      item.total = subtotal + taxAmount;
      item.tax = taxAmount;
      item.cgst = taxAmount / 2;
      item.sgst = taxAmount / 2;
    });

    // Calculate grand totals
    const itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0);
    const totalTax = items.reduce((sum, item) => sum + item.tax, 0);
    const grandTotal = itemsTotal + totalTax;

    const purchasePayload = {
      vendor_id: vendorId,
      vendor_name: 'Test Vendor',
      contact_number: '9999999999',
      email_id: 'test@example.com',
      address: 'Test Address',
      gst_number: '22AAAAA0000A1Z5',
      date: new Date().toISOString().split('T')[0],
      bill_reference: `PERF-TEST-${Date.now()}`,
      staff_id: null,
      items: items,
      transport_name: 'Test Transport',
      vehicle_number: 'TEST123',
      transport_cost: 500,
      descriptions: 'Performance test purchase with 30 items',
      packing_forwarding_qty: 1,
      packing_forwarding_rate: 100,
      packing_forwarding_total: 100,
      total_cgst: totalTax / 2,
      total_sgst: totalTax / 2,
      total_igst: 0,
      total_tax: totalTax,
      notes: `Performance test: ${items.length} items, Total: ₹${grandTotal}`,
      payment_status: 0, // Unpaid
      payment_mode: 0
    };

    console.log(`✅ Created payload with ${items.length} items, Grand Total: ₹${grandTotal}`);

    // ===== STEP 3: Send POST request to create purchase =====
    console.log('📤 Sending POST request to create purchase...');
    const startTime = Date.now();

    // ===== TEST ORIGINAL ENDPOINT =====
    console.log('🆚 Testing ORIGINAL endpoint...');
    const originalStartTime = Date.now();

    const originalResponse = await fetch('http://localhost:3000/api/purchases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(purchasePayload)
    });

    const originalEndTime = Date.now();
    const originalDuration = originalEndTime - originalStartTime;

    console.log(`⏱️ ORIGINAL API Response time: ${originalDuration}ms`);

    if (originalResponse.ok) {
      const result = await originalResponse.json();
      console.log('✅ ORIGINAL: Purchase created successfully!');
      console.log(`📄 Invoice Number: ${result.purchase?.invoice_no}`);
      console.log(`💰 Total Amount: ₹${result.purchase?.total}`);
    } else {
      const error = await originalResponse.json();
      console.error('❌ ORIGINAL: Purchase creation failed:', error);
      console.log(`⏱️ Failed after ${originalDuration}ms`);
      return; // Exit if original fails
    }

    // ===== TEST OPTIMIZED ENDPOINT =====
    console.log('🚀 Testing OPTIMIZED endpoint...');
    const optimizedStartTime = Date.now();

    const optimizedResponse = await fetch('http://localhost:3000/api/purchases/optimized', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(purchasePayload)
    });

    const optimizedEndTime = Date.now();
    const optimizedDuration = optimizedEndTime - optimizedStartTime;

    console.log(`⏱️ OPTIMIZED API Response time: ${optimizedDuration}ms`);

    if (optimizedResponse.ok) {
      const result = await optimizedResponse.json();
      console.log('✅ OPTIMIZED: Purchase created successfully!');
      console.log(`📄 Invoice Number: ${result.purchase?.invoice_no}`);
      console.log(`💰 Total Amount: ₹${result.purchase?.total}`);
    } else {
      const error = await optimizedResponse.json();
      console.error('❌ OPTIMIZED: Purchase creation failed:', error);
      console.log(`⏱️ Failed after ${optimizedDuration}ms`);
    }

    // ===== PERFORMANCE COMPARISON =====
    const totalTime = Date.now() - startTime;
    const timeDifference = originalDuration - optimizedDuration;
    const percentImprovement = ((timeDifference / originalDuration) * 100).toFixed(1);

    console.log('\n📊 ===== PERFORMANCE COMPARISON =====');
    console.log(`📊 Items processed: ${items.length}`);
    console.log(`⏱️ ORIGINAL: ${originalDuration}ms`);
    console.log(`⚡ OPTIMIZED: ${optimizedDuration}ms`);
    console.log(`📈 Improvement: ${timeDifference}ms (${percentImprovement}%)`);
    console.log(`🏆 Winner: ${optimizedDuration < originalDuration ? 'OPTIMIZED' : 'ORIGINAL'}`);
    console.log(`💡 Average time per item:`);
    console.log(`   ORIGINAL: ${(originalDuration / items.length).toFixed(1)}ms`);
    console.log(`   OPTIMIZED: ${(optimizedDuration / items.length).toFixed(1)}ms`);

  } catch (error) {
    console.error('💥 Test failed:', error.message);
  }
}

// Run the test
testPurchaseCreationWith30Items();
