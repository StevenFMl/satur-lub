const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mddxlwixadpshfynctgd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kZHhsd2l4YWRwc2hmeW5jdGdkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYwOTg4OSwiZXhwIjoyMDkzMTg1ODg5fQ.mdWj2pXWaIF9RAKfPriyUl9rsDCO6W2D4hj1yjyg9mA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function traceProduct() {
  const sku = 'VISTNY10W30GL1000557';
  
  // 1. Obtener producto
  const { data: product, error: pError } = await supabase
    .from('products')
    .select('*')
    .eq('sku', sku)
    .single();

  if (pError) {
    console.error('Error fetching product:', pError);
    return;
  }
  
  console.log('--- PRODUCT STATE ---');
  console.log(JSON.stringify(product, null, 2));

  // 2. Obtener movimientos de inventario
  const { data: movements, error: mError } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('product_id', product.id)
    .order('created_at', { ascending: true });

  if (mError) {
    console.error('Error fetching movements:', mError);
    return;
  }

  console.log('\n--- INVENTORY MOVEMENTS ---');
  console.log(JSON.stringify(movements, null, 2));

  // 3. Obtener balances de inventario
  const { data: balances, error: bError } = await supabase
    .from('inventory_balances')
    .select('*')
    .eq('product_id', product.id);

  if (bError) {
    console.error('Error fetching balances:', bError);
    return;
  }

  console.log('\n--- INVENTORY BALANCES ---');
  console.log(JSON.stringify(balances, null, 2));
}

traceProduct();
