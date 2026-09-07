import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import admin from 'firebase-admin';

// Load environment variables from .env.local and .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

if (fs.existsSync(path.join(rootDir, '.env.local'))) {
  dotenv.config({ path: path.join(rootDir, '.env.local') });
}
dotenv.config({ path: path.join(rootDir, '.env') });

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const folderIdArgIndex = args.indexOf('--folder');
const folderId = (folderIdArgIndex !== -1 && args[folderIdArgIndex + 1]) 
  ? args[folderIdArgIndex + 1] 
  : (process.env.GDRIVE_FOLDER_ID || '1Vxx4Qc8VQMyEg6x4d5CdqL4u0DHP9KA0');

console.log('----------------------------------------------------');
console.log('📸 Celeste Photo Studio - Google Drive Sync Pipeline');
console.log('----------------------------------------------------');
console.log(`Target Folder ID : ${folderId}`);
console.log(`Dry Run Mode     : ${isDryRun ? 'YES (No writes will occur)' : 'NO'}`);
console.log(`Force Overwrite  : ${isForce ? 'YES' : 'NO'}`);
console.log('----------------------------------------------------\n');

// Helper to parse credentials from file path or JSON string
function parseServiceAccountCredentials() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  // 1. Try inline JSON env var
  if (credentialsJson) {
    try {
      return { credentials: JSON.parse(credentialsJson) };
    } catch (e) {
      console.error('❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
      process.exit(1);
    }
  }

  // 2. Check GOOGLE_APPLICATION_CREDENTIALS
  if (credentialsPath) {
    const trimmed = credentialsPath.trim();
    // If user accidentally pasted JSON object string into GOOGLE_APPLICATION_CREDENTIALS
    if (trimmed.startsWith('{')) {
      try {
        return { credentials: JSON.parse(trimmed) };
      } catch (e) {
        console.error('❌ GOOGLE_APPLICATION_CREDENTIALS appears to be a JSON string, but parsing failed:', e.message);
        process.exit(1);
      }
    }

    // If user pasted just a private key string instead of file path or full JSON
    if (trimmed.startsWith('-----BEGIN PRIVATE KEY-----') || trimmed.includes('PRIVATE KEY')) {
      console.error('\n❌ CONFIG ERROR: GOOGLE_APPLICATION_CREDENTIALS contains only a private key string.');
      console.error('👉 GOOGLE_APPLICATION_CREDENTIALS must be a FILE PATH to your downloaded service-account-key.json file (e.g. GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json).');
      console.error('👉 Alternatively, paste the ENTIRE downloaded JSON file into GOOGLE_SERVICE_ACCOUNT_JSON=\'{ ... }\' inside .env.local.\n');
      printCredentialsInstructions();
      process.exit(1);
    }

    // Treat as file path
    const resolvedPath = path.isAbsolute(trimmed) 
      ? trimmed 
      : path.join(rootDir, trimmed);

    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ Service account key file not found at path: ${resolvedPath}`);
      printCredentialsInstructions();
      process.exit(1);
    }

    return { keyFile: resolvedPath };
  }

  return null;
}

// 1. Initialize Google Auth & Drive API Client
function initGoogleAuth() {
  const parsed = parseServiceAccountCredentials();
  let authOptions = {
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  };

  if (parsed?.credentials) {
    authOptions.credentials = parsed.credentials;
  } else if (parsed?.keyFile) {
    authOptions.keyFile = parsed.keyFile;
  }

  try {
    const auth = new google.auth.GoogleAuth(authOptions);
    return google.drive({ version: 'v3', auth });
  } catch (err) {
    console.error('❌ Failed to initialize Google Auth:', err.message);
    printCredentialsInstructions();
    process.exit(1);
  }
}

// 2. Initialize Firebase Admin SDK
function initFirebaseAdmin() {
  if (admin.apps.length > 0) return admin.app();

  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const storageBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;

  const parsed = parseServiceAccountCredentials();
  let credential;

  if (parsed?.credentials) {
    credential = admin.credential.cert(parsed.credentials);
  } else if (parsed?.keyFile) {
    credential = admin.credential.cert(parsed.keyFile);
  } else {
    credential = admin.credential.applicationDefault();
  }

  return admin.initializeApp({
    credential,
    projectId,
    storageBucket
  });
}

function printCredentialsInstructions() {
  console.log('\n💡 SETUP INSTRUCTIONS:');
  console.log('1. Go to Google Cloud Console -> IAM & Admin -> Service Accounts.');
  console.log('2. Create a Service Account for your Firebase project.');
  console.log('3. Generate & download a JSON Key file (e.g., service-account-key.json).');
  console.log('4. Copy the service account email (e.g. agent-service@project.iam.gserviceaccount.com).');
  console.log(`5. Share your Google Drive folder (${folderId}) with that email as "Viewer".`);
  console.log('6. Set GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json in .env.local.\n');
}

// Helper to construct Firebase Storage public media URL
function getFirebaseStoragePublicUrl(bucketName, destinationPath) {
  const encodedPath = encodeURIComponent(destinationPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;
}

async function main() {
  const drive = initGoogleAuth();
  
  if (!isDryRun) {
    try {
      initFirebaseAdmin();
    } catch (err) {
      console.warn('⚠️ Warning: Firebase Admin initialization issue:', err.message);
    }
  }

  // Step A: Fetch files from Google Drive folder
  console.log(`🔍 Querying Google Drive folder '${folderId}'...`);
  let files = [];
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink)',
      pageSize: 100
    });
    files = res.data.files || [];
  } catch (err) {
    console.error('❌ Google Drive API query failed:', err.message);
    printCredentialsInstructions();
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('ℹ️ No images or videos found in the specified Google Drive folder.');
    return;
  }

  console.log(`✅ Found ${files.length} file(s) in Google Drive folder:\n`);
  files.forEach((f, idx) => {
    const sizeMb = f.size ? (Number(f.size) / (1024 * 1024)).toFixed(2) : 'N/A';
    console.log(`  [${idx + 1}] ${f.name} (${f.mimeType}, ${sizeMb} MB) - ID: ${f.id}`);
  });

  if (isDryRun) {
    console.log('\n✨ Dry run complete. No files were transferred to Firebase.');
    return;
  }

  // Step B: Stream files directly to Firebase Storage & update Firestore
  const bucketName = process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    console.error('❌ FIREBASE_STORAGE_BUCKET is not configured in .env or .env.local');
    process.exit(1);
  }

  const bucket = admin.storage().bucket(bucketName);
  const db = admin.firestore();
  const photosCollection = db.collection('photos');

  console.log(`\n🚀 Starting streaming pipeline to Firebase Storage bucket '${bucketName}'...\n`);

  let syncedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const destinationPath = `photos/${file.name}`;
    const storageFile = bucket.file(destinationPath);

    // Check if file exists in Cloud Storage
    const [exists] = await storageFile.exists();
    if (exists && !isForce) {
      console.log(`⏭️  Skipping '${file.name}' (already exists in Firebase Storage). Use --force to re-upload.`);
      skippedCount++;
      continue;
    }

    console.log(`⏳ Streaming '${file.name}' (${file.id}) -> Storage path '${destinationPath}'...`);

    try {
      // Fetch stream from Google Drive API
      const driveStream = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'stream' }
      );

      // Create write stream directly into Cloud Storage
      await new Promise((resolve, reject) => {
        const writeStream = storageFile.createWriteStream({
          metadata: {
            contentType: file.mimeType,
            metadata: {
              gdriveId: file.id,
              originalName: file.name,
              syncedAt: new Date().toISOString()
            }
          },
          resumable: false
        });

        driveStream.data
          .on('error', reject)
          .pipe(writeStream)
          .on('error', reject)
          .on('finish', resolve);
      });

      const publicUrl = getFirebaseStoragePublicUrl(bucketName, destinationPath);

      // Create/Update metadata in Firestore
      await photosCollection.doc(file.id).set({
        title: file.name,
        gdriveId: file.id,
        mimeType: file.mimeType,
        size: Number(file.size || 0),
        storagePath: destinationPath,
        url: publicUrl,
        driveLink: file.webViewLink || null,
        thumbnailLink: file.thumbnailLink || null,
        syncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active'
      }, { merge: true });

      console.log(`✅ Synced '${file.name}' successfully! Public URL: ${publicUrl}`);
      syncedCount++;
    } catch (err) {
      console.error(`❌ Failed to sync '${file.name}':`, err.message);
      errorCount++;
    }
  }

  console.log('\n----------------------------------------------------');
  console.log('🎉 Sync Summary:');
  console.log(`  Uploaded : ${syncedCount}`);
  console.log(`  Skipped  : ${skippedCount}`);
  console.log(`  Errors   : ${errorCount}`);
  console.log('----------------------------------------------------');
}

main().catch((err) => {
  console.error('❌ Fatal error during sync execution:', err);
  process.exit(1);
});
