const fs = require('fs');
const path = require('path');

// List of API directories to update
const apiDirs = [
  'financial-years',
  'gst-rates',
  'invoices',
  'mechanics',
  'purchase-returns',
  'reports',
  'sale-returns',
  'salex-returns',
  'staff',
  'states',
  'transactions',
  'users',
  'warehouses'
];

function updateApiFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');

    // Skip if already has withObservability
    if (content.includes('withObservability')) {
      console.log(`Skipping ${filePath} - already has withObservability`);
      return;
    }

    // Add import
    const importStatement = "import { withObservability } from '../../../lib/withObservability'\n";
    if (content.includes("import { prisma } from '../../../lib/db'")) {
      content = content.replace(
        "import { prisma } from '../../../lib/db'",
        "import { prisma } from '../../../lib/db'\nimport { withObservability } from '../../../lib/withObservability'"
      );
    } else {
      // Add after the first import
      const firstImportEnd = content.indexOf('\n', content.indexOf('import')) + 1;
      content = content.slice(0, firstImportEnd) + importStatement + content.slice(firstImportEnd);
    }

    // Change export default to function declaration
    if (content.includes('export default async function handler(')) {
      content = content.replace(
        'export default async function handler(',
        'async function handler('
      );

      // Add export default withObservability at the end
      content += '\n\nexport default withObservability(handler)';
    }

    fs.writeFileSync(filePath, content);
    console.log(`Updated ${filePath}`);
  } catch (error) {
    console.error(`Error updating ${filePath}:`, error.message);
  }
}

function processApiDirectory(dirName) {
  const dirPath = path.join(__dirname, '..', 'pages', 'api', dirName);

  if (!fs.existsSync(dirPath)) {
    console.log(`Directory ${dirPath} does not exist`);
    return;
  }

  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    if (file.endsWith('.ts') && file !== '[...nextauth].ts') {
      const filePath = path.join(dirPath, file);
      updateApiFile(filePath);
    }
  }

  // Also check for index.ts in the directory
  const indexPath = path.join(dirPath, 'index.ts');
  if (fs.existsSync(indexPath)) {
    updateApiFile(indexPath);
  }
}

// Process all API directories
for (const dir of apiDirs) {
  console.log(`Processing ${dir}...`);
  processApiDirectory(dir);
}

console.log('All API files have been updated with observability!');
